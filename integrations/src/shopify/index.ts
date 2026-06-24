/**
 * Shopify Admin API integration client (fail-soft, D3).
 *
 * Mirrors the `packages/notion` / `packages/resend` discipline: throws when
 * unconfigured or on API error, and the CALLER owns the fallback. The workflow
 * (pricing-draft / pricing-apply) wraps each call in try/catch and records an
 * `IntegrationResult` — this module never returns a failure shape, it throws.
 *
 * DIFFERS from notion/resend in ONE way (D2): config is NOT read from
 * `process.env` here. The worker's per-tenant integration resolver
 * (`ctx.integration('shopify')`, keyed by `run.consumer_id`) supplies the
 * `ShopifyConfig` so secrets are scoped per tenant, not process-global. Pass
 * the config into `createShopifyClient(config)` to get a client; missing config
 * makes the factory throw a clear 'not configured' error.
 *
 * Ported from mi-pase `shopify-client.ts` (read) + `shopify-write.ts` (write).
 * The mi-pase originals read `SHOPIFY_BASE_URL` / `SHOPIFY_ACCESS_TOKEN` from
 * env; here those become the injected `baseUrl` / `accessToken` config fields.
 */

/** Per-tenant Shopify Admin API config, supplied by the worker's resolver. */
export interface ShopifyConfig {
  /** Admin API base, e.g. `https://my-shop.myshopify.com/admin/api/2024-04`. */
  baseUrl: string
  /** Shopify Admin API access token (`X-Shopify-Access-Token`). */
  accessToken: string
}

/** A Shopify product variant (read shape). */
export interface ShopifyVariant {
  id: number
  sku: string | null
  title?: string | null
  price: string
  barcode?: string | null
}

/** A Shopify product with its variants (read shape). */
export interface ShopifyProduct {
  id: number
  title: string
  vendor?: string | null
  product_type?: string | null
  variants: ShopifyVariant[]
}

/** Input for a single variant price write. */
export interface VariantPriceUpdate {
  /** Shopify variant id. */
  variantId: number
  /** New price in MXN (formatted to 2dp on the wire). */
  newPriceMxn: number
}

/** The variant as returned by Shopify after a successful price write. */
export interface UpdatedVariant {
  id: number
  price: string
  updatedAt: string
}

/**
 * Error thrown for non-2xx Shopify responses. `status` lets the caller branch
 * (e.g. 429 rate-limit → back off + retry; 422 → record per-SKU failure). The
 * caller still treats every throw as a fail-soft outcome (D3).
 */
export class ShopifyApiError extends Error {
  readonly status: number
  readonly body: string
  /** Seconds to wait before retry, parsed from `Retry-After` (429 only). */
  readonly retryAfterSeconds?: number

  constructor(status: number, body: string, retryAfterSeconds?: number) {
    super(`Shopify API error ${status}: ${body}`)
    this.name = 'ShopifyApiError'
    this.status = status
    this.body = body
    this.retryAfterSeconds = retryAfterSeconds
  }

  /** True for HTTP 429 (Shopify Admin API rate limit). */
  get isRateLimited(): boolean {
    return this.status === 429
  }
}

function assertConfigured(config: ShopifyConfig | null | undefined): asserts config is ShopifyConfig {
  if (!config || !config.baseUrl || !config.accessToken) {
    throw new Error(
      'Shopify not configured (resolver must supply baseUrl / accessToken for this tenant)'
    )
  }
}

function parseRetryAfter(res: Response): number | undefined {
  const header = res.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) ? seconds : undefined
}

/**
 * Parse the `rel="next"` cursor URL from a Shopify `Link` response header.
 * Shopify Admin REST uses cursor pagination: each page response carries a
 * `Link: <…page_info=…>; rel="next"` header until the last page (no `next`).
 * The next URL is absolute and already encodes the original query context
 * (status filter, page size) inside `page_info`, so we just follow it verbatim.
 */
function parseNextLink(res: Response): string | null {
  const link = res.headers.get('link')
  if (!link) return null
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (m) return m[1]!
  }
  return null
}

