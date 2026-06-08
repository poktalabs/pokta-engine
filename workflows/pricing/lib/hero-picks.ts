/**
 * Hero SKU pre-pick — top-N candidates by pricing impact.
 *
 * Pure function over pricing rows. No side effects, no I/O.
 * Used by run-hero-picks.ts to pre-answer TASK-005 (hero SKU set for Rodrigo).
 */

import type { Decision } from './pricing-logic.js';

export type HeroPickRow = {
  sku: string;
  title: string;
  current_price_mxn: number;
  suggested_price_mxn: number | null;
  decision: Decision;
  abs_reduction_mxn: number;    // current - suggested (0 if no reduction)
  pct_reduction: number;         // (current - suggested) / current, rounded to 4 decimals
};

export type HeroPicks = {
  top_by_abs_reduction: HeroPickRow[];   // length up to N, sorted desc by abs_reduction_mxn
  top_by_pct_reduction: HeroPickRow[];   // length up to N, sorted desc by pct_reduction
  intersection: HeroPickRow[];           // SKUs in BOTH top lists (the safest picks), preserving abs-list order
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Pick top-N hero SKUs from a list of pricing rows.
 *
 * Only considers rows where decision === 'lower_to_competitor' AND
 * suggested_price_mxn != null. Returns the top candidates by absolute price
 * reduction (MXN) and by percentage reduction, plus their intersection.
 */
export function pickHeroes(
  rows: Array<{
    sku: string;
    title: string;
    current_price_mxn: number;
    suggested_price_mxn: number | null;
    decision: Decision;
  }>,
  n: number = 7
): HeroPicks {
  // Filter to qualifying rows only
  const qualifying: HeroPickRow[] = rows
    .filter(
      (r) => r.decision === 'lower_to_competitor' && r.suggested_price_mxn != null
    )
    .map((r) => {
      const abs_reduction_mxn = r.current_price_mxn - r.suggested_price_mxn!;
      const pct_reduction = round4(abs_reduction_mxn / r.current_price_mxn);
      return {
        sku: r.sku,
        title: r.title,
        current_price_mxn: r.current_price_mxn,
        suggested_price_mxn: r.suggested_price_mxn,
        decision: r.decision,
        abs_reduction_mxn,
        pct_reduction,
      };
    });

  // Sort and take top-N for each dimension
  const top_by_abs_reduction = [...qualifying]
    .sort((a, b) => b.abs_reduction_mxn - a.abs_reduction_mxn)
    .slice(0, n);

  const top_by_pct_reduction = [...qualifying]
    .sort((a, b) => b.pct_reduction - a.pct_reduction)
    .slice(0, n);

  // Intersection: SKUs in both lists, preserving abs-list order
  const pctSkus = new Set(top_by_pct_reduction.map((r) => r.sku));
  const intersection = top_by_abs_reduction.filter((r) => pctSkus.has(r.sku));

  return {
    top_by_abs_reduction,
    top_by_pct_reduction,
    intersection,
  };
}
