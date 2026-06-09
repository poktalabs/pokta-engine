/**
 * Margin floor sensitivity analysis for Mi PASE daily pricing pipeline.
 *
 * Runs the pricing logic at three different margin floor values (10%, 15%, 20%)
 * for a set of variants and shows how many SKUs change decision between floors.
 *
 * This lets Rodrigo answer "what happens if our margin floor is higher/lower?"
 * with real data rather than intuition.
 */

import {
  computeSuggestedPrice,
  type Decision,
  type PricingInputs,
} from './pricing-logic.js';

export type { Decision };

export type VariantInput = {
  sku: string;
  current_price_mxn: number;
  cost_mxn: number | null;
  competitor_min_mxn: number | null;
};

export type SensitivityRow = {
  sku: string;
  current_price_mxn: number;
  decision_at_10pct: Decision;
  decision_at_15pct: Decision;
  decision_at_20pct: Decision;
  suggested_at_15pct: number | null;
};

export type FloorBucket = '10pct' | '15pct' | '20pct';

export type SensitivitySummary = {
  rows: SensitivityRow[];
  decision_distribution: Record<FloorBucket, Record<Decision, number>>;
  shifted_15_to_20: number; // count of SKUs whose decision differs between 15% and 20%
  shifted_10_to_15: number; // count of SKUs whose decision differs between 10% and 15%
};

const FLOORS: Record<FloorBucket, number> = {
  '10pct': 10,
  '15pct': 15,
  '20pct': 20,
};

const ALL_DECISIONS: Decision[] = [
  'hold',
  'lower_to_competitor',
  'hold_above_floor',
  'manual_review',
  'skipped',
];

function emptyDistribution(): Record<Decision, number> {
  return Object.fromEntries(ALL_DECISIONS.map((d) => [d, 0])) as Record<
    Decision,
    number
  >;
}

export function computeSensitivity(
  variants: VariantInput[]
): SensitivitySummary {
  const dist: Record<FloorBucket, Record<Decision, number>> = {
    '10pct': emptyDistribution(),
    '15pct': emptyDistribution(),
    '20pct': emptyDistribution(),
  };

  const rows: SensitivityRow[] = [];
  let shifted_10_to_15 = 0;
  let shifted_15_to_20 = 0;

  for (const variant of variants) {
    const results: Record<FloorBucket, ReturnType<typeof computeSuggestedPrice>> =
      {} as Record<FloorBucket, ReturnType<typeof computeSuggestedPrice>>;

    for (const [bucket, floor] of Object.entries(FLOORS) as [
      FloorBucket,
      number,
    ][]) {
      const input: PricingInputs = {
        sku: variant.sku,
        current_price_mxn: variant.current_price_mxn,
        cost_mxn: variant.cost_mxn,
        competitor_min_mxn: variant.competitor_min_mxn,
        margin_floor_pct: floor,
      };
      results[bucket] = computeSuggestedPrice(input);
      dist[bucket][results[bucket].decision]++;
    }

    const d10 = results['10pct'].decision;
    const d15 = results['15pct'].decision;
    const d20 = results['20pct'].decision;

    if (d10 !== d15) shifted_10_to_15++;
    if (d15 !== d20) shifted_15_to_20++;

    rows.push({
      sku: variant.sku,
      current_price_mxn: variant.current_price_mxn,
      decision_at_10pct: d10,
      decision_at_15pct: d15,
      decision_at_20pct: d20,
      suggested_at_15pct: results['15pct'].suggested_price_mxn,
    });
  }

  return {
    rows,
    decision_distribution: dist,
    shifted_10_to_15,
    shifted_15_to_20,
  };
}

// ---------------------------------------------------------------------------
// Wide sensitivity sweep — parameterized floors
// Lane H additive extension. Does NOT modify anything above this line.
// ---------------------------------------------------------------------------

export type WideSensitivityRow = {
  sku: string;
  current_price_mxn: number;
  decisions_by_floor: Record<number, Decision>;  // key = floor pct, value = decision
  suggested_by_floor: Record<number, number | null>;
};

export type WideSensitivitySummary = {
  floors: number[];
  rows: WideSensitivityRow[];
  distribution_by_floor: Record<number, Record<Decision, number>>;
  shifts: Array<{ from_floor: number; to_floor: number; count: number }>;
};

function emptyWideDistribution(): Record<Decision, number> {
  return Object.fromEntries(ALL_DECISIONS.map((d) => [d, 0])) as Record<
    Decision,
    number
  >;
}

export function computeSensitivityWide(
  variants: VariantInput[],
  floors: number[]
): WideSensitivitySummary {
  // Initialize distribution for each floor
  const distribution_by_floor: Record<number, Record<Decision, number>> = {};
  for (const f of floors) {
    distribution_by_floor[f] = emptyWideDistribution();
  }

  const rows: WideSensitivityRow[] = [];

  for (const variant of variants) {
    const decisions_by_floor: Record<number, Decision> = {};
    const suggested_by_floor: Record<number, number | null> = {};

    for (const f of floors) {
      const input: PricingInputs = {
        sku: variant.sku,
        current_price_mxn: variant.current_price_mxn,
        cost_mxn: variant.cost_mxn,
        competitor_min_mxn: variant.competitor_min_mxn,
        margin_floor_pct: f,
      };
      const result = computeSuggestedPrice(input);
      decisions_by_floor[f] = result.decision;
      suggested_by_floor[f] = result.suggested_price_mxn;
      distribution_by_floor[f][result.decision]++;
    }

    rows.push({
      sku: variant.sku,
      current_price_mxn: variant.current_price_mxn,
      decisions_by_floor,
      suggested_by_floor,
    });
  }

  // Compute shifts: for each adjacent pair in the input order
  const shifts: Array<{ from_floor: number; to_floor: number; count: number }> = [];
  for (let i = 0; i < floors.length - 1; i++) {
    const from_floor = floors[i];
    const to_floor = floors[i + 1];
    const count = rows.filter(
      (r) => r.decisions_by_floor[from_floor] !== r.decisions_by_floor[to_floor]
    ).length;
    shifts.push({ from_floor, to_floor, count });
  }

  return {
    floors,
    rows,
    distribution_by_floor,
    shifts,
  };
}
