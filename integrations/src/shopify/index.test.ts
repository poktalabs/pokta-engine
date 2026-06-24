import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createShopifyClient,
  ShopifyApiError,
  type ShopifyConfig,
} from './index'

// The single seam is the global `fetch`. Each test reconfigures it to return a
// catalog / updated variant on success, or a non-2xx Response on error. We
// assert getCatalog/updateVariantPrice map these to typed results / throws.
const fetchMock = vi.fn()

const CONFIG: ShopifyConfig = {
  baseUrl: 'https://mi-pase-dev.myshopify.com/admin/api/2024-04',
  accessToken: 'shpat_test_token',
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createShopifyClient — config / unconfigured', () => {
  it('throws when config is missing entirely', () => {
    expect(() => createShopifyClient(undefined as unknown as ShopifyConfig)).toThrow(/not configured/i)
  })

  it('throws when baseUrl is missing', () => {
    expect(() =>
      createShopifyClient({ baseUrl: '', accessToken: 'shpat_x' })
    ).toThrow(/not configured/i)
  })

  it('throws when accessToken is missing', () => {
    expect(() =>
      createShopifyClient({ baseUrl: 'https://x.myshopify.com', accessToken: '' })
    ).toThrow(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getCatalog', () => {
  it('reads products + variants and counts variants on success', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        products: [
          {
            id: 1,
            title: 'Refrigerador',
            vendor: 'LG',
            product_type: 'Refrigeradores',
            variants: [
              { id: 11, sku: 'LG-001', price: '15999.00', barcode: '750' },
              { id: 12, sku: 'LG-002', price: '17999.00' },
            ],
          },
          {
            id: 2,
            title: 'Lavadora',
            variants: [{ id: 21, sku: 'MABE-001', price: '8999.00' }],
          },
        ],
      })
    )

    const client = createShopifyClient(CONFIG)
    const catalog = await client.getCatalog()

    expect(catalog.products).toHaveLength(2)
    expect(catalog.variantCount).toBe(3)

    const [url, init] = fetchMock.mock.calls[0]!
    // Defaults to the live storefront (status=active) at the 250 page cap.
    expect(url).toBe(`${CONFIG.baseUrl}/products.json?limit=250&status=active`)
    expect(init.headers['X-Shopify-Access-Token']).toBe(CONFIG.accessToken)
  })

  it('honors a custom limit and tolerates a missing products array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const client = createShopifyClient(CONFIG)
    const catalog = await client.getCatalog({ limit: 50 })

    expect(catalog.products).toEqual([])
    expect(catalog.variantCount).toBe(0)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${CONFIG.baseUrl}/products.json?limit=50&status=active`)
  })

  it('caps page size at the Shopify max of 250 even when asked for more', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ products: [] }))
    const client = createShopifyClient(CONFIG)
    await client.getCatalog({ limit: 1000 })
    expect(fetchMock.mock.calls[0]![0]).toBe(`${CONFIG.baseUrl}/products.json?limit=250&status=active`)
  })

  it("status: 'any' omits the status filter; an explicit status is forwarded", async () => {
    // Fresh Response per call (a Response body is single-use).
    fetchMock.mockImplementation(async () => jsonResponse({ products: [] }))
    const client = createShopifyClient(CONFIG)
    await client.getCatalog({ status: 'any' })
    expect(fetchMock.mock.calls[0]![0]).toBe(`${CONFIG.baseUrl}/products.json?limit=250`)

    fetchMock.mockClear()
    await client.getCatalog({ status: 'draft' })
    expect(fetchMock.mock.calls[0]![0]).toBe(`${CONFIG.baseUrl}/products.json?limit=250&status=draft`)
  })

  it('auto-paginates by following the Link rel="next" cursor across pages', async () => {
    const page2 = 'https://mi-pase-dev.myshopify.com/admin/api/2024-04/products.json?limit=250&page_info=CURSOR2'
    const page3 = 'https://mi-pase-dev.myshopify.com/admin/api/2024-04/products.json?limit=250&page_info=CURSOR3'
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ products: [{ id: 1, title: 'A', variants: [{ id: 11, sku: 'A1', price: '1.00' }] }] }, 200, {
          // realistic header: includes both previous + next on a middle page
          Link: `<${page2}>; rel="next"`,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ products: [{ id: 2, title: 'B', variants: [{ id: 21, sku: 'B1', price: '2.00' }] }] }, 200, {
          Link: `<https://x/prev>; rel="previous", <${page3}>; rel="next"`,
        })
      )
      .mockResolvedValueOnce(
        // last page: no Link header → pagination stops
        jsonResponse({ products: [{ id: 3, title: 'C', variants: [{ id: 31, sku: 'C1', price: '3.00' }] }] })
      )

    const client = createShopifyClient(CONFIG)
    const catalog = await client.getCatalog()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(catalog.products.map((p) => p.id)).toEqual([1, 2, 3])
    expect(catalog.variantCount).toBe(3)
    // Pages 2 and 3 follow the absolute cursor URL verbatim.
    expect(fetchMock.mock.calls[1]![0]).toBe(page2)
    expect(fetchMock.mock.calls[2]![0]).toBe(page3)
  })

  it('stops paginating at maxPages (runaway-cursor backstop)', async () => {
    // Every page returns a next cursor; maxPages must bound the loop. Fresh
    // Response per call (a Response body is single-use).
    fetchMock.mockImplementation(async () =>
      jsonResponse({ products: [{ id: 1, title: 'A', variants: [] }] }, 200, {
        Link: `<${CONFIG.baseUrl}/products.json?limit=250&page_info=LOOP>; rel="next"`,
      })
    )
    const client = createShopifyClient(CONFIG)
    const catalog = await client.getCatalog({ maxPages: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(catalog.products).toHaveLength(3)
  })

  it('throws ShopifyApiError on a non-2xx read', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: 'unauthorized' }, 401))
    const client = createShopifyClient(CONFIG)
    await expect(client.getCatalog()).rejects.toBeInstanceOf(ShopifyApiError)
  })
})

