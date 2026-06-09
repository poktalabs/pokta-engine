/**
 * Per-category breakdown for Mi PASE daily pricing pipeline.
 *
 * Infers a product category from the Spanish product title and aggregates
 * pricing impact statistics per category.
 */

import type { Decision } from './pricing-logic.js';

export type Category =
  | 'lavadoras'
  | 'bocinas'
  | 'asadores'
  | 'audifonos'
  | 'bases_cama'
  | 'calentadores'
  | 'bidets'
  | 'campanas'
  | 'colchones'
  | 'otros';

export type CategoryStats = {
  category: Category;
  count: number;
  total_current_mxn: number;
  total_suggested_mxn: number;
  total_reduction_mxn: number;
  avg_pct_reduction: number;  // mean pct over rows where decision = lower_to_competitor (0 if none)
  lower_count: number;        // SKUs with decision = lower_to_competitor
};

/**
 * Infer category from product title using ordered keyword rules (first match wins).
 */
export function inferCategory(title: string): Category {
  if (/asador.*carb/i.test(title)) return 'asadores';
  if (/lavadora/i.test(title)) return 'lavadoras';
  if (/bocina|bluetooth.*portatil|xboom/i.test(title)) return 'bocinas';
  if (/audifono|diadema/i.test(title)) return 'audifonos';
  if (/base.*universal|base.*king|base.*queen|base.*matrimonial|base.*individual/i.test(title)) return 'bases_cama';
  if (/calentador/i.test(title)) return 'calentadores';
  if (/bide|bidé/i.test(title)) return 'bidets';
  if (/campana/i.test(title)) return 'campanas';
  if (/colchon|colchón/i.test(title)) return 'colchones';
  return 'otros';
}

export type CategoryInputRow = {
  sku: string;
  title: string;
  current_price_mxn: number;
  suggested_price_mxn: number | null;
  decision: Decision;
  status: 'ok' | 'skipped' | 'failed_with_reason';
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aggregate pricing impact by category.
 * - Skips rows with status != 'ok' from revenue totals.
 * - avg_pct_reduction averages only over decision='lower_to_competitor' rows.
 * - Output sorted by total_reduction_mxn DESC.
 * - Only includes categories present in input.
 */
export function aggregateByCategory(rows: CategoryInputRow[]): CategoryStats[] {
  const statsMap = new Map<Category, {
    count: number;
    total_current_mxn: number;
    total_suggested_mxn: number;
    total_reduction_mxn: number;
    lower_pcts: number[];
    lower_count: number;
  }>();

  for (const row of rows) {
    const cat = inferCategory(row.title);

    if (!statsMap.has(cat)) {
      statsMap.set(cat, {
        count: 0,
        total_current_mxn: 0,
        total_suggested_mxn: 0,
        total_reduction_mxn: 0,
        lower_pcts: [],
        lower_count: 0,
      });
    }

    const entry = statsMap.get(cat)!;
    entry.count += 1;

    if (row.status === 'ok') {
      entry.total_current_mxn += row.current_price_mxn;

      if (row.suggested_price_mxn != null) {
        entry.total_suggested_mxn += row.suggested_price_mxn;
      }

      if (row.decision === 'lower_to_competitor' && row.suggested_price_mxn != null) {
        const reduction = row.current_price_mxn - row.suggested_price_mxn;
        entry.total_reduction_mxn += reduction;
        const pct = (reduction / row.current_price_mxn) * 100;
        entry.lower_pcts.push(pct);
        entry.lower_count += 1;
      }
    }
  }

  const result: CategoryStats[] = [];

  for (const [category, entry] of statsMap) {
    const avg_pct_reduction =
      entry.lower_pcts.length > 0
        ? round2(entry.lower_pcts.reduce((a, b) => a + b, 0) / entry.lower_pcts.length)
        : 0;

    result.push({
      category,
      count: entry.count,
      total_current_mxn: round2(entry.total_current_mxn),
      total_suggested_mxn: round2(entry.total_suggested_mxn),
      total_reduction_mxn: round2(entry.total_reduction_mxn),
      avg_pct_reduction,
      lower_count: entry.lower_count,
    });
  }

  // Sort by total_reduction_mxn DESC
  result.sort((a, b) => b.total_reduction_mxn - a.total_reduction_mxn);

  return result;
}
