import { describe, it, expect, vi } from 'vitest'
import type { RunContext } from '@godin-engine/contract'
import type {
  Catalog,
  ShopifyClient,
  MercadoLibreClient,
  MLSearchResult,
} from '@godin-engine/integrations'

import { run } from './index'
import type { DesiredRow, WorkflowStateStore } from './state-store'
import { PRICING_WORKFLOW_ID } from './state-store'

// ---- fakes ---------------------------------------------------------------

function mlResult(over: Partial<MLSearchResult>): MLSearchResult {
  return {
    query: over.query ?? 'q',
    title: over.title ?? null,
    price_mxn: over.price_mxn ?? null,
    permalink: over.permalink ?? null,
    catalog_product_id: over.catalog_product_id ?? null,
    item_id: over.item_id ?? null,
    category_id: over.category_id ?? null,
    match_strategy: 'catalog_search_lowest_mxn_item',
    candidates_checked: over.candidates_checked ?? 0,
    failure_reason: over.failure_reason ?? null,
    raw_response_summary: over.raw_response_summary ?? { results_count: 0, first_id: null },
  }
}

/** A capturing in-memory state store — lets us assert the desired rows written. */
function fakeStore(): WorkflowStateStore & { rows: DesiredRow[] } {
  const rows: DesiredRow[] = []
  return {
    rows,
    async upsertDesired(input) {
      rows.push(...input)
    },
  }
}

/** Build a ctx whose integration() returns the supplied shopify / ml fakes. */
function makeCtx(shopify: ShopifyClient, ml: MercadoLibreClient): RunContext {
  return {
    runId: 'run-draft-1',
    traceId: 'trace-1',
    logger: { info: vi.fn(), error: vi.fn() },
    artifactDir: '/tmp/run-draft-1',
    integration: ((name: string) => {
      if (name === 'shopify') return shopify
      if (name === 'mercado-libre') return ml
      throw new Error(`integration('${name}') not stubbed`)
    }) as RunContext['integration'],
  }
}

// Two products: ASKU (barcode hits ML → confident), BSKU (ML miss → flagged).
function catalog(): Catalog {
  const products = [
    {
      id: 1,
      title: 'Licuadora Oster 1200',
      vendor: 'Oster',
      product_type: 'Licuadora',
      variants: [{ id: 11, sku: 'ASKU', title: null, price: '1000.00', barcode: '12345678' }],
    },
    {
      id: 2,
      title: 'Cafetera Mística 900',
      vendor: 'Mistica',
      product_type: 'Cafetera',
      variants: [{ id: 22, sku: 'BSKU', title: null, price: '500.00', barcode: null }],
    },
  ]
  const variantCount = products.reduce((s, p) => s + p.variants.length, 0)
  return { products, variantCount }
}

function shopifyFake(): ShopifyClient {
  return {
    getCatalog: vi.fn(async () => catalog()),
    updateVariantPrice: vi.fn(),
  }
}

