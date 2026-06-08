import { describe, it, expect } from 'vitest';
import {
  computeSuggestedPrice,
  type PricingInputs,
  type Decision,
} from './pricing-logic.js';

function inputs(partial: Partial<PricingInputs>): PricingInputs {
  return {
    sku: 'TEST-SKU',
    current_price_mxn: 14000,
    cost_mxn: 10000,
    competitor_min_mxn: 13000,
    margin_floor_pct: 15,
    ...partial,
  };
}

describe('computeSuggestedPrice — minimum branch coverage (1, 2, 4, 5)', () => {

  describe('Branch 1: cost known, competitor above floor, competitor below current → lower_to_competitor', () => {
    const cases: Array<{
      label: string;
      input: Partial<PricingInputs>;
      expected_decision: Decision;
      expected_suggested: number;
      expected_reason: string;
    }> = [
      {
        label: 'competitor well above floor, well below current',
        input: { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 13000 },
        expected_decision: 'lower_to_competitor',
        expected_suggested: 13000,
        expected_reason: 'competitor_min above margin_floor',
      },
      {
        label: 'competitor exactly at floor (edge: >= floor counts)',
        input: { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 11500 },
        expected_decision: 'lower_to_competitor',
        expected_suggested: 11500,
        expected_reason: 'competitor_min above margin_floor',
      },
      {
        label: 'small-MXN product (no scale assumption baked in)',
        input: { current_price_mxn: 250, cost_mxn: 180, competitor_min_mxn: 230 },
        expected_decision: 'lower_to_competitor',
        expected_suggested: 230,
        expected_reason: 'competitor_min above margin_floor',
      },
    ];

    it.each(cases)('$label', ({ input, expected_decision, expected_suggested, expected_reason }) => {
      const result = computeSuggestedPrice(inputs(input));
      expect(result.decision).toBe(expected_decision);
      expect(result.suggested_price_mxn).toBe(expected_suggested);
      expect(result.reason).toBe(expected_reason);
    });
  });

  describe('Branch 2: cost known, competitor below floor → hold_above_floor', () => {
    const cases = [
      {
        label: 'competitor 5% below floor',
        input: { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 10900 },
        expected_decision: 'hold_above_floor' as const,
        expected_suggested: 11500,
        expected_reason: 'competitor_min below margin_floor',
      },
      {
        label: 'competitor at cost (floor still applies)',
        input: { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 10000 },
        expected_decision: 'hold_above_floor' as const,
        expected_suggested: 11500,
        expected_reason: 'competitor_min below margin_floor',
      },
      {
        label: 'per-category margin floor at 20%',
        input: { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 11500, margin_floor_pct: 20 },
        expected_decision: 'hold_above_floor' as const,
        expected_suggested: 12000,
        expected_reason: 'competitor_min below margin_floor',
      },
    ];

    it.each(cases)('$label', ({ input, expected_decision, expected_suggested, expected_reason }) => {
      const result = computeSuggestedPrice(inputs(input));
      expect(result.decision).toBe(expected_decision);
      expect(result.suggested_price_mxn).toBe(expected_suggested);
      expect(result.reason).toBe(expected_reason);
    });
  });

  describe('Branch 4: cost null, competitor known → manual_review', () => {
    const cases = [
      {
        label: 'standard cost-null case',
        input: { current_price_mxn: 14000, cost_mxn: null, competitor_min_mxn: 13000 },
      },
      {
        label: 'cost-null with competitor above current (still manual_review)',
        input: { current_price_mxn: 14000, cost_mxn: null, competitor_min_mxn: 15000 },
      },
    ];

    it.each(cases)('$label', ({ input }) => {
      const result = computeSuggestedPrice(inputs(input));
      expect(result.decision).toBe('manual_review');
      expect(result.suggested_price_mxn).toBeNull();
      expect(result.reason).toBe('cost unknown with known competitor');
    });
  });

  describe('Branch 5: both null → skipped', () => {
    it('returns skipped + null suggested + insufficient data reason', () => {
      const result = computeSuggestedPrice(inputs({ cost_mxn: null, competitor_min_mxn: null }));
      expect(result.decision).toBe('skipped');
      expect(result.suggested_price_mxn).toBeNull();
      expect(result.reason).toBe('insufficient data');
    });
  });
});

describe('computeSuggestedPrice — additional branches (3, 6, 7, 8)', () => {

  describe('Branch 3: cost known, competitor null → hold', () => {
    it('holds at current with competitor-missing reason', () => {
      const result = computeSuggestedPrice(inputs({ competitor_min_mxn: null }));
      expect(result.decision).toBe('hold');
      expect(result.suggested_price_mxn).toBe(14000);
      expect(result.reason).toBe('competitor data missing, holding current');
    });
  });

  describe('Branch 6: current already below floor → manual_review', () => {
    it('flags for manual review when current is below cost*(1+floor)', () => {
      const result = computeSuggestedPrice(inputs({
        current_price_mxn: 10500,
        cost_mxn: 10000,
        margin_floor_pct: 15,
        competitor_min_mxn: 9500,
      }));
      expect(result.decision).toBe('manual_review');
      expect(result.suggested_price_mxn).toBeNull();
      expect(result.reason).toBe('current_price below floor, manual review');
    });
  });

  describe('Branch 7: within 1% of competitor → hold (anti-thrash, D10)', () => {
    const cases = [
      { label: '0.5% below', input: { current_price_mxn: 14000, competitor_min_mxn: 13930 } },
      { label: '0.5% above', input: { current_price_mxn: 14000, competitor_min_mxn: 14070 } },
      { label: 'exactly equal', input: { current_price_mxn: 14000, competitor_min_mxn: 14000 } },
    ];
    it.each(cases)('$label → hold, no change', ({ input }) => {
      const result = computeSuggestedPrice(inputs(input));
      expect(result.decision).toBe('hold');
      expect(result.suggested_price_mxn).toBe(14000);
      expect(result.reason).toBe('within 1% of competitor, no change');
    });
  });

  describe('Branch 8: competitor above current (but outside 1%) → hold', () => {
    it('holds at current when competitor is meaningfully above (we are already cheaper)', () => {
      const result = computeSuggestedPrice(inputs({
        current_price_mxn: 14000,
        competitor_min_mxn: 15500,
      }));
      expect(result.decision).toBe('hold');
      expect(result.suggested_price_mxn).toBe(14000);
      expect(result.reason).toBe('already at or below competitor, no change');
    });
  });
});

describe('computeSuggestedPrice — output invariants', () => {
  const samples: Array<Partial<PricingInputs>> = [
    { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 13000 },
    { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: 10900 },
    { current_price_mxn: 14000, cost_mxn: 10000, competitor_min_mxn: null },
    { current_price_mxn: 250, cost_mxn: 180, competitor_min_mxn: 230 },
  ];

  it.each(samples)('rounds suggested to 2 decimal places ($current_price_mxn)', (s) => {
    const result = computeSuggestedPrice(inputs(s));
    if (result.suggested_price_mxn != null) {
      const cents = Math.round(result.suggested_price_mxn * 100);
      expect(cents).toBe(result.suggested_price_mxn * 100);
    }
  });

  it.each(samples)('never suggests below cost*(1+floor) when both known ($current_price_mxn)', (s) => {
    const result = computeSuggestedPrice(inputs(s));
    const full = inputs(s);
    if (result.suggested_price_mxn != null && full.cost_mxn != null) {
      const floor = full.cost_mxn * (1 + full.margin_floor_pct / 100);
      expect(result.suggested_price_mxn).toBeGreaterThanOrEqual(round2(floor) - 0.01);
    }
  });
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
