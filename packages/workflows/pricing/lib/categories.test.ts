import { describe, it, expect } from 'vitest';
import { inferCategory, aggregateByCategory, type CategoryInputRow } from './categories.js';

// ─── inferCategory ────────────────────────────────────────────────────────────

describe('inferCategory', () => {
  it('test 1: asadores — matches "ASADOR DE CARBON PORTATIL"', () => {
    expect(inferCategory('ASADOR DE CARBON PORTATIL 14"')).toBe('asadores');
  });

  it('test 2: lavadoras — matches "LAVADORA AUTOMÁTICA"', () => {
    expect(inferCategory('LAVADORA AUTOMÁTICA 16KG')).toBe('lavadoras');
  });

  it('test 3: bocinas — matches "BOCINA BLUETOOTH"', () => {
    expect(inferCategory('BOCINA BLUETOOTH PORTATIL LG')).toBe('bocinas');
  });

  it('test 4: audifonos — matches "AUDIFONOS SENWA DIADEMA"', () => {
    expect(inferCategory('AUDIFONOS SENWA DIADEMA')).toBe('audifonos');
  });

  it('test 5: bases_cama — matches "BASE UNIVERSAL KING"', () => {
    expect(inferCategory('BASE UNIVERSAL KING CON CAJONES')).toBe('bases_cama');
  });

  it('test 6: calentadores — matches "CALENTADOR DE AGUA"', () => {
    expect(inferCategory('CALENTADOR DE AGUA 10 LTS')).toBe('calentadores');
  });

  it('test 7: colchones — matches "COLCHON MATRIMONIAL"', () => {
    expect(inferCategory('COLCHON MATRIMONIAL SERTA')).toBe('colchones');
  });

  it('test 8: bidets — matches "BIDE ELÉCTRICO"', () => {
    expect(inferCategory('BIDE ELÉCTRICO INTELIGENTE')).toBe('bidets');
  });

  it('test 9: campanas — matches "CAMPANA DE COCINA"', () => {
    expect(inferCategory('CAMPANA DE COCINA 60CM')).toBe('campanas');
  });

  it('test 10: empty title → "otros"', () => {
    expect(inferCategory('')).toBe('otros');
  });

  it('test 11: title with no keyword match → "otros"', () => {
    expect(inferCategory('REFRIGERADOR MABE 14 PIES')).toBe('otros');
  });

  it('test 12: asadores regex is specific — "asador" without "carb" goes to otros', () => {
    // The regex requires /asador.*carb/i so just "asador" alone → otros
    expect(inferCategory('ASADOR ELECTRICO')).toBe('otros');
  });

  it('test 13: diadema also maps to audifonos', () => {
    expect(inferCategory('DIADEMA GAMER RGB')).toBe('audifonos');
  });
});

// ─── aggregateByCategory ──────────────────────────────────────────────────────

function makeRow(overrides: Partial<CategoryInputRow>): CategoryInputRow {
  return {
    sku: 'TEST-001',
    title: 'BOCINA BLUETOOTH PORTATIL',
    current_price_mxn: 1000,
    suggested_price_mxn: 900,
    decision: 'lower_to_competitor',
    status: 'ok',
    ...overrides,
  };
}

