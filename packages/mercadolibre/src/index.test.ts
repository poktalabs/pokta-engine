import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMercadoLibreClient } from './index'

// The single seam is global `fetch`. Each test queues responses per-URL so we
// assert the catalog-search → lowest-MXN-item brain + the fail-soft shells.

type FetchResponse = {
  ok: boolean
  status: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

function res(status: number, body: unknown): FetchResponse {
  const ok = status >= 200 && status < 300
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Route by URL substring so item/search/token calls can be answered independently. */
function routeFetch(routes: { match: string; response: FetchResponse }[]): void {
  fetchMock.mockImplementation(async (url: string) => {
    const route = routes.find((r) => url.includes(r.match))
    if (!route) throw new Error(`unexpected fetch: ${url}`)
    return route.response
  })
}

describe('createMercadoLibreClient', () => {
  it('throws not-configured when no access token is supplied (and never fetches)', async () => {
    const client = createMercadoLibreClient({})
    expect(client.configured).toBe(false)
    await expect(client.search('lavadora lg')).rejects.toThrow(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ok: returns the lowest MXN item price for the matched catalog product', async () => {
    routeFetch([
      {
        match: '/products/search',
        response: res(200, { results: [{ id: 'MLM123', name: 'Lavadora LG', status: 'active', category_id: 'CAT1' }] }),
      },
      {
        match: '/products/MLM123/items',
        response: res(200, {
          results: [
            { item_id: 'ITEM_HI', price: 9999, currency_id: 'MXN' },
            { item_id: 'ITEM_LO', price: 8500, currency_id: 'MXN' },
            { item_id: 'ITEM_USD', price: 400, currency_id: 'USD' },
          ],
          paging: { total: 3, limit: 50, offset: 0 },
        }),
      },
    ])

    const client = createMercadoLibreClient({ accessToken: 'tok_live' })
    const result = await client.search('lavadora lg')

    expect(result.price_mxn).toBe(8500)
    expect(result.item_id).toBe('ITEM_LO')
    expect(result.catalog_product_id).toBe('MLM123')
    expect(result.category_id).toBe('CAT1')
    expect(result.failure_reason).toBeNull()
    expect(result.permalink).toContain('ITEM_LO')
  })

  it('non-MXN only: returns a clean empty result (never invents a price)', async () => {
    routeFetch([
      {
        match: '/products/search',
        response: res(200, { results: [{ id: 'MLM9', name: 'Producto', status: 'active' }] }),
      },
      {
        match: '/products/MLM9/items',
        response: res(200, { results: [{ item_id: 'I1', price: 100, currency_id: 'USD' }] }),
      },
    ])

    const client = createMercadoLibreClient({ accessToken: 'tok_live' })
    const result = await client.search('producto')

    expect(result.price_mxn).toBeNull()
    expect(result.failure_reason).toBe('catalog_items_found_but_no_mxn_price')
  })

  it('empty: no catalog matches yields no_catalog_match with null price', async () => {
    routeFetch([{ match: '/products/search', response: res(200, { results: [] }) }])

    const client = createMercadoLibreClient({ accessToken: 'tok_live' })
    const result = await client.search('nada')

    expect(result.price_mxn).toBeNull()
    expect(result.failure_reason).toBe('no_catalog_match')
    expect(result.candidates_checked).toBe(0)
  })

  it('403 on the search: returns a clean empty result with access_forbidden (no price invented)', async () => {
    routeFetch([{ match: '/products/search', response: res(403, 'Forbidden') }])

    const client = createMercadoLibreClient({ accessToken: 'tok_live' })
    const result = await client.search('lavadora')

    expect(result.price_mxn).toBeNull()
    expect(result.failure_reason).toBe('access_forbidden')
  })

  it('token-refresh: 401 → refresh access token → retry succeeds', async () => {
    let searchCalls = 0
    let usedTokenOnSuccess: string | null = null
    fetchMock.mockImplementation(async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url.includes('/oauth/token')) {
        return res(200, {
          access_token: 'tok_refreshed',
          token_type: 'bearer',
          expires_in: 21600,
          user_id: 1,
          refresh_token: 'refresh_new',
        })
      }
      if (url.includes('/products/search')) {
        searchCalls++
        if (searchCalls === 1) return res(401, 'expired token')
        usedTokenOnSuccess = init?.headers?.Authorization ?? null
        return res(200, { results: [{ id: 'MLM5', name: 'X', status: 'active' }] })
      }
      if (url.includes('/products/MLM5/items')) {
        return res(200, { results: [{ item_id: 'IOK', price: 1234, currency_id: 'MXN' }] })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const client = createMercadoLibreClient({
      accessToken: 'tok_expired',
      refreshToken: 'refresh_old',
      oauth: { clientId: 'cid', clientSecret: 'secret' },
    })
    const result = await client.search('x')

    expect(result.price_mxn).toBe(1234)
    expect(searchCalls).toBe(2)
    expect(usedTokenOnSuccess).toBe('Bearer tok_refreshed')
  })

  it('401 without refresh credentials rethrows (no silent price)', async () => {
    routeFetch([{ match: '/products/search', response: res(401, 'expired token') }])

    const client = createMercadoLibreClient({ accessToken: 'tok_expired' })
    await expect(client.search('x')).rejects.toThrow(/HTTP 401/)
  })
})
