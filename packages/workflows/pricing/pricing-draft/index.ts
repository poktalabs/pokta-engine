import type { RunContext } from '@pokta-engine/contract'
import type {
  Catalog,
  ShopifyClient,
  MercadoLibreClient,
  CompetitorSource,
  CompetitorQuote,
} from '@pokta-engine/integrations'
import { mercadoLibreSource } from '@pokta-engine/integrations'

import {
  buildProductIdentityFromShopify,
  type ProductIdentity,
} from '../lib/product-identity.js'
import {
  scoreProductMatch,
  decisionForMatchConfidence,
  type MatchConfidence,
  type MatchDecision,
  type MatchInput,
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
declare module '@pokta-engine/contract' {
  interface IntegrationClients {
    shopify: ShopifyClient
    'mercado-libre': MercadoLibreClient
  }
}

/** Default margin floor (%) when the tenant supplies none — matches lib defaults. */
const DEFAULT_MARGIN_FLOOR_PCT = 15

/** Pause between paced ML lookups (reuses the mi-pase ml-batch sequential pacing). */
const ML_PACE_MS = 250

/** A competitor quote enriched with this SKU's per-quote match scoring. */
export interface QuoteWithMatch extends CompetitorQuote {
  /** This quote's match confidence vs the SKU (null when the quote had no title). */
  matchConfidence: MatchConfidence | null
  /** accept | manual_review | reject for THIS quote (drives the min-accepted policy). */
  matchDecision: MatchDecision
}

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
  /**
   * Match confidence of the CHOSEN competitor (the accepted min); when nothing
   * is accepted, the best-scored candidate. Null when no titled candidate.
   */
  matchConfidence: MatchConfidence | null
  /** accept | manual_review | reject — classifies confident vs flagged (T7). */
  matchDecision: MatchDecision
  /** Why the competitor lookup failed, when it did (surfaced per-SKU, fail-soft). */
  competitorFailureReason: string | null
  /**
   * COMPLETE OUTPUT (additive): every source's quote for this SKU, each scored.
   * The apply chain never reads this — it is the durable, source-of-truth detail
   * the report builders render. (Plan §3.6.)
   */
  quotes: QuoteWithMatch[]
  /** Source that won the chosen competitor_min (null when none was accepted). */
  chosenSource: string | null
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
    /**
     * Per-source yield (additive): for each competitor source, how many SKUs it
     * returned a usable price for (`found`, priceMxn != null) and how many of
     * those its quote was ACCEPTED on (`accepted`). Surfaces coverage so a
     * low-yield source (e.g. Amazon from a datacenter IP) is visible. (Plan §3.6.)
     */
    bySource: Record<string, { found: number; accepted: number }>
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
  /**
   * Per-SKU curated match hints (the client's `palabras_prohibidas` / requeridas),
   * keyed by SKU. Merged into each SKU's forbidden/required terms on top of the
   * generic {@link ACCESSORY_FORBIDDEN_TERMS}. The Shopify catalog read carries no
   * such terms today, so this is how curated exclusions reach the matcher.
   */
  matchHintsBySku?: Record<string, MatchHints>
  /** Test seam: inject a fake state store (the worker never sets this). */
  __stateStore?: WorkflowStateStore
  /**
   * Test seam: inject the run-start timestamp stamped onto every {@link
   * CompetitorQuote.fetchedAt}. The worker never sets this — production uses
   * `new Date().toISOString()` once per run — so tests get a deterministic stamp.
   */
  __now?: string
  /**
   * Test seam: inject the competitor source list, bypassing the env-composed
   * sources (the worker never sets this). Lets a unit test drive a multi-source
   * run — min-accepted aggregation + chosenSource — without a live Amazon source.
   */
  __sources?: CompetitorSource[]
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

/**
 * Generic accessory / non-product terms that almost never describe the actual
 * device being priced — third-party cases, screen protectors, mounts, straps,
 * and used/generic listings. Added to EVERY match's forbidden terms (word-boundary
 * matched) so a scraped "Funda para X" / "Protector de Y" competitor is rejected
 * rather than priced against. Matters most for Amazon, whose search returns far
 * more accessory noise than ML's catalog. Conservative on purpose — only terms
 * that are not themselves products in this catalog.
 */
export const ACCESSORY_FORBIDDEN_TERMS = [
  'funda', 'fundas', 'case', 'carcasa', 'cover', 'protector', 'mica', 'pelicula',
  'película', 'cristal templado', 'soporte', 'tripie', 'tripié', 'montura',
  'correa', 'strap', 'pulsera', 'estuche', 'forro', 'compatible', 'generico',
  'genérico', 'replica', 'réplica', 'usado', 'reacondicionado', 'refurbished',
]

/** Per-SKU curated match hints (the client's palabras_prohibidas / requeridas). */
export interface MatchHints {
  forbidden?: string[]
  required?: string[]
}

/** Build the title-based match target for a SKU (reused to score every quote). */
function buildMatchInput(identity: ProductIdentity, hints?: MatchHints): MatchInput {
  return {
    sku: identity.sku,
    title: identity.title_shopify,
    search_query: searchQueryFor(identity),
    brand: identity.marca_empresa,
    model: identity.modelo_estimado,
    category: identity.categoria_interna,
    barcode: identity.barcode,
    ean: identity.ean,
    gtin: identity.gtin,
    required_terms: [...identity.palabras_requeridas, ...(hints?.required ?? [])],
    // identity terms (empty from Shopify today) + generic accessory blocklist +
    // the client's curated per-SKU exclusions when supplied.
    forbidden_terms: [
      ...identity.palabras_prohibidas,
      ...ACCESSORY_FORBIDDEN_TERMS,
      ...(hints?.forbidden ?? []),
    ],
  }
}

/** Coarse scope filter (M1): substring match over title / vendor / category. */
function matchesScope(identity: ProductIdentity, scope: string | undefined): boolean {
  if (!scope) return true
  const needle = scope.toLowerCase()
  return [identity.title_shopify, identity.vendor_shopify, identity.categoria_interna]
    .some((field) => (field ?? '').toLowerCase().includes(needle))
}

/**
 * Per SKU, query EVERY competitor source and collect their quotes. Sources are
 * independent, so the within-SKU fan-out runs CONCURRENTLY (`Promise.all`) — a
 * sequential per-source loop would multiply wall-clock by the source count and
 * push a multi-source run toward the 20-min draft timeout (plan §3.5, F4). We
 * keep the existing PER-SKU pacing (`ML_PACE_MS` between SKUs) so each source
 * still sees a polite request cadence.
 *
 * Fail-soft (D3) is the source contract: `lookup` resolves to `null` on any
 * block/error/no-match. We do NOT trust that contract blindly — the gather loop
 * ALSO wraps every lookup in `.catch(→ null)` so a source that rejects (or
 * throws synchronously) can never break a run even if it violates the contract.
 * Defense-in-depth matters here because PR2 adds a scraping source far more
 * likely to let an exception escape. A SKU with no usable quote leaves the
 * competitor empty and flags (never invents a price). `fetchedAt` is stamped
 * HERE from a single run-start timestamp (injected, not `Date.now()` per quote)
 * so quotes share one freshness stamp and tests stay deterministic.
 */
async function gatherCompetitors(
  identities: ProductIdentity[],
  sources: CompetitorSource[],
  ctx: RunContext,
  fetchedAt: string,
): Promise<Map<string, CompetitorQuote[]>> {
  const byKey = new Map<string, CompetitorQuote[]>()
  for (let i = 0; i < identities.length; i++) {
    const identity = identities[i]!
    const query = searchQueryFor(identity)
    // Concurrent within-SKU fan-out; each source SHOULD fail soft to null, but
    // the orchestrator enforces it too — a rejecting/throwing source is dropped.
    const settled = await Promise.all(
      sources.map((source) =>
        Promise.resolve()
          .then(() => source.lookup(query))
          .catch((e: unknown) => {
            ctx.logger.error(
              `pricing-draft: source ${source.id} threw for ${identity.sku} (${(e as Error).message}); dropping`,
            )
            return null
          }),
      ),
    )
    const quotes = settled
      .filter((q): q is CompetitorQuote => q != null)
      .map((q) => ({ ...q, fetchedAt }))
    if (quotes.length === 0) {
      ctx.logger.info(`pricing-draft: no competitor quotes for ${identity.sku}; flagging`)
    }
    byKey.set(identity.sku, quotes)
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
  // Price the live storefront only (status: 'active') and let the client
  // auto-paginate — a single 250-cap page would silently drop a larger catalog.
  const catalog: Catalog = await shopify.getCatalog({ status: 'active' })

  // 2. Build enriched identities (one per priced variant), apply scope + limit.
  let identities: ProductIdentity[] = []
  for (const product of catalog.products) {
    for (const variant of product.variants ?? []) {
      const identity = buildProductIdentityFromShopify(product, variant)
      if (identity && matchesScope(identity, input.scope)) identities.push(identity)
    }
  }
  if (input.limit != null) identities = identities.slice(0, input.limit)

  // 3. Compose the active competitor sources (plan §3.4): the workflow builds the
  //    list explicitly, each via try/catch so an unconfigured/failing source is
  //    simply omitted (fail-soft). Provider factories resolve SYNCHRONOUSLY, so
  //    there is no DB read here — per-tenant DB-driven selection is a fast-follow.
  //    PR1 ships ML only; the Amazon MX source slots in here in PR2.
  const sources: CompetitorSource[] = input.__sources ?? []
  if (!input.__sources) {
    try {
      sources.push(mercadoLibreSource(ctx.integration('mercado-libre')))
    } catch (e) {
      ctx.logger.info(`pricing-draft: mercado-libre unavailable (${(e as Error).message}); skipping`)
    }
    // Amazon MX is opt-in per tenant: ctx.integration throws when disabled/
    // unconfigured → the source is simply omitted (fail-soft, plan §3.4). When
    // enabled it resolves to a CompetitorSource directly (no adapter needed).
    try {
      sources.push(ctx.integration('amazon-mx'))
    } catch (e) {
      ctx.logger.info(`pricing-draft: amazon-mx unavailable (${(e as Error).message}); skipping`)
    }
  }

  // 4. Paced, concurrent-per-SKU competitor lookups (fail-soft per source per SKU).
  //    Stamp one run-start timestamp onto every quote (injectable for tests).
  const fetchedAt = input.__now ?? new Date().toISOString()
  const competitors = await gatherCompetitors(identities, sources, ctx, fetchedAt)

  // 5. Pure brain: per SKU, score EACH source's quote, aggregate by the default
  //    policy (competitor_min = min across ACCEPTED high-confidence quotes from
  //    ANY source), run the 8-branch price, classify into confident | flagged.
  const confident: PricingSkuResult[] = []
  const flagged: PricingSkuResult[] = []
  const desiredRows: DesiredRow[] = []
  const aggregateRows: PricingRow[] = []
  let competitorMissCount = 0
  // Per-source yield, seeded so every ACTIVE source appears even at zero yield.
  const bySource: Record<string, { found: number; accepted: number }> = {}
  for (const source of sources) bySource[source.id] = { found: 0, accepted: 0 }

  for (const identity of identities) {
    const quotes = competitors.get(identity.sku) ?? []
    const matchInput = buildMatchInput(identity, input.matchHintsBySku?.[identity.sku])

    // Score every quote independently — a quote without a title can't be matched.
    const scored = quotes.map((quote) => {
      const match = quote.title ? scoreProductMatch(matchInput, quote.title) : null
      const confidence: MatchConfidence | null = match?.confidence ?? null
      return { quote, confidence, decision: decisionForMatchConfidence(confidence) }
    })

    // Tally per-source yield: a usable price found, and whether it was accepted.
    for (const s of scored) {
      const entry = (bySource[s.quote.source] ??= { found: 0, accepted: 0 })
      if (s.quote.priceMxn != null) {
        entry.found++
        if (s.decision === 'accept') entry.accepted++
      }
    }

    // Default aggregation policy: competitor_min = the LOWEST price among ACCEPTED
    // (high-confidence) quotes from any source; the chosen source won that min.
    const accepted = scored.filter((s) => s.decision === 'accept' && s.quote.priceMxn != null)
    const chosen = accepted.reduce<(typeof accepted)[number] | null>(
      (best, s) => (best == null || s.quote.priceMxn! < best.quote.priceMxn! ? s : best),
      null,
    )
    const competitorMinMxn = chosen?.quote.priceMxn ?? null

    // competitorMiss = no source returned ANY price quote at all (preserves the
    // prior "no competitor found" count — independent of match acceptance).
    if (!quotes.some((q) => q.priceMxn != null)) competitorMissCount++

    // Single-field match summary (output shape unchanged in P1): the accepted
    // winner when there is one, else the best-scored candidate, else null.
    const representative = chosen ?? scored.find((s) => s.confidence != null) ?? scored[0] ?? null
    const matchConfidence: MatchConfidence | null = representative?.confidence ?? null
    const matchDecision = decisionForMatchConfidence(matchConfidence)

    // Why the competitor lookup yielded no usable price, when it didn't: the
    // first source-reported failure reason, or 'ml_lookup_error' if every source
    // failed soft to nothing (no quote at all).
    const competitorFailureReason =
      quotes.length === 0
        ? 'ml_lookup_error'
        : (quotes.find((q) => q.failureReason)?.failureReason ?? null)

    // competitorMinMxn is ALREADY the min across accepted quotes, so it is the
    // trusted competitor; a SKU with nothing accepted prices WITHOUT one and
    // lands in the manual/flagged lane via the 8-branch logic.
    const trustedCompetitor = competitorMinMxn
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
      // Complete output (additive): every scored quote + who won the chosen min.
      quotes: scored.map((s) => ({
        ...s.quote,
        matchConfidence: s.confidence,
        matchDecision: s.decision,
      })),
      chosenSource: chosen?.quote.source ?? null,
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

  // 6. The ONE durable side effect (D5): upsert desired rows (status=pending).
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
      bySource,
    },
    confident,
    flagged,
  }
}
