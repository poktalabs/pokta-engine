/**
 * Mercado Libre as a {@link CompetitorSource} (plan §3.2).
 *
 * Wraps the existing {@link MercadoLibreClient} (UNCHANGED) into the
 * source-agnostic seam: map `MLSearchResult` → {@link CompetitorQuote}. The
 * underlying client already fails soft on 403/empty/non-MXN (it returns a clean
 * empty result with a `failure_reason`, never invents a price); this adapter
 * ALSO catches any thrown error and resolves to `null` so the seam's fail-soft
 * contract holds unconditionally — a flaky ML call can never break a run.
 *
 * `fetchedAt` is left `''` here and stamped by the caller (the gather loop) from
 * a single run-start timestamp, keeping this mapping pure + deterministic.
 */

import type { CompetitorSource, CompetitorQuote } from '../competitor/types.js'
import type { MercadoLibreClient } from './index.js'

/** Adapt a {@link MercadoLibreClient} into a {@link CompetitorSource}. */
export function mercadoLibreSource(client: MercadoLibreClient): CompetitorSource {
  return {
    id: 'mercado-libre',
    async lookup(query, opts): Promise<CompetitorQuote | null> {
      try {
        const r = await client.search(query, { signal: opts?.signal })
        return {
          source: 'mercado-libre',
          title: r.title,
          priceMxn: r.price_mxn,
          permalink: r.permalink,
          productId: r.catalog_product_id,
          categoryId: r.category_id,
          candidatesChecked: r.candidates_checked,
          failureReason: r.failure_reason,
          fetchedAt: '', // stamped by the caller
        }
      } catch {
        return null // fail-soft: never throw into the run
      }
    },
  }
}
