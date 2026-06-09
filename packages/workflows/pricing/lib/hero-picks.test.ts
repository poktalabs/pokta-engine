import { describe, it, expect } from 'vitest';
import { pickHeroes, type HeroPickRow } from './hero-picks.js';
import type { Decision } from './pricing-logic.js';

// Helper to build a minimal input row
function mkRow(overrides: {
  sku?: string;
  title?: string;
  current_price_mxn?: number;
  suggested_price_mxn?: number | null;
  decision?: Decision;
}) {
  return {
    sku: overrides.sku ?? 'SKU-001',
    title: overrides.title ?? 'Producto Test',
    current_price_mxn: overrides.current_price_mxn ?? 1000,
    suggested_price_mxn: overrides.suggested_price_mxn !== undefined
      ? overrides.suggested_price_mxn
      : 900,
    decision: overrides.decision ?? ('lower_to_competitor' as Decision),
  };
}

describe('pickHeroes', () => {
  it('test 1: empty input → all three lists empty', () => {
    const result = pickHeroes([]);
    expect(result.top_by_abs_reduction).toHaveLength(0);
    expect(result.top_by_pct_reduction).toHaveLength(0);
    expect(result.intersection).toHaveLength(0);
  });

  it('test 2: mixed decisions — only lower_to_competitor rows are considered', () => {
    const rows = [
      mkRow({ sku: 'A', decision: 'lower_to_competitor', current_price_mxn: 1000, suggested_price_mxn: 800 }),
      mkRow({ sku: 'B', decision: 'hold', current_price_mxn: 2000, suggested_price_mxn: 2000 }),
      mkRow({ sku: 'C', decision: 'hold_above_floor', current_price_mxn: 500, suggested_price_mxn: 450 }),
      mkRow({ sku: 'D', decision: 'manual_review', current_price_mxn: 3000, suggested_price_mxn: null }),
      mkRow({ sku: 'E', decision: 'skipped', current_price_mxn: 1500, suggested_price_mxn: null }),
    ];
    const result = pickHeroes(rows);
    expect(result.top_by_abs_reduction).toHaveLength(1);
    expect(result.top_by_abs_reduction[0].sku).toBe('A');
    expect(result.top_by_pct_reduction).toHaveLength(1);
    expect(result.top_by_pct_reduction[0].sku).toBe('A');
  });

  it('test 3: top-N=7 from 10 candidates → returns exactly 7 in each list', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      mkRow({
        sku: `SKU-${i + 1}`,
        current_price_mxn: 1000 + i * 100,
        suggested_price_mxn: 900 + i * 90,
        decision: 'lower_to_competitor',
      })
    );
    const result = pickHeroes(rows, 7);
    expect(result.top_by_abs_reduction).toHaveLength(7);
    expect(result.top_by_pct_reduction).toHaveLength(7);
  });

  it('test 4: top-N=10 from 3 candidates → returns 3 (no padding)', () => {
    const rows = [
      mkRow({ sku: 'X1', current_price_mxn: 500, suggested_price_mxn: 400, decision: 'lower_to_competitor' }),
      mkRow({ sku: 'X2', current_price_mxn: 600, suggested_price_mxn: 500, decision: 'lower_to_competitor' }),
      mkRow({ sku: 'X3', current_price_mxn: 700, suggested_price_mxn: 600, decision: 'lower_to_competitor' }),
    ];
    const result = pickHeroes(rows, 10);
    expect(result.top_by_abs_reduction).toHaveLength(3);
    expect(result.top_by_pct_reduction).toHaveLength(3);
  });

  it('test 5: abs vs pct rankings differ — high-price small-% vs low-price big-%', () => {
    // HIGH-A: $10,000 → $9,500 (abs=$500, pct=5%)
    // LOW-B:  $200 → $100    (abs=$100, pct=50%)
    // HIGH-A ranks higher by abs, LOW-B ranks higher by pct
    const rows = [
      mkRow({ sku: 'HIGH-A', current_price_mxn: 10000, suggested_price_mxn: 9500, decision: 'lower_to_competitor' }),
      mkRow({ sku: 'LOW-B', current_price_mxn: 200, suggested_price_mxn: 100, decision: 'lower_to_competitor' }),
    ];
    const result = pickHeroes(rows, 7);

    expect(result.top_by_abs_reduction[0].sku).toBe('HIGH-A');
    expect(result.top_by_abs_reduction[1].sku).toBe('LOW-B');

    expect(result.top_by_pct_reduction[0].sku).toBe('LOW-B');
    expect(result.top_by_pct_reduction[1].sku).toBe('HIGH-A');
  });

  it('test 6: intersection correctly identifies overlap between both top lists', () => {
    // 5 rows: we ask for top-3
    // SKU-M ranks #1 abs, #1 pct → in intersection
    // SKU-AX ranks #2 abs, #4 pct → NOT in intersection (if N=3)
    // SKU-BX ranks #3 abs, #2 pct → in intersection
    // SKU-CX ranks #4 abs, #3 pct → in intersection (pct top-3)
    // SKU-DX ranks #5 abs, #5 pct → NOT in intersection
    const rows = [
      // SKU-M: $5000 → $4000 (abs=$1000, pct=20%)
      mkRow({ sku: 'SKU-M',  current_price_mxn: 5000,  suggested_price_mxn: 4000, decision: 'lower_to_competitor' }),
      // SKU-AX: $3000 → $2200 (abs=$800, pct≈26.67%) — high pct but let's set it lower
      mkRow({ sku: 'SKU-AX', current_price_mxn: 10000, suggested_price_mxn: 9400, decision: 'lower_to_competitor' }),
      // SKU-BX: $2000 → $1300 (abs=$700, pct=35%)
      mkRow({ sku: 'SKU-BX', current_price_mxn: 2000,  suggested_price_mxn: 1300, decision: 'lower_to_competitor' }),
      // SKU-CX: $1000 → $680 (abs=$320, pct=32%)
      mkRow({ sku: 'SKU-CX', current_price_mxn: 1000,  suggested_price_mxn: 680,  decision: 'lower_to_competitor' }),
      // SKU-DX: $500 → $490 (abs=$10, pct=2%)
      mkRow({ sku: 'SKU-DX', current_price_mxn: 500,   suggested_price_mxn: 490,  decision: 'lower_to_competitor' }),
    ];
    // abs order: M(1000) > AX(600) > BX(700)... recalc:
    // SKU-M:  abs=1000, pct=0.2
    // SKU-AX: abs=600,  pct=0.06   (low pct)
    // SKU-BX: abs=700,  pct=0.35
    // SKU-CX: abs=320,  pct=0.32
    // SKU-DX: abs=10,   pct=0.02
    // abs top-3: M(1000), BX(700), AX(600) → {M, BX, AX}
    // pct top-3: BX(0.35), CX(0.32), M(0.20) → {BX, CX, M}
    // intersection: M and BX

    const result = pickHeroes(rows, 3);
    const intersectionSkus = result.intersection.map((r: HeroPickRow) => r.sku).sort();
    expect(intersectionSkus).toEqual(['SKU-BX', 'SKU-M'].sort());
    // Verify intersection preserves abs-list order (M before BX)
    const mIdx = result.intersection.findIndex((r: HeroPickRow) => r.sku === 'SKU-M');
    const bxIdx = result.intersection.findIndex((r: HeroPickRow) => r.sku === 'SKU-BX');
    expect(mIdx).toBeLessThan(bxIdx);
  });

  it('test 7: rows with suggested_price_mxn = null are excluded even if decision is lower_to_competitor', () => {
    const rows = [
      mkRow({ sku: 'NULL-SUGG', decision: 'lower_to_competitor', current_price_mxn: 1000, suggested_price_mxn: null }),
      mkRow({ sku: 'VALID', decision: 'lower_to_competitor', current_price_mxn: 1000, suggested_price_mxn: 800 }),
    ];
    const result = pickHeroes(rows, 7);
    expect(result.top_by_abs_reduction).toHaveLength(1);
    expect(result.top_by_abs_reduction[0].sku).toBe('VALID');
  });

  it('test 8: abs_reduction_mxn and pct_reduction are computed correctly', () => {
    const rows = [
      mkRow({ sku: 'CALC', current_price_mxn: 2000, suggested_price_mxn: 1500, decision: 'lower_to_competitor' }),
    ];
    const result = pickHeroes(rows, 7);
    const row = result.top_by_abs_reduction[0];
    expect(row.abs_reduction_mxn).toBe(500);
    // pct = 500/2000 = 0.25, rounded to 4 decimals
    expect(row.pct_reduction).toBe(0.25);
  });
});