describe('updateVariantPrice', () => {
  it('PUTs the variant price (2dp) and returns the updated variant', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        variant: { id: 11, price: '14999.00', updated_at: '2026-06-08T00:00:00Z' },
      })
    )

    const client = createShopifyClient(CONFIG)
    const result = await client.updateVariantPrice({ variantId: 11, newPriceMxn: 14999 })

    expect(result).toEqual({ id: 11, price: '14999.00', updatedAt: '2026-06-08T00:00:00Z' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`${CONFIG.baseUrl}/variants/11.json`)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      variant: { id: 11, price: '14999.00' },
    })
  })

  it('throws ShopifyApiError with status 422 on validation failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: { price: ['is invalid'] } }, 422)
    )

    const client = createShopifyClient(CONFIG)
    const err = await client
      .updateVariantPrice({ variantId: 11, newPriceMxn: -1 })
      .catch((e) => e)

    expect(err).toBeInstanceOf(ShopifyApiError)
    expect(err.status).toBe(422)
    expect(err.isRateLimited).toBe(false)
    expect(err.body).toContain('is invalid')
  })

  it('throws a rate-limited ShopifyApiError (429) carrying retryAfterSeconds', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: 'Too Many Requests' }, 429, { 'Retry-After': '2' })
    )

    const client = createShopifyClient(CONFIG)
    const err = await client
      .updateVariantPrice({ variantId: 11, newPriceMxn: 14999 })
      .catch((e) => e)

    expect(err).toBeInstanceOf(ShopifyApiError)
    expect(err.status).toBe(429)
    expect(err.isRateLimited).toBe(true)
    expect(err.retryAfterSeconds).toBe(2)
  })

  it('forwards an AbortSignal', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ variant: { id: 11, price: '1.00', updated_at: 't' } })
    )
    const controller = new AbortController()
    const client = createShopifyClient(CONFIG)
    await client.updateVariantPrice({ variantId: 11, newPriceMxn: 1 }, { signal: controller.signal })
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal)
  })
})
