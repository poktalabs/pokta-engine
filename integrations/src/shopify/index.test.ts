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
    expect(url).toBe(`${CONFIG.baseUrl}/products.json?limit=250`)
    expect(init.headers['X-Shopify-Access-Token']).toBe(CONFIG.accessToken)
  })

  it('honors a custom limit and tolerates a missing products array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    const client = createShopifyClient(CONFIG)
    const catalog = await client.getCatalog({ limit: 50 })

    expect(catalog.products).toEqual([])
    expect(catalog.variantCount).toBe(0)
    expect(fetchMock.mock.calls[0]![0]).toBe(`${CONFIG.baseUrl}/products.json?limit=50`)
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
