/**
 * Aggregate statistics over a set of pricing rows.
 *
 * Pure function — no side effects, no I/O.
 * Used by run-pipeline.ts to emit resumen-impacto-{date}.md.
 */

import type { Decision } from './pricing-logic.js';

export type { Decision };

export type PricingRow = {
  sku: string;
  current_price_mxn: number;
  suggested_price_mxn: number | null;
  decision: Decision;
  status: 'ok' | 'skipped' | 'failed_with_reason';
};

export type AggregateSummary = {
  total_variants: number;
  by_decision: Record<Decision, number>;
  total_current_revenue_mxn: number;        // sum current_price_mxn for status=ok
  total_suggested_revenue_mxn: number;       // sum suggested_price_mxn where suggested != null AND status=ok
  total_price_reduction_mxn: number;         // sum (current - suggested) for decision=lower_to_competitor
  avg_price_drop_pct: number;                // mean of (current - suggested)/current for lower_to_competitor (0 if none)
  lower_count: number;
  hold_count: number;
  manual_review_count: number;
  skipped_count: number;
};

const ALL_DECISIONS: Decision[] = [
  'hold',
  'lower_to_competitor',
  'hold_above_floor',
  'manual_review',
  'skipped',
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeAggregates(rows: PricingRow[]): AggregateSummary {
  const by_decision = Object.fromEntries(
    ALL_DECISIONS.map((d) => [d, 0])
  ) as Record<Decision, number>;

  let total_current_revenue_mxn = 0;
  let total_suggested_revenue_mxn = 0;
  let total_price_reduction_mxn = 0;
  const drop_pcts: number[] = [];

  for (const row of rows) {
    by_decision[row.decision] = (by_decision[row.decision] ?? 0) + 1;

    if (row.status === 'ok') {
      total_current_revenue_mxn += row.current_price_mxn;

      if (row.suggested_price_mxn != null) {
        total_suggested_revenue_mxn += row.suggested_price_mxn;
      }
    }

    if (row.decision === 'lower_to_competitor' && row.suggested_price_mxn != null) {
      const reduction = row.current_price_mxn - row.suggested_price_mxn;
      total_price_reduction_mxn += reduction;
      const pct = (reduction / row.current_price_mxn) * 100;
      drop_pcts.push(pct);
    }
  }

  const avg_price_drop_pct =
    drop_pcts.length > 0
      ? round2(drop_pcts.reduce((a, b) => a + b, 0) / drop_pcts.length)
      : 0;

  return {
    total_variants: rows.length,
    by_decision,
    total_current_revenue_mxn: round2(total_current_revenue_mxn),
    total_suggested_revenue_mxn: round2(total_suggested_revenue_mxn),
    total_price_reduction_mxn: round2(total_price_reduction_mxn),
    avg_price_drop_pct,
    lower_count: by_decision['lower_to_competitor'],
    hold_count: by_decision['hold'],
    manual_review_count: by_decision['manual_review'],
    skipped_count: by_decision['skipped'],
  };
}