describe('pricing-draft run', () => {
  it('classifies an accepted, actionable SKU as confident and a miss as flagged', async () => {
    const ml: MercadoLibreClient = {
      configured: true,
      // ASKU: barcode 12345678 appears in title → identifier match (accept).
      // BSKU: no price → competitor miss.
      search: vi.fn(async (query: string) => {
        if (query.includes('Oster')) {
          return mlResult({
            query,
            title: 'Licuadora Oster 1200 12345678 nueva',
            price_mxn: 800,
            item_id: 'MLM1',
          })
        }
        return mlResult({ query, failure_reason: 'no_catalog_match' })
      }),
    }
    const store = fakeStore()
    const out = await run(
      { consumerId: 'mi-pase', costBySku: { ASKU: 500 }, __stateStore: store } as never,
      makeCtx(shopifyFake(), ml),
    )

    expect(out.summary.totalSkus).toBe(2)
    expect(out.confident).toHaveLength(1)
    expect(out.flagged).toHaveLength(1)

    const conf = out.confident[0]!
    expect(conf.sku).toBe('ASKU')
    expect(conf.matchDecision).toBe('accept')
    expect(conf.matchConfidence).toBe('high')
    // current 1000, cost 500 @15% floor=575, competitor 800 → lower_to_competitor.
    expect(conf.decision).toBe('lower_to_competitor')
    expect(conf.suggestedPriceMxn).toBe(800)

    const flag = out.flagged[0]!
    expect(flag.sku).toBe('BSKU')
    expect(flag.competitorMinMxn).toBeNull()
  })

  it('competitor-miss: ML throwing flags the SKU (fail-soft, no invented price)', async () => {
    const ml: MercadoLibreClient = {
      configured: true,
      search: vi.fn(async () => {
        throw new Error('ML API returned HTTP 403')
      }),
    }
    const store = fakeStore()
    const out = await run(
      { consumerId: 'mi-pase', __stateStore: store } as never,
      makeCtx(shopifyFake(), ml),
    )

    expect(out.summary.competitorMissCount).toBe(2)
    expect(out.confident).toHaveLength(0)
    expect(out.flagged).toHaveLength(2)
    for (const row of out.flagged) {
      expect(row.competitorMinMxn).toBeNull()
      expect(row.competitorFailureReason).toBe('ml_lookup_error')
    }
  })

  it('low-confidence match is flagged and its competitor price is NOT trusted', async () => {
    const ml: MercadoLibreClient = {
      configured: true,
      // A titled but unrelated result → low/medium confidence → reject.
      search: vi.fn(async (query: string) =>
        mlResult({ query, title: 'Producto totalmente distinto sin relacion', price_mxn: 10, item_id: 'X' }),
      ),
    }
    const store = fakeStore()
    const out = await run(
      { consumerId: 'mi-pase', costBySku: { ASKU: 500, BSKU: 200 }, __stateStore: store } as never,
      makeCtx(shopifyFake(), ml),
    )

    expect(out.confident).toHaveLength(0)
    expect(out.flagged).toHaveLength(2)
    for (const row of out.flagged) {
      expect(row.matchDecision).not.toBe('accept')
    }
  })

  it('upserts a pending desired row per SKU under the logical pricing workflow', async () => {
    const ml: MercadoLibreClient = {
      configured: true,
      search: vi.fn(async (query: string) => {
        if (query.includes('Oster')) {
          return mlResult({ query, title: 'Licuadora Oster 1200 12345678', price_mxn: 800, item_id: 'MLM1' })
        }
        return mlResult({ query, failure_reason: 'no_catalog_match' })
      }),
    }
    const store = fakeStore()
    await run(
      { consumerId: 'mi-pase', costBySku: { ASKU: 500 }, __stateStore: store } as never,
      makeCtx(shopifyFake(), ml),
    )

    expect(store.rows).toHaveLength(2)
    const askuRow = store.rows.find((r) => r.sku === 'ASKU')!
    expect(askuRow.consumerId).toBe('mi-pase')
    expect(askuRow.desiredPrice).toBe(800)
    expect(askuRow.priorShopify).toBe(1000)
    expect(askuRow.sourceRunId).toBe('run-draft-1')
    expect(askuRow.desiredHash).toMatch(/^[0-9a-f]{16}$/)
    // The desired row uses the logical family id, shared with the apply children.
    expect(PRICING_WORKFLOW_ID).toBe('pricing')
  })

  it('throws when consumerId is missing (resolved from the run record)', async () => {
    const ml: MercadoLibreClient = { configured: true, search: vi.fn() }
    await expect(
      run({ __stateStore: fakeStore() } as never, makeCtx(shopifyFake(), ml)),
    ).rejects.toThrow(/consumerId is required/)
  })

  it('honors the limit (prices only the first N variants)', async () => {
    const ml: MercadoLibreClient = {
      configured: true,
      search: vi.fn(async (query: string) => mlResult({ query, failure_reason: 'no_catalog_match' })),
    }
    const out = await run(
      { consumerId: 'mi-pase', limit: 1, __stateStore: fakeStore() } as never,
      makeCtx(shopifyFake(), ml),
    )
    expect(out.summary.totalSkus).toBe(1)
  })
})
