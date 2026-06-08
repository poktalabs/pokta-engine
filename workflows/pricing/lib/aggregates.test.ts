import { describe, it, expect } from 'vitest';
import { computeAggregates, type PricingRow } from './aggregates.js';

// Helper to build a minimal ok row
function okRow(overrides: Partial<PricingRow>): PricingRow {
  return {
    sku: 'TEST-SKU',
    current_price_mxn: 1000,
    suggested_price_mxn: 900,
    decision: 'lower_to_competitor',
    status: 'ok',
    ...overrides,
  };
}

describe('computeAggregates', () => {
  it('test 1: empty input → all zeros, by_decision has every Decision key set to 0', () => {
    const result = computeAggregates([]);
    expect(result.total_variants).toBe(0);
    expect(result.lower_count).toBe(0);
    expect(result.hold_count).toBe(0);
    expect(result.manual_review_count).toBe(0);
    expect(result.skipped_count).toBe(0);
    expect(result.total_current_revenue_mxn).toBe(0);
    expect(result.total_suggested_revenue_mxn).toBe(0);
    expect(result.total_price_reduction_mxn).toBe(0);
    expect(result.avg_price_drop_pct).toBe(0);
    // All Decision keys present and set to 0
    expect(result.by_decision.hold).toBe(0);
    expect(result.by_decision.lower_to_competitor).toBe(0);
    expect(result.by_decision.hold_above_floor).toBe(0);
    expect(result.by_decision.manual_review).toBe(0);
    expect(result.by_decision.skipped).toBe(0);
  });

  it('test 2: single lower_to_competitor row (current=1000, suggested=900) → reduction=100, avg_drop=10.00', () => {
    const rows: PricingRow[] = [
      okRow({ current_price_mxn: 1000, suggested_price_mxn: 900, decision: 'lower_to_competitor' }),
    ];
    const result = computeAggregates(rows);
    expect(result.total_variants).toBe(1);
    expect(result.lower_count).toBe(1);
    expect(result.total_price_reduction_mxn).toBe(100);
    expect(result.avg_price_drop_pct).toBe(10.00);
    expect(result.total_current_revenue_mxn).toBe(1000);
    expect(result.total_suggested_revenue_mxn).toBe(900);
  });

  it('test 3: mix of decisions — counts add up to total_variants exactly', () => {
    const rows: PricingRow[] = [
      okRow({ decision: 'lower_to_competitor', suggested_price_mxn: 800 }),
      okRow({ decision: 'hold', suggested_price_mxn: 1000 }),
      okRow({ decision: 'hold_above_floor', suggested_price_mxn: 700 }),
      okRow({ decision: 'manual_review', suggested_price_mxn: null }),
      { sku: 'SKIP', current_price_mxn: 500, suggested_price_mxn: null, decision: 'skipped', status: 'skipped' },
    ];
    const result = computeAggregates(rows);
    expect(result.total_variants).toBe(5);
    const total = Object.values(result.by_decision).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.total_variants);
    expect(result.lower_count).toBe(1);
    expect(result.hold_count).toBe(1);
    expect(result.manual_review_count).toBe(1);
    expect(result.skipped_count).toBe(1);
    expect(result.by_decision.hold_above_floor).toBe(1);
  });

  it('test 4: skipped rows (status=skipped, suggested=null) excluded from revenue totals', () => {
    const rows: PricingRow[] = [
      okRow({ current_price_mxn: 2000, suggested_price_mxn: 1800, decision: 'lower_to_competitor', status: 'ok' }),
      { sku: 'SKP1', current_price_mxn: 9999, suggested_price_mxn: null, decision: 'skipped', status: 'skipped' },
    ];
    const result = computeAggregates(rows);
    // Skipped row should NOT add to current revenue
    expect(result.total_current_revenue_mxn).toBe(2000);
    expect(result.total_suggested_revenue_mxn).toBe(1800);
  });

  it('test 5: failed_with_reason rows excluded from current_revenue', () => {
    const rows: PricingRow[] = [
      okRow({ current_price_mxn: 500, suggested_price_mxn: 450, decision: 'lower_to_competitor', status: 'ok' }),
      {
        sku: '',
        current_price_mxn: 8000,
        suggested_price_mxn: null,
        decision: 'skipped',
        status: 'failed_with_reason',
      },
    ];
    const result = computeAggregates(rows);
    // Only the ok row contributes to current revenue
    expect(result.total_current_revenue_mxn).toBe(500);
    expect(result.total_suggested_revenue_mxn).toBe(450);
  });

  it('test 6: avg_price_drop_pct = 0 when zero lower_to_competitor rows', () => {
    const rows: PricingRow[] = [
      okRow({ decision: 'hold', suggested_price_mxn: 1000 }),
      okRow({ decision: 'hold_above_floor', suggested_price_mxn: 700 }),
    ];
    const result = computeAggregates(rows);
    expect(result.avg_price_drop_pct).toBe(0);
    expect(result.total_price_reduction_mxn).toBe(0);
  });
});
