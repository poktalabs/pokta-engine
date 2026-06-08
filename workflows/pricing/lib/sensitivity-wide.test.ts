import { describe, it, expect } from 'vitest';
import {
  computeSensitivityWide,
  computeSensitivity,
  type VariantInput,
  type WideSensitivitySummary,
} from './sensitivity.js';

const FLOORS_WIDE = [10, 15, 20, 25, 30];

// Test 1: Single variant with floors [10,15,20,25,30] — shape checks
// current=14000, cost=10000, competitor=13000 → all floors floor < competitor → lower_to_competitor at all
describe('computeSensitivityWide — single variant, 5 floors', () => {
  const variant: VariantInput = {
    sku: 'WIDE-SKU-1',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 13000,
  };

  it('returns 5 floor entries in distribution_by_floor', () => {
    const result: WideSensitivitySummary = computeSensitivityWide([variant], FLOORS_WIDE);
    expect(Object.keys(result.distribution_by_floor)).toHaveLength(5);
    for (const f of FLOORS_WIDE) {
      expect(result.distribution_by_floor).toHaveProperty(String(f));
    }
  });

  it('returns 4 shift entries (one per adjacent pair)', () => {
    const result: WideSensitivitySummary = computeSensitivityWide([variant], FLOORS_WIDE);
    expect(result.shifts).toHaveLength(4);
    expect(result.shifts[0]).toMatchObject({ from_floor: 10, to_floor: 15 });
    expect(result.shifts[1]).toMatchObject({ from_floor: 15, to_floor: 20 });
    expect(result.shifts[2]).toMatchObject({ from_floor: 20, to_floor: 25 });
    expect(result.shifts[3]).toMatchObject({ from_floor: 25, to_floor: 30 });
  });

  it('output floors matches input floors order', () => {
    const result: WideSensitivitySummary = computeSensitivityWide([variant], FLOORS_WIDE);
    expect(result.floors).toEqual(FLOORS_WIDE);
  });

  it('rows preserve variant input order', () => {
    const v2: VariantInput = { sku: 'WIDE-SKU-2', current_price_mxn: 5000, cost_mxn: 3000, competitor_min_mxn: 4000 };
    const result = computeSensitivityWide([variant, v2], FLOORS_WIDE);
    expect(result.rows[0].sku).toBe('WIDE-SKU-1');
    expect(result.rows[1].sku).toBe('WIDE-SKU-2');
  });
});

// Test 2: Floors provided in non-ascending order — output preserves input order
describe('computeSensitivityWide — non-ascending floor order preserved', () => {
  const variant: VariantInput = {
    sku: 'ORDER-SKU',
    current_price_mxn: 10000,
    cost_mxn: 7000,
    competitor_min_mxn: 8500,
  };
  const reversedFloors = [30, 25, 20, 15, 10];

  it('result.floors preserves input order (reversed)', () => {
    const result = computeSensitivityWide([variant], reversedFloors);
    expect(result.floors).toEqual(reversedFloors);
  });

  it('shifts entries respect input floor order (30→25, 25→20, ...)', () => {
    const result = computeSensitivityWide([variant], reversedFloors);
    expect(result.shifts[0]).toMatchObject({ from_floor: 30, to_floor: 25 });
    expect(result.shifts[1]).toMatchObject({ from_floor: 25, to_floor: 20 });
    expect(result.shifts[2]).toMatchObject({ from_floor: 20, to_floor: 15 });
    expect(result.shifts[3]).toMatchObject({ from_floor: 15, to_floor: 10 });
  });
});

// Test 3: 30% floor pivots decision — variant where competitor sits between 25% and 30% floor
// current=14000, cost=10000
//   floor @ 25% = 12500 → competitor=12800 >= 12500 AND competitor < current → lower_to_competitor
//   floor @ 30% = 13000 → competitor=12800 <  13000                           → hold_above_floor (SHIFT)
describe('computeSensitivityWide — 30% floor pivots decision', () => {
  const pivotVariant: VariantInput = {
    sku: 'PIVOT-30',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 12800,
  };

  it('decision at 25% is lower_to_competitor', () => {
    const result = computeSensitivityWide([pivotVariant], FLOORS_WIDE);
    expect(result.rows[0].decisions_by_floor[25]).toBe('lower_to_competitor');
  });

  it('decision at 30% is hold_above_floor', () => {
    const result = computeSensitivityWide([pivotVariant], FLOORS_WIDE);
    expect(result.rows[0].decisions_by_floor[30]).toBe('hold_above_floor');
  });

  it('shift count for 25→30 reflects the pivot (count=1)', () => {
    const result = computeSensitivityWide([pivotVariant], FLOORS_WIDE);
    const shift = result.shifts.find((s) => s.from_floor === 25 && s.to_floor === 30);
    expect(shift).toBeDefined();
    expect(shift!.count).toBe(1);
  });
});

// Test 4: Empty variants — distribution_by_floor has zero counts per floor, shifts all = 0
describe('computeSensitivityWide — empty variants', () => {
  it('distribution_by_floor has all-zero counts per floor', () => {
    const result = computeSensitivityWide([], FLOORS_WIDE);
    for (const f of FLOORS_WIDE) {
      const dist = result.distribution_by_floor[f];
      const total = Object.values(dist).reduce((a, b) => a + b, 0);
      expect(total).toBe(0);
    }
  });

  it('all shifts are 0 when no variants', () => {
    const result = computeSensitivityWide([], FLOORS_WIDE);
    for (const shift of result.shifts) {
      expect(shift.count).toBe(0);
    }
  });

  it('rows is empty', () => {
    const result = computeSensitivityWide([], FLOORS_WIDE);
    expect(result.rows).toHaveLength(0);
  });
});

// Test 5: Regression — existing computeSensitivity still works
describe('computeSensitivity — regression (existing function unchanged)', () => {
  // Same pivot variant from original tests
  const variant: VariantInput = {
    sku: 'PIVOT-SKU',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 11200,
  };

  it('computeSensitivity still returns SensitivitySummary with shifted_10_to_15=1', () => {
    const result = computeSensitivity([variant]);
    expect(result.rows[0].decision_at_10pct).toBe('lower_to_competitor');
    expect(result.rows[0].decision_at_15pct).toBe('hold_above_floor');
    expect(result.shifted_10_to_15).toBe(1);
    expect(result.shifted_15_to_20).toBe(0);
  });

  it('computeSensitivity returns decision_distribution for 3 fixed buckets', () => {
    const result = computeSensitivity([variant]);
    expect(result.decision_distribution).toHaveProperty('10pct');
    expect(result.decision_distribution).toHaveProperty('15pct');
    expect(result.decision_distribution).toHaveProperty('20pct');
  });
});
