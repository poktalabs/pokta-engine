import type { RunContext } from '@godin-engine/contract'
import type {
  Catalog,
  ShopifyClient,
  MercadoLibreClient,
  MLSearchResult,
} from '@godin-engine/integrations'

import {
  buildProductIdentityFromShopify,
  type ProductIdentity,
} from '../lib/product-identity.js'
import {
  scoreProductMatch,
  decisionForMatchConfidence,
  type MatchConfidence,
  type MatchDecision,
} from '../lib/matching-score.js'
import {
  computeSuggestedPrice,
  type Decision,
} from '../lib/pricing-logic.js'
import { computeAggregates, type PricingRow } from '../lib/aggregates.js'

import type { PricingDraftInput } from './manifest.js'
import {
  createDbWorkflowStateStore,
  desiredHash,
  type DesiredRow,
  type WorkflowStateStore,
} from './state-store.js'

/**
 * Type the per-tenant integration clients this workflow asks for (D2). Until the
 * worker's provider plug-ins register their declaration merge (T9), the contract
 * resolves integration names to `unknown`; this augmentation gives `pricing-draft`
 * precise `shopify` / `mercado-libre` client types WITHOUT the contract importing
 * either package. (Last-write-wins module augmentation; matches the seam doc.)
 */
declare module '@godin-engine/contract' {
  interface IntegrationClients {
    shopify: ShopifyClient
    'mercado-libre': MercadoLibreClient
  }
}

/** Default margin floor (%) when the tenant supplies none — matches lib defaults. */
const DEFAULT_MARGIN_FLOOR_PCT = 15

/** Pause between paced ML lookups (reuses the mi-pase ml-batch sequential pacing). */
const ML_PACE_MS = 250

/** A single SKU's full pricing outcome (the rich detail lives in state, not output). */
export interface PricingSkuResult {
  sku: string
  title: string
  shopifyVariantId: number
  currentPriceMxn: number
  competitorMinMxn: number | null
  suggestedPriceMxn: number | null
  decision: Decision
  reason: string
  /** Match confidence of the ML competitor (null when ML returned no usable price). */
  matchConfidence: MatchConfidence | null
  /** accept | manual_review | reject — classifies confident vs flagged (T7). */
  matchDecision: MatchDecision
  /** Why the competitor lookup failed, when it did (surfaced per-SKU, fail-soft). */
  competitorFailureReason: string | null
}

export interface PricingDraftOutput {
  /**
   * Carried at the TOP LEVEL (not just in `summary`) because the worker feeds this
   * whole output as the input of BOTH apply children (onComplete → confident,
   * onApprove → flagged), and `pricing-apply` reads `input.consumerId` to scope
   * its Shopify writes + state. Without this the chained apply would have no
   * tenant. (Caught by the T10 integration test driving the real chain.)
   */
  consumerId: string
  summary: {
    consumerId: string
    totalSkus: number
    confidentCount: number
    flaggedCount: number
    competitorMissCount: number
    aggregates: ReturnType<typeof computeAggregates>
  }
  /** Carried to `pricing-apply-confident` via onComplete (NO gate). */
  confident: PricingSkuResult[]
  /** Carried to `pricing-apply-flagged` via the approval gate artifact. */
  flagged: PricingSkuResult[]
}

