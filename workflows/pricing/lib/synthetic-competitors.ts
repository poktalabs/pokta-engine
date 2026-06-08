/**
 * Synthetic competitor pricing for POC.
 *
 * Spec: workstreams/daily-pricing-pipeline/docs/csv-row-spec-2026-05-11.md
 *
 * Every (sku, retailer, date) tuple deterministically yields one price:
 *   seed = sha256(sku + "|" + retailer + "|" + iso_date)
 *   unit = first 8 bytes as uint64 / 2^64  → [0, 1)
 *   offset_pct = -0.08 + (unit * 0.23)     → [-8%, +15%)
 *   price = round(current * (1 + offset_pct), 2)
 *
 * Reproducible across reruns. Asymmetric band reflects typical retail behavior
 * (competitors more often undercut than over-mark).
 */

import { createHash } from 'node:crypto';

export const RETAILERS = [
  'Coppel',
  'Elektra',
  'Liverpool',
  'Amazon MX',
  'Mercado Libre MX',
] as const;

export type Retailer = (typeof RETAILERS)[number];

export type RetailerPrice = {
  retailer: Retailer;
  price_mxn: number;
};

export type SyntheticCompetitorBundle = {
  prices: RetailerPrice[];
  competitor_min_mxn: number;
  competitor_min_source: string;
};

/**
 * Deterministic synthetic price for one (sku, retailer, date) tuple.
 */
export function syntheticPrice(
  sku: string,
  retailer: Retailer,
  current_price_mxn: number,
  date_iso: string
): number {
  const input = `${sku}|${retailer}|${date_iso}`;
  const hash = createHash('sha256').update(input).digest();

  // First 8 bytes → uint64 → unit interval [0, 1)
  const uint64 = hash.readBigUInt64BE(0);
  const unit = Number(uint64) / Number(2n ** 64n);

  // Map to [-8%, +15%)
  const offset_pct = -0.08 + unit * 0.23;
  const price = current_price_mxn * (1 + offset_pct);

  return round2(price);
}

/**
 * Generate synthetic prices for all 5 retailers, return bundle with min.
 */
export function syntheticCompetitors(
  sku: string,
  current_price_mxn: number,
  date_iso: string
): SyntheticCompetitorBundle {
  const prices: RetailerPrice[] = RETAILERS.map((retailer) => ({
    retailer,
    price_mxn: syntheticPrice(sku, retailer, current_price_mxn, date_iso),
  }));

  // Find min — ties broken by array order (Coppel first)
  let min_idx = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i].price_mxn < prices[min_idx].price_mxn) {
      min_idx = i;
    }
  }

  return {
    prices,
    competitor_min_mxn: prices[min_idx].price_mxn,
    competitor_min_source: `synthetic:${prices[min_idx].retailer}`,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
