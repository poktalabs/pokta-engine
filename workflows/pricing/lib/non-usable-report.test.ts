import { describe, expect, it } from 'vitest';
import {
  buildNonUsableReport,
  classifyNonUsableReason,
} from './non-usable-report.js';

describe('classifyNonUsableReason', () => {
  it('groups common no-usable causes into human families', () => {
    expect(classifyNonUsableReason({
      sku: 'A',
      status: 'no_listings',
      price_mxn: null,
      usable_for_pricing: false,
    })).toBe('sin_precio');

    expect(classifyNonUsableReason({
      sku: 'B',
      status: 'ok',
      price_mxn: 100,
      match_reason_code: 'ml_domain_not_allowed',
      usable_for_pricing: false,
    })).toBe('dominio_ml');

    expect(classifyNonUsableReason({
      sku: 'C',
      status: 'ok',
      price_mxn: 100,
      match_reason_code: 'brand_mismatch',
      usable_for_pricing: false,
    })).toBe('marca');

    expect(classifyNonUsableReason({
      sku: 'D',
      status: 'ok',
      price_mxn: 100,
      match_reason_code: 'brand_and_model_missing',
      usable_for_pricing: false,
    })).toBe('modelo_identidad');

    expect(classifyNonUsableReason({
      sku: 'E',
      status: 'ok',
      price_mxn: 100,
      match_reason_code: 'price_outlier_low',
      usable_for_pricing: false,
    })).toBe('precio_sospechoso');
  });
});

describe('buildNonUsableReport', () => {
  it('excludes usable rows and summarizes non-usable groups', () => {
    const report = buildNonUsableReport({
      sourceFile: 'live-prices.json',
      generatedAt: '2026-05-21T00:00:00.000Z',
      rows: [
        {
          sku: 'OK',
          status: 'ok',
          price_mxn: 100,
          usable_for_pricing: true,
        },
        {
          sku: 'BAD',
          status: 'ok',
          price_mxn: 10,
          match_reason_code: 'price_outlier_low',
          match_reason: 'Precio demasiado bajo.',
          usable_for_pricing: false,
        },
      ],
    });

    expect(report.total_rows).toBe(2);
    expect(report.usable_count).toBe(1);
    expect(report.non_usable_count).toBe(1);
    expect(report.items[0]).toMatchObject({
      sku: 'BAD',
      family: 'precio_sospechoso',
      human_reason: 'Precio demasiado bajo.',
    });
  });
});
