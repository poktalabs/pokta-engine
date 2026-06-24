import { describe, expect, it, vi } from 'vitest'

import { mercadoLibreSource } from './competitor-source'
import type { MercadoLibreClient, MLSearchResult } from './index'

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

function fakeClient(search: MercadoLibreClient['search']): MercadoLibreClient {
  return { configured: true, search }
}

describe('mercadoLibreSource', () => {
  it('maps a successful MLSearchResult into a CompetitorQuote', async () => {
    const src = mercadoLibreSource(
      fakeClient(async (query) =>
        mlResult({
          query,
          title: 'Licuadora Oster 1200',
          price_mxn: 800,
          permalink: 'https://articulo.mercadolibre.com.mx/MLM1',
          catalog_product_id: 'MLM-PROD-1',
          category_id: 'MLM1071',
          candidates_checked: 3,
        }),
      ),
    )

    const quote = await src.lookup('Oster 1200')
    expect(quote).toEqual({
      source: 'mercado-libre',
      title: 'Licuadora Oster 1200',
      priceMxn: 800,
      permalink: 'https://articulo.mercadolibre.com.mx/MLM1',
      productId: 'MLM-PROD-1',
      categoryId: 'MLM1071',
      candidatesChecked: 3,
      failureReason: null,
      fetchedAt: '', // stamped by the caller, never by the adapter
    })
    expect(src.id).toBe('mercado-libre')
  })

  it('preserves an empty (no-price) result as a quote carrying the failure reason', async () => {
    const src = mercadoLibreSource(
      fakeClient(async (query) => mlResult({ query, failure_reason: 'no_catalog_match' })),
    )
    const quote = await src.lookup('something obscure')
    // A clean empty ML result is NOT a thrown error: it maps to a quote whose
    // priceMxn is null + failureReason is surfaced (so the SKU flags with a reason).
    expect(quote).not.toBeNull()
    expect(quote!.priceMxn).toBeNull()
    expect(quote!.failureReason).toBe('no_catalog_match')
    expect(quote!.title).toBeNull()
  })

  it('fails soft to null when the client throws (never rejects into the run)', async () => {
    const src = mercadoLibreSource(
      fakeClient(async () => {
        throw new Error('ML API returned HTTP 500')
      }),
    )
    await expect(src.lookup('boom')).resolves.toBeNull()
  })

  it('forwards the abort signal to the client', async () => {
    const search = vi.fn(async (query: string) => mlResult({ query }))
    const src = mercadoLibreSource(fakeClient(search))
    const ac = new AbortController()
    await src.lookup('q', { signal: ac.signal })
    expect(search).toHaveBeenCalledWith('q', { signal: ac.signal })
  })
})