describe('aggregateByCategory', () => {
  it('test 1: empty input → empty array', () => {
    expect(aggregateByCategory([])).toEqual([]);
  });

  it('test 2: single category with 2 rows → correct totals', () => {
    const rows: CategoryInputRow[] = [
      makeRow({ sku: 'BOC-001', current_price_mxn: 1000, suggested_price_mxn: 900, decision: 'lower_to_competitor', status: 'ok' }),
      makeRow({ sku: 'BOC-002', current_price_mxn: 2000, suggested_price_mxn: 1800, decision: 'lower_to_competitor', status: 'ok' }),
    ];
    const result = aggregateByCategory(rows);
    expect(result).toHaveLength(1);
    const cat = result[0];
    expect(cat.category).toBe('bocinas');
    expect(cat.count).toBe(2);
    expect(cat.total_current_mxn).toBe(3000);
    expect(cat.total_suggested_mxn).toBe(2700);
    expect(cat.total_reduction_mxn).toBe(300);
    expect(cat.lower_count).toBe(2);
    // avg pct: (100/1000*100 + 200/2000*100) / 2 = (10 + 10) / 2 = 10
    expect(cat.avg_pct_reduction).toBe(10);
  });

  it('test 3: skipped/failed rows excluded from revenue totals', () => {
    const rows: CategoryInputRow[] = [
      makeRow({ sku: 'BOC-001', current_price_mxn: 1000, suggested_price_mxn: 900, decision: 'lower_to_competitor', status: 'ok' }),
      makeRow({ sku: 'BOC-002', current_price_mxn: 9999, suggested_price_mxn: null, decision: 'skipped', status: 'skipped' }),
      makeRow({ sku: '', current_price_mxn: 8888, suggested_price_mxn: null, decision: 'skipped', status: 'failed_with_reason' }),
    ];
    const result = aggregateByCategory(rows);
    // All 3 rows have same title → 1 category
    expect(result).toHaveLength(1);
    const cat = result[0];
    // count includes all rows
    expect(cat.count).toBe(3);
    // Revenue totals only from status=ok
    expect(cat.total_current_mxn).toBe(1000);
    expect(cat.total_suggested_mxn).toBe(900);
    expect(cat.total_reduction_mxn).toBe(100);
    expect(cat.lower_count).toBe(1);
  });

  it('test 4: sort order matches total_reduction_mxn DESC', () => {
    const rows: CategoryInputRow[] = [
      // Bocinas — small reduction
      makeRow({ title: 'BOCINA BLUETOOTH', current_price_mxn: 500, suggested_price_mxn: 490, decision: 'lower_to_competitor', status: 'ok' }),
      // Lavadoras — large reduction
      makeRow({ title: 'LAVADORA 16KG', current_price_mxn: 10000, suggested_price_mxn: 8000, decision: 'lower_to_competitor', status: 'ok' }),
      // Audifonos — medium reduction
      makeRow({ title: 'AUDIFONOS DIADEMA', current_price_mxn: 2000, suggested_price_mxn: 1700, decision: 'lower_to_competitor', status: 'ok' }),
    ];
    const result = aggregateByCategory(rows);
    expect(result).toHaveLength(3);
    // Should be sorted DESC by reduction: lavadoras(2000) > audifonos(300) > bocinas(10)
    expect(result[0].category).toBe('lavadoras');
    expect(result[1].category).toBe('audifonos');
    expect(result[2].category).toBe('bocinas');
  });

  it('test 5: hold decision — lower_count stays 0 and reduction is 0', () => {
    const rows: CategoryInputRow[] = [
      makeRow({ title: 'COLCHON KING', current_price_mxn: 5000, suggested_price_mxn: 5000, decision: 'hold', status: 'ok' }),
    ];
    const result = aggregateByCategory(rows);
    expect(result).toHaveLength(1);
    expect(result[0].lower_count).toBe(0);
    expect(result[0].total_reduction_mxn).toBe(0);
    expect(result[0].avg_pct_reduction).toBe(0);
  });

  it('test 6: multiple categories present — only categories in input are returned', () => {
    const rows: CategoryInputRow[] = [
      makeRow({ title: 'BOCINA BLUETOOTH' }),
      makeRow({ title: 'LAVADORA AUTOMATICA' }),
    ];
    const result = aggregateByCategory(rows);
    // Only 2 categories — not all 10
    expect(result).toHaveLength(2);
    const categories = result.map((r) => r.category);
    expect(categories).toContain('bocinas');
    expect(categories).toContain('lavadoras');
  });

  it('test 7: avg_pct_reduction is 0 when no lower_to_competitor rows in category', () => {
    const rows: CategoryInputRow[] = [
      makeRow({ title: 'ASADOR DE CARBON PORTATIL', decision: 'hold', suggested_price_mxn: 1000, status: 'ok' }),
      makeRow({ title: 'ASADOR DE CARBON GRANDE', decision: 'hold_above_floor', suggested_price_mxn: 850, status: 'ok' }),
    ];
    const result = aggregateByCategory(rows);
    expect(result).toHaveLength(1);
    expect(result[0].avg_pct_reduction).toBe(0);
    expect(result[0].lower_count).toBe(0);
  });
});
