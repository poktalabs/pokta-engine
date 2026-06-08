/**
 * Pricing logic for Mi PASE daily pricing pipeline.
 *
 * Spec: workstreams/daily-pricing-pipeline/docs/csv-row-spec-2026-05-11.md
 * Decision rule (pure, deterministic):
 *   suggested = max(floor, min(current, competitor))
 *   where floor = cost * (1 + margin_floor_pct / 100)
 *
 * The function classifies WHICH constraint was binding (or whether inputs were
 * insufficient), and returns a (decision, suggested, reason) triple. The caller
 * never has to interpret raw numbers — every row gets a decision enum + a
 * canonical reason string downstream code (and Rodrigo) can rely on.
 */

export type PricingInputs = {
  sku: string;
  current_price_mxn: number;
  cost_mxn: number | null;
  competitor_min_mxn: number | null;
  margin_floor_pct: number;
};

export type Decision =
  | 'hold'
  | 'lower_to_competitor'
  | 'hold_above_floor'
  | 'manual_review'
  | 'skipped';

export type PricingResult = {
  decision: Decision;
  suggested_price_mxn: number | null;
  reason: string;
};

const THRESHOLD_PCT = 0.01;

export function computeSuggestedPrice(input: PricingInputs): PricingResult {
  const {
    current_price_mxn,
    cost_mxn,
    competitor_min_mxn,
    margin_floor_pct,
  } = input;

  if (cost_mxn == null && competitor_min_mxn == null) {
    return {
      decision: 'skipped',
      suggested_price_mxn: null,
      reason: 'insufficient data',
    };
  }

  if (cost_mxn == null) {
    return {
      decision: 'manual_review',
      suggested_price_mxn: null,
      reason: 'cost unknown with known competitor',
    };
  }

  const floor = cost_mxn * (1 + margin_floor_pct / 100);

  if (current_price_mxn < floor) {
    return {
      decision: 'manual_review',
      suggested_price_mxn: null,
      reason: 'current_price below floor, manual review',
    };
  }

  if (competitor_min_mxn == null) {
    return {
      decision: 'hold',
      suggested_price_mxn: round2(current_price_mxn),
      reason: 'competitor data missing, holding current',
    };
  }

  const drift = Math.abs(competitor_min_mxn - current_price_mxn) / current_price_mxn;
  if (drift < THRESHOLD_PCT) {
    return {
      decision: 'hold',
      suggested_price_mxn: round2(current_price_mxn),
      reason: 'within 1% of competitor, no change',
    };
  }

  if (competitor_min_mxn >= current_price_mxn) {
    return {
      decision: 'hold',
      suggested_price_mxn: round2(current_price_mxn),
      reason: 'already at or below competitor, no change',
    };
  }

  if (competitor_min_mxn >= floor) {
    return {
      decision: 'lower_to_competitor',
      suggested_price_mxn: round2(competitor_min_mxn),
      reason: 'competitor_min above margin_floor',
    };
  }

  return {
    decision: 'hold_above_floor',
    suggested_price_mxn: round2(floor),
    reason: 'competitor_min below margin_floor',
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
