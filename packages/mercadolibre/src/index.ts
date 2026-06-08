/**
 * Mercado Libre MX catalog client (fail-soft integration, D3/D4).
 *
 * Ported VERBATIM-in-spirit from mi-pase/.../ml-api-client.ts. The brain is
 * unchanged — the catalog-search → lowest-MXN-item strategy and every
 * failure_reason are preserved. The shell is rewritten for the engine seam:
 *
 *   - Config (tokens + OAuth credentials) is passed IN via `createMercadoLibreClient`
 *     (D2 — no process.env; narrow the secret blast radius).
 *   - `createMercadoLibreClient({})` with no access token THROWS 'not configured'.
 *   - On ML 403 / empty catalog / no-MXN price the client returns a CLEAN EMPTY
 *     result with a failure_reason — it NEVER invents a price. The workflow reads
 *     `price_mxn === null` and flags the SKU (fail-soft).
 *   - On 401 the client refreshes the access token (if a refresh token + OAuth
 *     credentials were supplied) and retries once.
 *
 * Flow (live prices):
 *   1. Search the catalog with /products/search?site_id=MLM.
 *   2. Read marketplace listings for the best catalog product via /products/{id}/items.
 *   This avoids /sites/MLM/search?q=..., which can 403 broad marketplace searches.
 */

import {
  refreshAccessToken,
  type MLOAuthConfig,
  type MLTokenResponse,
} from './oauth.js'

export type { MLOAuthConfig, MLTokenResponse } from './oauth.js'
export { refreshAccessToken } from './oauth.js'

export type MLFailureReason =
  | 'no_catalog_match'
  | 'catalog_products_without_winners'
  | 'catalog_items_found_but_no_mxn_price'
  | 'catalog_products_without_items'
  | 'access_forbidden'

export interface MLSearchResult {
  query: string
  title: string | null
  price_mxn: number | null
  permalink: string | null
  catalog_product_id: string | null
  item_id: string | null
  category_id: string | null
  match_strategy: 'catalog_search_lowest_mxn_item'
  candidates_checked: number
  failure_reason: MLFailureReason | null
  raw_response_summary: { results_count: number; first_id: string | null }
}

/** Caller-supplied config (D2). Tokens + OAuth creds passed in, never read from env. */
export interface MercadoLibreConfig {
  /** OAuth bearer token for ML API calls. Required — absent => 'not configured'. */
  accessToken?: string
  /** Refresh token; enables the 401 → refresh → retry-once path. */
  refreshToken?: string
  /** App credentials used to refresh the access token on 401. */
  oauth?: MLOAuthConfig
}

export interface SearchOptions {
  limit?: number
  signal?: AbortSignal
}

export interface MercadoLibreClient {
  /** True when an access token is present. */
  configured: boolean
  /** ML MX catalog search. Returns a clean empty result (never invents a price) on 403/empty/non-MXN. */
  search(query: string, opts?: SearchOptions): Promise<MLSearchResult>
}

const ML_PRODUCTS_SEARCH_BASE = 'https://api.mercadolibre.com/products/search'
const ML_PRODUCT_DETAIL_BASE = 'https://api.mercadolibre.com/products'
const USER_AGENT = 'godin-engine/0.1 (godinez.ai)'
const MATCH_STRATEGY = 'catalog_search_lowest_mxn_item' as const

class MLApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`ML API returned HTTP ${status} for URL: ${url} -- ${body}`)
  }
}

interface CatalogProduct {
  id: string
  catalog_product_id?: string
  name?: string
  status?: string
  domain_id?: string
  category_id?: string
}

interface CatalogItemsBody {
  results?: Array<{
    item_id: string
    price: number
    currency_id: string
    condition?: string
    site_id?: string
  }>
  paging?: { total: number; limit: number; offset: number }
}

function buildHeaders(accessToken: string): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  }
}

function emptyResult(
  query: string,
  failureReason: MLFailureReason,
  overrides: Partial<MLSearchResult> = {},
): MLSearchResult {
  return {
    query,
    title: null,
    price_mxn: null,
    permalink: null,
    catalog_product_id: null,
    item_id: null,
    category_id: null,
    match_strategy: MATCH_STRATEGY,
    candidates_checked: 0,
    failure_reason: failureReason,
    raw_response_summary: { results_count: 0, first_id: null },
    ...overrides,
  }
}

/**
 * Create a Mercado Libre client. Config is supplied by the CALLER (D2). Throws
 * 'not configured' when no access token is present — the workflow catches and
 * records an IntegrationResult (fail-soft, D3).
 */
