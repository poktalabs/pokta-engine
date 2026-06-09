import { describe, it, expect } from 'vitest';
import {
  computeSensitivity,
  type VariantInput,
  type SensitivitySummary,
} from './sensitivity.js';

// Test 1: Single variant where floor pivots the decision
// current=14000, cost=10000, competitor=11200
//   floor @ 10% = 11000 → competitor 11200 >= 11000 AND below current → lower_to_competitor
//   floor @ 15% = 11500 → competitor 11200 < 11500                    → hold_above_floor (SHIFT)
//   floor @ 20% = 12000 → competitor 11200 < 12000                    → hold_above_floor (no further shift)
describe('computeSensitivity — floor pivot (shift between 10% and 15%)', () => {
  const variant: VariantInput = {
    sku: 'PIVOT-SKU',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 11200,
  };

  it('decision_at_10pct is lower_to_competitor', () => {
    const result = computeSensitivity([variant]);
    expect(result.rows[0].decision_at_10pct).toBe('lower_to_competitor');
  });

  it('decision_at_15pct is hold_above_floor', () => {
    const result = computeSensitivity([variant]);
    expect(result.rows[0].decision_at_15pct).toBe('hold_above_floor');
  });

  it('decision_at_20pct is hold_above_floor', () => {
    const result = computeSensitivity([variant]);
    expect(result.rows[0].decision_at_20pct).toBe('hold_above_floor');
  });

  it('shifted_10_to_15 = 1 (the pivot)', () => {
    const result = computeSensitivity([variant]);
    expect(result.shifted_10_to_15).toBe(1);
  });

  it('shifted_15_to_20 = 0 (no further shift)', () => {
    const result = computeSensitivity([variant]);
    expect(result.shifted_15_to_20).toBe(0);
  });
});

// Test 2: Variant unchanged across all three floors
// competitor well above the 20% floor → decision is 'hold' at all floors
describe('computeSensitivity — variant stable across all floors', () => {
  const stableVariant: VariantInput = {
    sku: 'STABLE-SKU',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 15000, // above current → hold (already cheaper)
  };

  it('same decision at all three floors', () => {
    const result = computeSensitivity([stableVariant]);
    const row = result.rows[0];
    expect(row.decision_at_10pct).toBe(row.decision_at_15pct);
    expect(row.decision_at_15pct).toBe(row.decision_at_20pct);
  });

  it('contributes 0 to shifted_10_to_15', () => {
    const result = computeSensitivity([stableVariant]);
    expect(result.shifted_10_to_15).toBe(0);
  });

  it('contributes 0 to shifted_15_to_20', () => {
    const result = computeSensitivity([stableVariant]);
    expect(result.shifted_15_to_20).toBe(0);
  });
});

// Test 3: decision_distribution counts sum to variants.length for each bucket
describe('computeSensitivity — distribution totals', () => {
  const variants: VariantInput[] = [
    { sku: 'SKU-A', current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 13000 },
    { sku: 'SKU-B', current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 10800 },
    { sku: 'SKU-C', current_price_mxn: 14000, cost_mxn: null, competitor_min_mxn: 13000 },
    { sku: 'SKU-D', current_price_mxn: 14000, cost_mxn: null, competitor_min_mxn: null },
  ];

  it('distribution sums equal variants.length for 10pct', () => {
    const result = computeSensitivity(variants);
    const dist = result.decision_distribution['10pct'];
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total).toBe(variants.length);
  });

  it('distribution sums equal variants.length for 15pct', () => {
    const result = computeSensitivity(variants);
    const dist = result.decision_distribution['15pct'];
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total).toBe(variants.length);
  });

  it('distribution sums equal variants.length for 20pct', () => {
    const result = computeSensitivity(variants);
    const dist = result.decision_distribution['20pct'];
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total).toBe(variants.length);
  });
});

// Test 4: shifted_15_to_20 equals count where decision_at_15pct !== decision_at_20pct
// Use two variants: one shifts between 15% and 20%, one doesn't
describe('computeSensitivity — shifted_15_to_20 matches row-level diff', () => {
  // Variant that shifts 15→20: competitor between floor_15 and floor_20
  // floor_15=11500, floor_20=12000, competitor=11700 → at 15%: lower_to_competitor; at 20%: hold_above_floor
  const shiftingVariant: VariantInput = {
    sku: 'SHIFT-15-20',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 11700,
  };
  // Stable variant
  const stableVariant: VariantInput = {
    sku: 'STABLE-2',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 13000, // well above 20% floor=12000 → lower_to_competitor at all floors
  };

  it('shifted_15_to_20 equals manual count of rows where d15 !== d20', () => {
    const result = computeSensitivity([shiftingVariant, stableVariant]);
    const manualCount = result.rows.filter(
      (r) => r.decision_at_15pct !== r.decision_at_20pct
    ).length;
    expect(result.shifted_15_to_20).toBe(manualCount);
    expect(result.shifted_15_to_20).toBe(1); // only shiftingVariant shifts
  });
});

// Test 5: empty input
describe('computeSensitivity — empty input', () => {
  it('returns empty rows and zero shifts', () => {
    const result = computeSensitivity([]);
    expect(result.rows).toHaveLength(0);
    expect(result.shifted_10_to_15).toBe(0);
    expect(result.shifted_15_to_20).toBe(0);
  });

  it('still has all decision keys in distribution', () => {
    const result = computeSensitivity([]);
    const dist = result.decision_distribution['15pct'];
    expect(dist).toHaveProperty('hold');
    expect(dist).toHaveProperty('lower_to_competitor');
    expect(dist).toHaveProperty('hold_above_floor');
    expect(dist).toHaveProperty('manual_review');
    expect(dist).toHaveProperty('skipped');
  });
});
