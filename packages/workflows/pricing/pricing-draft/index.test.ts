import { describe, it, expect, vi } from 'vitest'
import type { RunContext } from '@pokta-engine/contract'
import type {
  Catalog,
  ShopifyClient,
  MercadoLibreClient,
  MLSearchResult,
  CompetitorSource,
  CompetitorQuote,
} from '@pokta-engine/integrations'

import { run } from './index'
import type { DesiredRow, WorkflowStateStore } from './state-store'
import { PRICING_WORKFLOW_ID } from './state-store'
import { selectSkus } from '../pricing-apply/index'
import { pricingApplyInputSchema } from '../pricing-apply/manifest'

// ---- competitor-source fakes (multi-source seam) -------------------------

function quote(over: Partial<CompetitorQuote> & Pick<CompetitorQuote, 'source'>): CompetitorQuote {
  return {
    source: over.source,
    title: over.title ?? null,
    priceMxn: over.priceMxn ?? null,
    permalink: over.permalink ?? null,
    productId: over.productId ?? null,
    categoryId: over.categoryId ?? null,
    candidatesChecked: over.candidatesChecked ?? 0,
    failureReason: over.failureReason ?? null,
    fetchedAt: over.fetchedAt ?? '',
  }
}

/** A fake competitor source whose lookup is driven by the query string. */
function sourceFake(id: string, lookup: (query: string) => CompetitorQuote | null): CompetitorSource {
  return { id, lookup: async (query) => lookup(query) }
}

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

  it('aggregates min across ACCEPTED quotes from multiple sources (chosenSource = winner)', async () => {
    // Two sources match ASKU (barcode 12345678 in title → accept). Amazon is the
    // cheaper accepted quote → it must win competitor_min + chosenSource.
    const mlSrc = sourceFake('mercado-libre', (query) =>
      query.includes('Oster')
        ? quote({ source: 'mercado-libre', title: 'Licuadora Oster 1200 12345678', priceMxn: 800 })
        : quote({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    )
    const amazonSrc = sourceFake('amazon-mx', (query) =>
      query.includes('Oster')
        ? quote({ source: 'amazon-mx', title: 'Licuadora Oster 1200 12345678 envio', priceMxn: 750 })
        : quote({ source: 'amazon-mx', failureReason: 'no_result' }),
    )

    const out = await run(
      {
        consumerId: 'mi-pase',
        costBySku: { ASKU: 500 },
        __stateStore: fakeStore(),
        __now: '2026-06-24T00:00:00.000Z',
        __sources: [mlSrc, amazonSrc],
      } as never,
      makeCtx(shopifyFake(), {} as MercadoLibreClient),
    )

    const conf = out.confident.find((r) => r.sku === 'ASKU')!
    expect(conf.competitorMinMxn).toBe(750) // min across accepted
    expect(conf.chosenSource).toBe('amazon-mx') // cheaper accepted source won
    expect(conf.suggestedPriceMxn).toBe(750) // priced to the chosen competitor
    expect(conf.quotes).toHaveLength(2) // every source's quote carried
    expect(conf.quotes.map((q) => q.source).sort()).toEqual(['amazon-mx', 'mercado-libre'])
    for (const q of conf.quotes) {
      expect(q.fetchedAt).toBe('2026-06-24T00:00:00.000Z') // single injected stamp
      expect(q.matchConfidence).toBe('high')
      expect(q.matchDecision).toBe('accept')
    }

    // Per-source yield is surfaced (ASKU priced by both; BSKU has no price).
    expect(out.summary.bySource).toEqual({
      'mercado-libre': { found: 1, accepted: 1 },
      'amazon-mx': { found: 1, accepted: 1 },
    })
  })

  it('a source that fails soft (returns null) never breaks the run; the other still prices', async () => {
    const mlSrc = sourceFake('mercado-libre', (query) =>
      query.includes('Oster')
        ? quote({ source: 'mercado-libre', title: 'Licuadora Oster 1200 12345678', priceMxn: 800 })
        : quote({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    )
    // Amazon throws internally → its CompetitorSource contract is to resolve null.
    const amazonSrc: CompetitorSource = {
      id: 'amazon-mx',
      lookup: async () => null,
    }

    const out = await run(
      {
        consumerId: 'mi-pase',
        costBySku: { ASKU: 500 },
        __stateStore: fakeStore(),
        __sources: [mlSrc, amazonSrc],
      } as never,
      makeCtx(shopifyFake(), {} as MercadoLibreClient),
    )

    const conf = out.confident.find((r) => r.sku === 'ASKU')!
    expect(conf.chosenSource).toBe('mercado-libre') // ML still priced the SKU
    expect(conf.competitorMinMxn).toBe(800)
    // amazon-mx is seeded in bySource (active source) but found nothing.
    expect(out.summary.bySource['amazon-mx']).toEqual({ found: 0, accepted: 0 })
  })

  it('a source that THROWS (violates the fail-soft contract) is dropped, not propagated', async () => {
    const mlSrc = sourceFake('mercado-libre', (query) =>
      query.includes('Oster')
        ? quote({ source: 'mercado-libre', title: 'Licuadora Oster 1200 12345678', priceMxn: 800 })
        : quote({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    )
    // A misbehaving source that REJECTS (not returns null) — the gather loop's
    // own .catch must absorb it so the run still completes (defense-in-depth).
    const rogueRejects: CompetitorSource = {
      id: 'amazon-mx',
      lookup: async () => {
        throw new Error('boom: scraper blew up')
      },
    }
    // ...and one that throws SYNCHRONOUSLY before returning a promise.
    const rogueThrowsSync: CompetitorSource = {
      id: 'sync-rogue',
      lookup: (() => {
        throw new Error('boom: sync throw')
      }) as CompetitorSource['lookup'],
    }

    const out = await run(
      {
        consumerId: 'mi-pase',
        costBySku: { ASKU: 500 },
        __stateStore: fakeStore(),
        __sources: [mlSrc, rogueRejects, rogueThrowsSync],
      } as never,
      makeCtx(shopifyFake(), {} as MercadoLibreClient),
    )

    // Run completed; ML still priced ASKU; the rogue sources contributed nothing.
    const conf = out.confident.find((r) => r.sku === 'ASKU')!
    expect(conf.chosenSource).toBe('mercado-libre')
    expect(conf.competitorMinMxn).toBe(800)
    expect(out.summary.bySource['amazon-mx']).toEqual({ found: 0, accepted: 0 })
    expect(out.summary.bySource['sync-rogue']).toEqual({ found: 0, accepted: 0 })
  })

  it('excludes a CHEAPER but REJECTED quote from competitor_min (only accepted count)', async () => {
    // ML accepts at 800; Amazon is cheaper (600) but its title does NOT match →
    // rejected → must NOT win competitor_min. Chosen stays ML @ 800.
    const mlSrc = sourceFake('mercado-libre', (query) =>
      query.includes('Oster')
        ? quote({ source: 'mercado-libre', title: 'Licuadora Oster 1200 12345678', priceMxn: 800 })
        : quote({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    )
    const amazonSrc = sourceFake('amazon-mx', (query) =>
      query.includes('Oster')
        ? quote({ source: 'amazon-mx', title: 'Producto totalmente distinto sin relacion', priceMxn: 600 })
        : quote({ source: 'amazon-mx', failureReason: 'no_result' }),
    )

    const out = await run(
      {
        consumerId: 'mi-pase',
        costBySku: { ASKU: 500 },
        __stateStore: fakeStore(),
        __sources: [mlSrc, amazonSrc],
      } as never,
      makeCtx(shopifyFake(), {} as MercadoLibreClient),
    )

    const conf = out.confident.find((r) => r.sku === 'ASKU')!
    expect(conf.competitorMinMxn).toBe(800) // cheaper-but-rejected 600 excluded
    expect(conf.chosenSource).toBe('mercado-libre')
    // amazon found a price (yield) but it was not accepted.
    expect(out.summary.bySource['amazon-mx']).toEqual({ found: 1, accepted: 0 })
  })

  it('ignores an ACCEPTED quote that carries no price (null priceMxn never wins)', async () => {
    // Amazon "accepts" by title but reports no usable price → cannot be the min.
    const mlSrc = sourceFake('mercado-libre', (query) =>
      query.includes('Oster')
        ? quote({ source: 'mercado-libre', title: 'Licuadora Oster 1200 12345678', priceMxn: 800 })
        : quote({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    )
    const amazonSrc = sourceFake('amazon-mx', (query) =>
      query.includes('Oster')
        ? quote({ source: 'amazon-mx', title: 'Licuadora Oster 1200 12345678', priceMxn: null })
        : quote({ source: 'amazon-mx', failureReason: 'no_result' }),
    )

    const out = await run(
      {
        consumerId: 'mi-pase',
        costBySku: { ASKU: 500 },
        __stateStore: fakeStore(),
        __sources: [mlSrc, amazonSrc],
      } as never,
      makeCtx(shopifyFake(), {} as MercadoLibreClient),
    )

    const conf = out.confident.find((r) => r.sku === 'ASKU')!
    expect(conf.competitorMinMxn).toBe(800) // null-price accepted quote ignored
    expect(conf.chosenSource).toBe('mercado-libre')
    expect(out.summary.bySource['amazon-mx']).toEqual({ found: 0, accepted: 0 })
  })

  it('rejects an accessory competitor via the accessory blocklist (a "Funda" is not priced against)', async () => {
    const mlSrc = sourceFake('mercado-libre', (query) =>
      query.includes('Oster')
        ? quote({ source: 'mercado-libre', title: 'Licuadora Oster 1200 12345678', priceMxn: 800 })
        : quote({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    )
    // Amazon returns a cheap accessory (a case) whose title contains "Funda".
    const amazonSrc = sourceFake('amazon-mx', (query) =>
      query.includes('Oster')
        ? quote({ source: 'amazon-mx', title: 'Funda protectora para Licuadora Oster 1200', priceMxn: 50 })
        : quote({ source: 'amazon-mx', failureReason: 'no_result' }),
    )

    const out = await run(
      {
        consumerId: 'mi-pase',
        costBySku: { ASKU: 500 },
        __stateStore: fakeStore(),
        __sources: [mlSrc, amazonSrc],
      } as never,
      makeCtx(shopifyFake(), {} as MercadoLibreClient),
    )

    const asku = [...out.confident, ...out.flagged].find((r) => r.sku === 'ASKU')!
    // The $50 "Funda" must NOT win — accessory rejected; ML's real $800 is chosen.
    expect(asku.chosenSource).toBe('mercado-libre')
    expect(asku.competitorMinMxn).toBe(800)
    expect(out.summary.bySource['amazon-mx']).toEqual({ found: 1, accepted: 0 })
  })

  it('applies per-SKU curated forbidden terms (matchHintsBySku)', async () => {
    // A titled ML match that a curated forbidden term ('samsung') must reject.
    const mlSrc = sourceFake('mercado-libre', (query) =>
      query.includes('Oster')
        ? quote({ source: 'mercado-libre', title: 'Licuadora Oster 1200 Samsung Edition', priceMxn: 800 })
        : quote({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    )

    const out = await run(
      {
        consumerId: 'mi-pase',
        costBySku: { ASKU: 500 },
        __stateStore: fakeStore(),
        __sources: [mlSrc],
        matchHintsBySku: { ASKU: { forbidden: ['samsung'] } },
      } as never,
      makeCtx(shopifyFake(), {} as MercadoLibreClient),
    )

    const asku = [...out.confident, ...out.flagged].find((r) => r.sku === 'ASKU')!
    expect(asku.chosenSource).toBeNull() // curated forbidden term rejected the match
    expect(asku.matchDecision).not.toBe('accept')
  })

  it('draft output is apply-chain compatible (validates pricingApplyInputSchema + selectSkus)', async () => {
    const ml: MercadoLibreClient = {
      configured: true,
      search: vi.fn(async (query: string) =>
        query.includes('Oster')
          ? mlResult({ query, title: 'Licuadora Oster 1200 12345678', price_mxn: 800, item_id: 'MLM1' })
          : mlResult({ query, failure_reason: 'no_catalog_match' }),
      ),
    }
    const out = await run(
      { consumerId: 'mi-pase', costBySku: { ASKU: 500 }, __stateStore: fakeStore() } as never,
      makeCtx(shopifyFake(), ml),
    )

    // The worker feeds the WHOLE draft output as apply input — it must satisfy
    // the apply schema and selectSkus must read the same ApplySku fields intact.
    const parsed = pricingApplyInputSchema.parse(out)
    const confidentSkus = selectSkus(parsed, 'pricing-apply-confident')
    const flaggedSkus = selectSkus(parsed, 'pricing-apply-flagged')

    expect(confidentSkus.map((s) => s.sku)).toEqual(['ASKU'])
    expect(flaggedSkus.map((s) => s.sku)).toEqual(['BSKU'])
    for (const s of [...confidentSkus, ...flaggedSkus]) {
      expect(typeof s.sku).toBe('string')
      expect(typeof s.shopifyVariantId).toBe('number')
      expect('suggestedPriceMxn' in s).toBe(true)
    }
  })
})
