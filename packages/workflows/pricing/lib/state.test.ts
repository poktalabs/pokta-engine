import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadState,
  saveState,
  shouldSkipUpdate,
  recordApplied,
  type LastAppliedState,
} from './state.js';

let tmpDir: string;

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `state-test-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('loadState', () => {
  it('returns empty initial state when file does not exist', () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'last-applied.json');
    const state = loadState(filePath);
    expect(state.schema_version).toBe(1);
    expect(state.entries).toEqual({});
    expect(typeof state.updated_at).toBe('string');
  });

  it('parses and returns a valid existing state file', () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'last-applied.json');
    const fixture: LastAppliedState = {
      schema_version: 1,
      updated_at: '2026-05-11T00:00:00.000Z',
      entries: {
        '12345': {
          variant_id: 12345,
          sku: 'LG-WT2025FW',
          last_applied_price_mxn: 13899,
          applied_at: '2026-05-11T00:00:00.000Z',
        },
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), 'utf8');
    const state = loadState(filePath);
    expect(state.schema_version).toBe(1);
    expect(state.entries['12345'].sku).toBe('LG-WT2025FW');
    expect(state.entries['12345'].last_applied_price_mxn).toBe(13899);
  });

  it('throws on malformed JSON', () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'last-applied.json');
    fs.writeFileSync(filePath, '{ not valid json }', 'utf8');
    expect(() => loadState(filePath)).toThrow();
  });
});

describe('saveState + loadState round-trip', () => {
  it('preserves all entries through a save/load cycle', () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'last-applied.json');
    const initial = loadState(filePath);
    const withEntry = recordApplied(initial, 99, 'SKU-99', 14500);
    saveState(filePath, withEntry);
    const reloaded = loadState(filePath);
    expect(reloaded.entries['99'].sku).toBe('SKU-99');
    expect(reloaded.entries['99'].last_applied_price_mxn).toBe(14500);
  });
});

describe('shouldSkipUpdate', () => {
  it('returns false when no prior entry exists (always apply first time)', () => {
    const state = loadState('/nonexistent/path/that/does/not/exist.json');
    const result = shouldSkipUpdate(state, 12345, 13899);
    expect(result).toBe(false);
  });

  it('returns true when price diff is within threshold (0.5% < 1%)', () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'last-applied.json');
    const initial = loadState(filePath);
    const withEntry = recordApplied(initial, 12345, 'SKU-A', 13899);
    saveState(filePath, withEntry);
    const state = loadState(filePath);
    // 0.5% of 13899 = ~69.5; new price 13969 is 0.5% higher
    const newPrice = 13899 * 1.005;
    const result = shouldSkipUpdate(state, 12345, newPrice, 0.01);
    expect(result).toBe(true);
  });

  it('returns false when price diff exceeds threshold (2% > 1%)', () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'last-applied.json');
    const initial = loadState(filePath);
    const withEntry = recordApplied(initial, 12345, 'SKU-A', 13899);
    saveState(filePath, withEntry);
    const state = loadState(filePath);
    // 2% of 13899 = ~278; new price is 2% higher
    const newPrice = 13899 * 1.02;
    const result = shouldSkipUpdate(state, 12345, newPrice, 0.01);
    expect(result).toBe(false);
  });
});

describe('recordApplied', () => {
  it('adds new entry, preserves existing entries, and refreshes updated_at', () => {
    tmpDir = makeTmpDir();
    const filePath = path.join(tmpDir, 'last-applied.json');
    const initial = loadState(filePath);
    // Add first entry
    const withFirst = recordApplied(initial, 111, 'SKU-111', 10000);
    // Add second entry
    const withSecond = recordApplied(withFirst, 222, 'SKU-222', 20000);

    expect(withSecond.entries['111'].sku).toBe('SKU-111');
    expect(withSecond.entries['111'].last_applied_price_mxn).toBe(10000);
    expect(withSecond.entries['222'].sku).toBe('SKU-222');
    expect(withSecond.entries['222'].last_applied_price_mxn).toBe(20000);
    expect(typeof withSecond.updated_at).toBe('string');
  });

  it('upserts existing entry with new price', () => {
    const initial = loadState('/nonexistent/path/that/does/not/exist.json');
    const v1 = recordApplied(initial, 333, 'SKU-333', 15000);
    const v2 = recordApplied(v1, 333, 'SKU-333', 16000);

    expect(v2.entries['333'].last_applied_price_mxn).toBe(16000);
    // Only one key for this variant
    expect(Object.keys(v2.entries)).toHaveLength(1);
  });
});