export function createMercadoLibreClient(config: MercadoLibreConfig): MercadoLibreClient {
  // Token is mutable so the 401 → refresh path can swap it in for the retry.
  let accessToken = config.accessToken ?? ''
  const configured = accessToken.length > 0

  function assertConfigured(): void {
    if (!configured) {
      throw new Error(
        'Mercado Libre not configured (accessToken required; pass tokens via createMercadoLibreClient)',
      )
    }
  }

  async function fetchResponse(url: string, opts?: SearchOptions): Promise<Response> {
    return fetch(url, { headers: buildHeaders(accessToken), signal: opts?.signal })
  }

  async function fetchJson<T>(url: string, opts?: SearchOptions): Promise<T> {
    const response = await fetchResponse(url, opts)
    if (!response.ok) {
      throw new MLApiError(response.status, url, await response.text())
    }
    return (await response.json()) as T
  }

  /** Fetch catalog items; null when ML reports "No winners found" (404). */
  async function fetchCatalogItems(
    productId: string,
    opts?: SearchOptions,
  ): Promise<CatalogItemsBody | null> {
    const itemsUrl = `${ML_PRODUCT_DETAIL_BASE}/${encodeURIComponent(productId)}/items`
    const response = await fetchResponse(itemsUrl, opts)
    if (response.status === 404) {
      const body = await response.text()
      if (body.includes('No winners found')) return null
      throw new MLApiError(response.status, itemsUrl, body)
    }
    if (!response.ok) {
      throw new MLApiError(response.status, itemsUrl, await response.text())
    }
    return (await response.json()) as CatalogItemsBody
  }

  async function searchOnce(query: string, opts?: SearchOptions): Promise<MLSearchResult> {
    const limit = opts?.limit ?? 5
    const productSearchUrl = `${ML_PRODUCTS_SEARCH_BASE}?site_id=MLM&q=${encodeURIComponent(query)}&limit=${limit}`

    const productBody = await fetchJson<{ results?: CatalogProduct[]; paging?: { total: number } }>(
      productSearchUrl,
      opts,
    )

    const products = productBody.results ?? []
    // Prefer active catalog products, then fall back to the rest (original order).
    const candidates = [
      ...products.filter((p) => p.status === 'active'),
      ...products.filter((p) => p.status !== 'active'),
    ]

    if (candidates.length === 0) {
      return emptyResult(query, 'no_catalog_match')
    }

    let candidatesChecked = 0
    let firstCatalogId: string | null = null
    let firstTitle: string | null = null
    let sawNoWinners = false
    let sawItemsWithoutMxn = false
    let sawEmptyItems = false

    for (const product of candidates) {
      const productId = product.catalog_product_id ?? product.id
      firstCatalogId ??= productId
      firstTitle ??= product.name ?? null
      candidatesChecked++

      const itemsBody = await fetchCatalogItems(productId, opts)
      if (!itemsBody) {
        sawNoWinners = true
        continue
      }

      const items = itemsBody.results ?? []
      if (items.length === 0) {
        sawEmptyItems = true
        continue
      }

      // Only MXN-priced items count — never invent a price from another currency.
      const mxnItems = items
        .filter((item) => item.currency_id === 'MXN' && typeof item.price === 'number')
        .sort((a, b) => a.price - b.price)
      const bestItem = mxnItems[0] ?? null

      if (!bestItem) {
        sawItemsWithoutMxn = true
        continue
      }

      return {
        query,
        title: product.name ?? null,
        price_mxn: bestItem.price,
        permalink: `https://articulo.mercadolibre.com.mx/${bestItem.item_id}`,
        catalog_product_id: productId,
        item_id: bestItem.item_id,
        category_id: product.category_id ?? null,
        match_strategy: MATCH_STRATEGY,
        candidates_checked: candidatesChecked,
        failure_reason: null,
        raw_response_summary: {
          results_count: itemsBody.paging?.total ?? mxnItems.length,
          first_id: bestItem.item_id,
        },
      }
    }

    const failure_reason: MLFailureReason = sawItemsWithoutMxn
      ? 'catalog_items_found_but_no_mxn_price'
      : sawNoWinners
        ? 'catalog_products_without_winners'
        : sawEmptyItems
          ? 'catalog_products_without_items'
          : 'no_catalog_match'

    return emptyResult(query, failure_reason, {
      title: firstTitle,
      catalog_product_id: firstCatalogId,
      candidates_checked: candidatesChecked,
      raw_response_summary: { results_count: 0, first_id: firstCatalogId },
    })
  }

  async function search(query: string, opts?: SearchOptions): Promise<MLSearchResult> {
    assertConfigured()
    try {
      return await searchOnce(query, opts)
    } catch (err) {
      // 403: do NOT invent prices — return a clean empty result, SKU gets flagged.
      if (err instanceof MLApiError && err.status === 403) {
        return emptyResult(query, 'access_forbidden')
      }
      // 401: refresh the token (if we can) and retry exactly once.
      if (err instanceof MLApiError && err.status === 401 && canRefresh()) {
        const refreshed = await refreshAccessToken(config.refreshToken as string, config.oauth as MLOAuthConfig)
        accessToken = refreshed.access_token
        try {
          return await searchOnce(query, opts)
        } catch (retryErr) {
          if (retryErr instanceof MLApiError && retryErr.status === 403) {
            return emptyResult(query, 'access_forbidden')
          }
          throw retryErr
        }
      }
      throw err
    }
  }

  function canRefresh(): boolean {
    return Boolean(config.refreshToken && config.oauth?.clientId && config.oauth?.clientSecret)
  }

  return { configured, search }
}
