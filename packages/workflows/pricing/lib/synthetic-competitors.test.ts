import { describe, it, expect } from 'vitest';
import {
  syntheticPrice,
  syntheticCompetitors,
  RETAILERS,
} from './synthetic-competitors.js';

describe('syntheticPrice', () => {
  it('is deterministic — same inputs yield same output', () => {
    const a = syntheticPrice('LG-WT2025FW', 'Liverpool', 14999, '2026-05-11');
    const b = syntheticPrice('LG-WT2025FW', 'Liverpool', 14999, '2026-05-11');
    expect(a).toBe(b);
  });

  it('changes when SKU changes', () => {
    const a = syntheticPrice('SKU-A', 'Liverpool', 14999, '2026-05-11');
    const b = syntheticPrice('SKU-B', 'Liverpool', 14999, '2026-05-11');
    expect(a).not.toBe(b);
  });

  it('changes when retailer changes', () => {
    const a = syntheticPrice('LG-WT2025FW', 'Coppel', 14999, '2026-05-11');
    const b = syntheticPrice('LG-WT2025FW', 'Liverpool', 14999, '2026-05-11');
    expect(a).not.toBe(b);
  });

  it('changes when date changes', () => {
    const a = syntheticPrice('LG-WT2025FW', 'Liverpool', 14999, '2026-05-11');
    const b = syntheticPrice('LG-WT2025FW', 'Liverpool', 14999, '2026-05-12');
    expect(a).not.toBe(b);
  });

  it('stays within [-8%, +15%) band of current price', () => {
    const current = 10000;
    for (const retailer of RETAILERS) {
      for (let i = 0; i < 20; i++) {
        const price = syntheticPrice(`SKU-${i}`, retailer, current, '2026-05-11');
        expect(price).toBeGreaterThanOrEqual(current * 0.92 - 0.01);
        expect(price).toBeLessThan(current * 1.15 + 0.01);
      }
    }
  });

  it('rounds to 2 decimal places', () => {
    const price = syntheticPrice('TEST', 'Coppel', 12345.67, '2026-05-11');
    const cents = Math.round(price * 100);
    expect(cents).toBe(price * 100);
  });
});

describe('syntheticCompetitors', () => {
  it('returns prices for all 5 retailers', () => {
    const bundle = syntheticCompetitors('LG-WT2025FW', 14999, '2026-05-11');
    expect(bundle.prices).toHaveLength(5);
    expect(bundle.prices.map((p) => p.retailer)).toEqual(RETAILERS);
  });

  it('competitor_min_mxn equals the lowest price in the bundle', () => {
    const bundle = syntheticCompetitors('LG-WT2025FW', 14999, '2026-05-11');
    const min = Math.min(...bundle.prices.map((p) => p.price_mxn));
    expect(bundle.competitor_min_mxn).toBe(min);
  });

  it('competitor_min_source has synthetic: prefix', () => {
    const bundle = syntheticCompetitors('LG-WT2025FW', 14999, '2026-05-11');
    expect(bundle.competitor_min_source).toMatch(/^synthetic:/);
  });

  it('tie-breaks by retailer array order (Coppel wins ties)', () => {
    // Find a case where two retailers produce the same price (unlikely but test the logic)
    // Actually, test that the source matches the first occurrence in array order
    const bundle = syntheticCompetitors('TIE-TEST', 10000, '2026-05-11');
    const minPrice = bundle.competitor_min_mxn;
    const firstWithMin = bundle.prices.find((p) => p.price_mxn === minPrice);
    expect(bundle.competitor_min_source).toBe(`synthetic:${firstWithMin?.retailer}`);
  });

  it('is deterministic across calls', () => {
    const a = syntheticCompetitors('LG-WT2025FW', 14999, '2026-05-11');
    const b = syntheticCompetitors('LG-WT2025FW', 14999, '2026-05-11');
    expect(a).toEqual(b);
  });
});
