/**
 * Anti-thrash state file — Stage B primitive.
 * NOT CALLED FROM ANY STAGE A CODE.
 * Reads/writes `state/last-applied.json` to prevent re-applying prices
 * within a 1% threshold (D10 in DECISIONS.md).
 * Will be wired in post-G1 (TASK-006 + TASK-011 + TASK-012).
 */

import * as fs from 'fs';
import * as path from 'path';

export type LastAppliedEntry = {
  variant_id: number;
  sku: string;
  last_applied_price_mxn: number;
  applied_at: string; // ISO timestamp
};

export type LastAppliedState = {
  schema_version: 1;
  updated_at: string;
  entries: Record<string, LastAppliedEntry>; // keyed by variant_id (string)
};

function emptyState(): LastAppliedState {
  return {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    entries: {},
  };
}

/**
 * Reads JSON file at filePath.
 * If missing, returns empty initial state.
 * If malformed, throws.
 */
export function loadState(filePath: string): LastAppliedState {
  if (!fs.existsSync(filePath)) {
    return emptyState();
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  // Will throw SyntaxError on malformed JSON — intentional per spec.
  const parsed = JSON.parse(raw) as LastAppliedState;
  return parsed;
}

/**
 * Writes JSON file with 2-space indent.
 * Updates state.updated_at to now before writing.
 */
export function saveState(filePath: string, state: LastAppliedState): void {
  const toWrite: LastAppliedState = {
    ...state,
    updated_at: new Date().toISOString(),
  };
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(toWrite, null, 2), 'utf8');
}

/**
 * Returns true if a previous entry exists AND the difference between
 * new_price_mxn and last_applied_price_mxn is within threshold_pct.
 * Returns false if no prior entry (always apply first time).
 */
export function shouldSkipUpdate(
  state: LastAppliedState,
  variant_id: number,
  new_price_mxn: number,
  threshold_pct: number = 0.01
): boolean {
  const key = String(variant_id);
  const entry = state.entries[key];

  if (!entry) {
    return false; // no prior entry — always apply first time
  }

  const lastPrice = entry.last_applied_price_mxn;
  const diff = Math.abs(new_price_mxn - lastPrice) / lastPrice;
  return diff < threshold_pct;
}

/**
 * Pure function — returns new state with the entry upserted and updated_at refreshed.
 */
export function recordApplied(
  state: LastAppliedState,
  variant_id: number,
  sku: string,
  new_price_mxn: number
): LastAppliedState {
  const key = String(variant_id);
  const entry: LastAppliedEntry = {
    variant_id,
    sku,
    last_applied_price_mxn: new_price_mxn,
    applied_at: new Date().toISOString(),
  };

  return {
    ...state,
    updated_at: new Date().toISOString(),
    entries: {
      ...state.entries,
      [key]: entry,
    },
  };
}
