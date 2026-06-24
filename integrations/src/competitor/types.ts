/**
 * The COMPETITOR SOURCE seam — a source-agnostic competitor price interface.
 *
 * Generalizes the Mercado Libre `MLSearchResult` shape into a normalized
 * {@link CompetitorQuote} so the pricing workflow can query MANY competitor
 * sources per SKU (ML, Amazon MX, …) and aggregate them with one policy. Each
 * source (the ML adapter wraps its client; Amazon scrapes) implements
 * {@link CompetitorSource} and MUST fail-soft — a blocked/errored/no-match
 * lookup returns `null`, never throws, so a flaky source can never break a run.
 *
 * (Plan §3.1 — competitor-pricing-sources.md.)
 */

/** A normalized competitor quote, source-agnostic (generalized from MLSearchResult). */
export interface CompetitorQuote {
  /** Source id: 'mercado-libre' | 'amazon-mx' | … (matches {@link CompetitorSource.id}). */
  source: string
  /** The matched competitor listing title (null when the source found no candidate). */
  title: string | null
  /** Lowest usable MXN price the source found (null = no usable price → SKU flags). */
  priceMxn: number | null
  /** Canonical product/listing URL for the quote (audit trail). */
  permalink: string | null
  /** Source-native product/catalog id (e.g. ML catalog_product_id). */
  productId: string | null
  /** Source-native category/domain id. */
  categoryId: string | null
  /** How many candidate listings the source inspected (observability). */
  candidatesChecked: number
  /** Source-specific reason when no usable quote (e.g. 'blocked' | 'no_catalog_match'). */
  failureReason: string | null
  /**
   * ISO-8601 freshness stamp. Stamped by the CALLER (gather loop) from a single
   * run-start timestamp — NOT `Date.now()` inside the source — so the per-source
   * mapping stays pure and tests stay deterministic. Adapters return `''`.
   */
  fetchedAt: string
}

/**
 * A competitor price source. The ML adapter wraps its existing client; the
 * Amazon source scrapes. `lookup` MUST fail-soft: return `null` (never throw)
 * on a block, error, or no-match so one source can never break a run.
 */
export interface CompetitorSource {
  /** Stable source id, mirrored into each {@link CompetitorQuote.source}. */
  readonly id: string
  /**
   * Look up ONE product by query string. MUST fail-soft: resolve to `null`
   * (never reject) on block/error/no-match. The caller paces + stamps freshness.
   */
  lookup(query: string, opts?: { signal?: AbortSignal }): Promise<CompetitorQuote | null>
}
