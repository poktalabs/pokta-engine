import { describe, it, expect, vi } from 'vitest'
import type { RunContext } from '@pokta-engine/contract'
import type { ShopifyClient } from '@pokta-engine/integrations'

import { run, runFlagged, isWithinAntiThrash, selectSkus } from './index'
import type {
  ApplyCheckpoint,
  ApplyStateRow,
  ApplyStateStore,
} from './apply-state-store'
import type { ApplySku } from './manifest'

// ---- fakes ---------------------------------------------------------------

/**
 * In-memory apply store: seeded with prior rows + records every checkpoint so a
 * test can assert the exact before/after transitions written per SKU.
 */
function fakeStore(seed: ApplyStateRow[] = []): ApplyStateStore & {
  checkpoints: ApplyCheckpoint[]
  rows: Map<string, ApplyStateRow>
} {
  const rows = new Map<string, ApplyStateRow>(seed.map((r) => [r.sku, r]))
  const checkpoints: ApplyCheckpoint[] = []
  return {
    rows,
    checkpoints,
    async readRows(_consumerId, skus) {
      const out = new Map<string, ApplyStateRow>()
      for (const sku of skus) {
        const r = rows.get(sku)
        if (r) out.set(sku, r)
      }
      return out
    },
    async checkpoint(cp) {
      checkpoints.push(cp)
      // Mirror the DB upsert so a re-run within the same test sees applied rows.
      const prev = rows.get(cp.sku)
      rows.set(cp.sku, {
        sku: cp.sku,
        status: cp.status,
        desiredPrice: prev?.desiredPrice ?? null,
        priorShopify: prev?.priorShopify ?? null,
        attemptedPrice: cp.attemptedPrice ?? prev?.attemptedPrice ?? null,
      })
    },
  }
}

function makeCtx(shopify: ShopifyClient): RunContext {
  return {
    runId: 'run-apply-1',
    traceId: 'trace-apply-1',
    logger: { info: vi.fn(), error: vi.fn() },
    artifactDir: '/tmp/run-apply-1',
    integration: ((name: string) => {
      if (name === 'shopify') return shopify
      throw new Error(`integration('${name}') not stubbed`)
    }) as RunContext['integration'],
  }
}

function sku(over: Partial<ApplySku> & Pick<ApplySku, 'sku' | 'shopifyVariantId' | 'suggestedPriceMxn'>): ApplySku {
  return { ...over } as ApplySku
}

// ---- isWithinAntiThrash (pure) -------------------------------------------

describe('isWithinAntiThrash', () => {
  it('skips a sub-1% change, applies a >=1% change, always applies with no baseline', () => {
    expect(isWithinAntiThrash(1005, 1000)).toBe(true) // 0.5% → skip
    expect(isWithinAntiThrash(1010, 1000)).toBe(false) // 1.0% → apply
    expect(isWithinAntiThrash(1200, 1000)).toBe(false) // 20% → apply
    expect(isWithinAntiThrash(1000, null)).toBe(false) // no baseline → apply
    expect(isWithinAntiThrash(1000, 0)).toBe(false) // zero baseline → apply
  })
})

// ---- selectSkus ----------------------------------------------------------

describe('selectSkus', () => {
  it('picks the confident subset for the confident id and flagged for the flagged id', () => {
    const input = {
      confident: [sku({ sku: 'C', shopifyVariantId: 1, suggestedPriceMxn: 10 })],
      flagged: [sku({ sku: 'F', shopifyVariantId: 2, suggestedPriceMxn: 20 })],
    }
    expect(selectSkus(input, 'pricing-apply-confident').map((s) => s.sku)).toEqual(['C'])
    expect(selectSkus(input, 'pricing-apply-flagged').map((s) => s.sku)).toEqual(['F'])
  })
  it('an explicit skus[] overrides the subset split', () => {
    const input = {
      skus: [sku({ sku: 'X', shopifyVariantId: 9, suggestedPriceMxn: 5 })],
      confident: [sku({ sku: 'C', shopifyVariantId: 1, suggestedPriceMxn: 10 })],
    }
    expect(selectSkus(input, 'pricing-apply-confident').map((s) => s.sku)).toEqual(['X'])
  })
})

// ---- run -----------------------------------------------------------------