/** Result of {@link ShopifyClient.getCatalog}. */
export interface Catalog {
  products: ShopifyProduct[]
  /** Convenience: total variant count across all products. */
  variantCount: number
}

export interface ShopifyClient {
  /**
   * Read products + their variants, AUTO-PAGINATING the full catalog (the
   * Shopify Admin REST page cap is 250/request; this follows the `Link` cursor
   * until exhausted). Defaults to `status: 'active'` so callers price the live
   * storefront, not unpublished drafts.
   */
  getCatalog(opts?: {
    /** Page size per request (Shopify max 250); all pages are fetched regardless. */
    limit?: number
    /** Product statuses to include. Defaults to `'active'`; `'any'` = no filter. */
    status?: 'active' | 'archived' | 'draft' | 'any'
    /** Safety cap on pages followed (default 50 → up to 12,500 products). */
    maxPages?: number
    signal?: AbortSignal
  }): Promise<Catalog>
  /** PUT a single variant's price. Throws {@link ShopifyApiError} on non-2xx. */
  updateVariantPrice(
    update: VariantPriceUpdate,
    opts?: { signal?: AbortSignal }
  ): Promise<UpdatedVariant>
}

/**
 * Create a Shopify client bound to one tenant's config. THROWS immediately when
 * config is missing — the resolver should only call this once it has resolved a
 * tenant's secrets. (Matches the notion/resend `getClient()` throw discipline,
 * but config is injected rather than env-read — D2.)
 */
export function createShopifyClient(config: ShopifyConfig): ShopifyClient {
  assertConfigured(config)
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  const headers = {
    'X-Shopify-Access-Token': config.accessToken,
    'Content-Type': 'application/json',
  }

  // Low-level fetch that returns the raw Response (callers needing pagination
  // headers use this). Throws ShopifyApiError on non-2xx. An absolute `endpoint`
  // (the `Link` cursor URL) is used verbatim; a relative one is prefixed.
  async function rawFetch(
    endpoint: string,
    init?: RequestInit & { signal?: AbortSignal }
  ): Promise<Response> {
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ShopifyApiError(res.status, body, parseRetryAfter(res))
    }

    return res
  }

  async function shopifyFetch<T>(
    endpoint: string,
    init?: RequestInit & { signal?: AbortSignal }
  ): Promise<T> {
    const res = await rawFetch(endpoint, init)
    return res.json() as Promise<T>
  }

  return {
    async getCatalog(opts) {
      const pageSize = Math.min(opts?.limit ?? 250, 250)
      const status = opts?.status ?? 'active'
      const maxPages = opts?.maxPages ?? 50
      // First request carries the filters; subsequent pages follow the `Link`
      // cursor URL verbatim (Shopify forbids re-sending filters alongside
      // page_info — the cursor already encodes them).
      const params = new URLSearchParams({ limit: String(pageSize) })
      if (status !== 'any') params.set('status', status)

      let next: string | null = `/products.json?${params.toString()}`
      const products: ShopifyProduct[] = []
      let pages = 0
      while (next && pages < maxPages) {
        const res = await rawFetch(next, { signal: opts?.signal })
        const body = (await res.json()) as { products?: ShopifyProduct[] }
        products.push(...(body.products ?? []))
        next = parseNextLink(res)
        pages += 1
      }

      const variantCount = products.reduce((sum, p) => sum + (p.variants?.length ?? 0), 0)
      return { products, variantCount }
    },

    async updateVariantPrice(update, opts) {
      const body = {
        variant: {
          id: update.variantId,
          price: update.newPriceMxn.toFixed(2),
        },
      }
      const json = await shopifyFetch<{ variant: { id: number; price: string; updated_at: string } }>(
        `/variants/${update.variantId}.json`,
        { method: 'PUT', body: JSON.stringify(body), signal: opts?.signal }
      )
      const v = json.variant
      return { id: v.id, price: v.price, updatedAt: v.updated_at }
    },
  }
}