/** Internal carrier for the optional injected store (tests) — never request data. */
type PricingDraftRunInput = PricingDraftInput & {
  /** Margin floor override; defaults to {@link DEFAULT_MARGIN_FLOOR_PCT}. */
  marginFloorPct?: number
  /**
   * Per-SKU cost (MXN) keyed by SKU. The Shopify catalog read does NOT carry
   * cost in M1 (it lives on a separate inventory_item endpoint / cost store that
   * is deferred — see the plan's NOT-in-scope). When cost is absent the 8-branch
   * logic routes a known-competitor SKU to `manual_review` (→ flagged), which is
   * the correct conservative M1 default. Supplying cost here lets a SKU become
   * CONFIDENT once the cost seam is wired.
   */
  costBySku?: Record<string, number | null>
  /** Test seam: inject a fake state store (the worker never sets this). */
  __stateStore?: WorkflowStateStore
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Build the ML search query for a SKU from its enriched identity. */
function searchQueryFor(identity: ProductIdentity): string {
  return [identity.marca_empresa, identity.modelo_estimado, identity.title_shopify]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Coarse scope filter (M1): substring match over title / vendor / category. */
function matchesScope(identity: ProductIdentity, scope: string | undefined): boolean {
  if (!scope) return true
  const needle = scope.toLowerCase()
  return [identity.title_shopify, identity.vendor_shopify, identity.categoria_interna]
    .some((field) => (field ?? '').toLowerCase().includes(needle))
}

/**
 * Read the catalog, build identities, then PACE one ML competitor lookup per SKU
 * (sequential + small delay, reusing the ml-batch pacing discipline). ML failures
 * are fail-soft (D3): a thrown ML error or a no-price result leaves the
 * competitor empty and the SKU flagged — never invents a price.
 */
async function gatherCompetitors(
  identities: ProductIdentity[],
  ml: MercadoLibreClient,
  ctx: RunContext,
): Promise<Map<string, MLSearchResult | null>> {
  const byKey = new Map<string, MLSearchResult | null>()
  for (let i = 0; i < identities.length; i++) {
    const identity = identities[i]!
    const query = searchQueryFor(identity)
    try {
      byKey.set(identity.sku, await ml.search(query))
    } catch (e) {
      // Fail-soft: any ML failure (403/transient) → no competitor → SKU flagged.
      ctx.logger.info(
        `pricing-draft: ML lookup failed for ${identity.sku} (${(e as Error).message}); flagging`,
      )
      byKey.set(identity.sku, null)
    }
    if (i < identities.length - 1) await delay(ML_PACE_MS)
  }
  return byKey
}

export async function run(
  rawInput: PricingDraftInput,
  ctx: RunContext,
): Promise<PricingDraftOutput> {
  const input = rawInput as PricingDraftRunInput
  const consumerId = input.consumerId
  if (!consumerId) {
    throw new Error('pricing-draft: consumerId is required (resolved from the run record)')
  }
  const marginFloorPct = input.marginFloorPct ?? DEFAULT_MARGIN_FLOOR_PCT

  // 1. Read the Shopify catalog. This is the work source; if it cannot be read
  //    there is nothing to price, so let the failure mark the run failed (the
  //    per-SKU fail-soft applies to the ML competitor lookup, not the catalog).
  const shopify = ctx.integration('shopify')
  const catalog: Catalog = await shopify.getCatalog()

  // 2. Build enriched identities (one per priced variant), apply scope + limit.
  let identities: ProductIdentity[] = []
  for (const product of catalog.products) {
    for (const variant of product.variants ?? []) {
      const identity = buildProductIdentityFromShopify(product, variant)
      if (identity && matchesScope(identity, input.scope)) identities.push(identity)
    }
  }
  if (input.limit != null) identities = identities.slice(0, input.limit)

  // 3. Paced ML competitor lookups (fail-soft per SKU).
  const ml = ctx.integration('mercado-libre')
  const competitors = await gatherCompetitors(identities, ml, ctx)

  // 4. Pure brain: match → 8-branch price → classify into confident | flagged.
  const confident: PricingSkuResult[] = []
  const flagged: PricingSkuResult[] = []
  const desiredRows: DesiredRow[] = []
  const aggregateRows: PricingRow[] = []
  let competitorMissCount = 0

  for (const identity of identities) {
    const competitor = competitors.get(identity.sku) ?? null
    const competitorMinMxn = competitor?.price_mxn ?? null
    const competitorFailureReason = competitor?.failure_reason ?? (competitor ? null : 'ml_lookup_error')
    if (competitorMinMxn == null) competitorMissCount++

    // Match confidence: only meaningful when ML returned a titled candidate.
    const match = competitor?.title
      ? scoreProductMatch(
          {
            sku: identity.sku,
            title: identity.title_shopify,
            search_query: searchQueryFor(identity),
            brand: identity.marca_empresa,
            model: identity.modelo_estimado,
            category: identity.categoria_interna,
            barcode: identity.barcode,
            ean: identity.ean,
            gtin: identity.gtin,
            required_terms: identity.palabras_requeridas,
            forbidden_terms: identity.palabras_prohibidas,
          },
          competitor.title,
        )
      : null
    const matchConfidence: MatchConfidence | null = match?.confidence ?? null
    const matchDecision = decisionForMatchConfidence(matchConfidence)

    // Only trust a competitor price the match accepts — otherwise price WITHOUT
    // it (the SKU lands in the manual/flagged lane via the 8-branch logic).
    const trustedCompetitor = matchDecision === 'accept' ? competitorMinMxn : null
    const costMxn = input.costBySku?.[identity.sku] ?? null

    const priced = computeSuggestedPrice({
      sku: identity.sku,
      current_price_mxn: identity.price_mipase,
      cost_mxn: costMxn,
      competitor_min_mxn: trustedCompetitor,
      margin_floor_pct: marginFloorPct,
    })

    const result: PricingSkuResult = {
      sku: identity.sku,
      title: identity.title_shopify,
      shopifyVariantId: identity.shopify_variant_id,
      currentPriceMxn: identity.price_mipase,
      competitorMinMxn,
      suggestedPriceMxn: priced.suggested_price_mxn,
      decision: priced.decision,
      reason: priced.reason,
      matchConfidence,
      matchDecision,
      competitorFailureReason: competitorFailureReason ?? null,
    }

    // CONFIDENT iff the match is accepted AND the 8-branch produced an actionable
    // target; everything else (low/medium match, competitor miss, manual_review)
    // is FLAGGED for human review (T7 classification).
    const isConfident =
      matchDecision === 'accept' &&
      priced.decision !== 'manual_review' &&
      priced.decision !== 'skipped'
    if (isConfident) confident.push(result)
    else flagged.push(result)

    desiredRows.push({
      consumerId,
      sku: identity.sku,
      desiredPrice: priced.suggested_price_mxn,
      desiredHash: desiredHash({
        sku: identity.sku,
        currentPriceMxn: identity.price_mipase,
        costMxn,
        competitorMinMxn: trustedCompetitor,
        marginFloorPct,
      }),
      priorShopify: identity.price_mipase,
      sourceRunId: ctx.runId,
    })

    aggregateRows.push({
      sku: identity.sku,
      current_price_mxn: identity.price_mipase,
      suggested_price_mxn: priced.suggested_price_mxn,
      decision: priced.decision,
      status: priced.decision === 'skipped' ? 'skipped' : 'ok',
    })
  }

  // 5. The ONE durable side effect (D5): upsert desired rows (status=pending).
  const store = input.__stateStore ?? (await createDbWorkflowStateStore())
  await store.upsertDesired(desiredRows)
  ctx.logger.info(
    `pricing-draft: priced ${identities.length} SKUs — ${confident.length} confident, ${flagged.length} flagged`,
  )

  return {
    consumerId,
    summary: {
      consumerId,
      totalSkus: identities.length,
      confidentCount: confident.length,
      flaggedCount: flagged.length,
      competitorMissCount,
      aggregates: computeAggregates(aggregateRows),
    },
    confident,
    flagged,
  }
}