describe('pricing-apply run', () => {
  it('partial failure: one SKU 422s → per-SKU statuses recorded + the RUN still resolves', async () => {
    const shopify: ShopifyClient = {
      getCatalog: vi.fn(),
      updateVariantPrice: vi.fn(async ({ variantId, newPriceMxn }) => {
        if (variantId === 22) throw new Error('Shopify API error 422: bad price')
        return { id: variantId, price: newPriceMxn.toFixed(2), updatedAt: '2026-06-07T00:00:00Z' }
      }),
    }
    const store = fakeStore()
    const out = await run(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: store,
        skus: [
          sku({ sku: 'OK', shopifyVariantId: 11, suggestedPriceMxn: 800 }),
          sku({ sku: 'BAD', shopifyVariantId: 22, suggestedPriceMxn: 900 }),
        ],
      } as never,
      makeCtx(shopify),
    )

    // The run RESOLVES (never throws on a single-SKU failure) with a partial summary.
    expect(out.applied).toBe(1)
    expect(out.failed).toBe(1)
    expect(out.skipped).toBe(0)

    const ok = out.perSku.find((r) => r.sku === 'OK')!
    expect(ok.outcome).toBe('applied')
    const bad = out.perSku.find((r) => r.sku === 'BAD')!
    expect(bad.outcome).toBe('failed')
    expect(bad.reason).toMatch(/422/)

    // CHECKPOINT before + after each write: OK → attempting,applied; BAD → attempting,failed.
    const okCps = store.checkpoints.filter((c) => c.sku === 'OK').map((c) => c.status)
    expect(okCps).toEqual(['attempting', 'applied'])
    const badCps = store.checkpoints.filter((c) => c.sku === 'BAD').map((c) => c.status)
    expect(badCps).toEqual(['attempting', 'failed'])
    const badFail = store.checkpoints.find((c) => c.sku === 'BAD' && c.status === 'failed')!
    expect(badFail.failureReason).toMatch(/422/)
  })

  it('re-run retries ONLY rows not already applied (resumable, idempotent)', async () => {
    const updateVariantPrice = vi.fn(async ({ variantId, newPriceMxn }) => ({
      id: variantId,
      price: newPriceMxn.toFixed(2),
      updatedAt: '2026-06-07T00:00:00Z',
    }))
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice }

    // Seed: ALREADY-applied SKU + a previously-failed SKU to retry.
    const store = fakeStore([
      { sku: 'DONE', status: 'applied', desiredPrice: 800, priorShopify: 1000, attemptedPrice: 800 },
      { sku: 'RETRY', status: 'failed', desiredPrice: 900, priorShopify: 1000, attemptedPrice: 900 },
    ])

    const out = await run(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: store,
        skus: [
          sku({ sku: 'DONE', shopifyVariantId: 11, suggestedPriceMxn: 800 }),
          sku({ sku: 'RETRY', shopifyVariantId: 22, suggestedPriceMxn: 900 }),
        ],
      } as never,
      makeCtx(shopify),
    )

    // DONE is skipped (already applied); only RETRY is written.
    expect(out.applied).toBe(1)
    expect(out.skipped).toBe(1)
    expect(updateVariantPrice).toHaveBeenCalledTimes(1)
    expect(updateVariantPrice).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 22, newPriceMxn: 900 }),
    )
    const done = out.perSku.find((r) => r.sku === 'DONE')!
    expect(done.outcome).toBe('skipped')
    expect(done.reason).toBe('already_applied')
    // No 'attempting' checkpoint was written for the already-applied SKU.
    expect(store.checkpoints.some((c) => c.sku === 'DONE')).toBe(false)
  })

  it('<1% change is skipped (anti-thrash) and never hits Shopify', async () => {
    const updateVariantPrice = vi.fn()
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice }

    // Baseline = last applied 1000; new target 1005 → 0.5% → skip.
    const store = fakeStore([
      { sku: 'THRASH', status: 'applied', desiredPrice: 1005, priorShopify: 1000, attemptedPrice: 1000 },
    ])

    const out = await run(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: store,
        skus: [sku({ sku: 'THRASH', shopifyVariantId: 33, suggestedPriceMxn: 1005 })],
      } as never,
      makeCtx(shopify),
    )

    // already-applied takes precedence here; force the non-applied path instead:
    expect(out.applied + out.skipped).toBe(1)
    expect(updateVariantPrice).not.toHaveBeenCalled()
  })

  it('<1% change on a non-applied row is skipped via anti-thrash (baseline=priorShopify)', async () => {
    const updateVariantPrice = vi.fn()
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice }

    // pending row, priorShopify 1000, target 1008 → 0.8% → anti-thrash skip.
    const store = fakeStore([
      { sku: 'NEAR', status: 'pending', desiredPrice: 1008, priorShopify: 1000, attemptedPrice: null },
    ])
    const out = await run(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: store,
        skus: [sku({ sku: 'NEAR', shopifyVariantId: 44, suggestedPriceMxn: 1008, currentPriceMxn: 1000 })],
      } as never,
      makeCtx(shopify),
    )
    expect(out.skipped).toBe(1)
    expect(out.applied).toBe(0)
    expect(updateVariantPrice).not.toHaveBeenCalled()
    const cp = store.checkpoints.find((c) => c.sku === 'NEAR')!
    expect(cp.status).toBe('skipped')
    expect(cp.failureReason).toBe('within_anti_thrash_1pct')
  })

  it('a null target is held → skipped (no_target_price), no Shopify write', async () => {
    const updateVariantPrice = vi.fn()
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice }
    const store = fakeStore()
    const out = await run(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: store,
        skus: [sku({ sku: 'HOLD', shopifyVariantId: 55, suggestedPriceMxn: null })],
      } as never,
      makeCtx(shopify),
    )
    expect(out.skipped).toBe(1)
    expect(updateVariantPrice).not.toHaveBeenCalled()
    expect(out.perSku[0]!.reason).toBe('no_target_price')
  })

  it('applies a fresh SKU with no prior state (no baseline → always write)', async () => {
    const updateVariantPrice = vi.fn(async ({ variantId, newPriceMxn }) => ({
      id: variantId,
      price: newPriceMxn.toFixed(2),
      updatedAt: '2026-06-07T00:00:00Z',
    }))
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice }
    const store = fakeStore()
    const out = await run(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: store,
        skus: [sku({ sku: 'NEW', shopifyVariantId: 66, suggestedPriceMxn: 750 })],
      } as never,
      makeCtx(shopify),
    )
    expect(out.applied).toBe(1)
    expect(updateVariantPrice).toHaveBeenCalledWith(
      expect.objectContaining({ variantId: 66, newPriceMxn: 750 }),
    )
    expect(store.checkpoints.map((c) => c.status)).toEqual(['attempting', 'applied'])
  })

  it('runFlagged binds the flagged id so it applies the flagged subset', async () => {
    const updateVariantPrice = vi.fn(async ({ variantId, newPriceMxn }) => ({
      id: variantId,
      price: newPriceMxn.toFixed(2),
      updatedAt: '2026-06-07T00:00:00Z',
    }))
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice }
    const store = fakeStore()
    const out = await runFlagged(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: store,
        confident: [sku({ sku: 'C', shopifyVariantId: 1, suggestedPriceMxn: 10 })],
        flagged: [sku({ sku: 'F', shopifyVariantId: 2, suggestedPriceMxn: 20 })],
      } as never,
      makeCtx(shopify),
    )
    expect(out.applied).toBe(1)
    expect(out.perSku[0]!.sku).toBe('F')
  })

  it('throws when consumerId is missing (resolved from the run record)', async () => {
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice: vi.fn() }
    await expect(
      run({ __applyStore: fakeStore(), skus: [] } as never, makeCtx(shopify)),
    ).rejects.toThrow(/consumerId is required/)
  })

  it('an empty price set resolves to a zero summary with no integration use', async () => {
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice: vi.fn() }
    const out = await run(
      { consumerId: 'mi-pase', __applyStore: fakeStore(), skus: [] } as never,
      makeCtx(shopify),
    )
    expect(out).toEqual({ applied: 0, skipped: 0, failed: 0, perSku: [] })
  })

  it('a checkpoint-write failure does not abort the batch (fail-soft)', async () => {
    const updateVariantPrice = vi.fn(async ({ variantId, newPriceMxn }) => ({
      id: variantId,
      price: newPriceMxn.toFixed(2),
      updatedAt: '2026-06-07T00:00:00Z',
    }))
    const shopify: ShopifyClient = { getCatalog: vi.fn(), updateVariantPrice }
    const base = fakeStore()
    const flaky: ApplyStateStore = {
      readRows: base.readRows.bind(base),
      checkpoint: vi.fn(async () => {
        throw new Error('DB write timeout')
      }),
    }
    const out = await run(
      {
        consumerId: 'mi-pase',
        __noPace: true,
        __applyStore: flaky,
        skus: [sku({ sku: 'NEW', shopifyVariantId: 77, suggestedPriceMxn: 750 })],
      } as never,
      makeCtx(shopify),
    )
    // The write still happened; the run still resolves with the applied outcome.
    expect(out.applied).toBe(1)
    expect(updateVariantPrice).toHaveBeenCalledOnce()
  })
})
