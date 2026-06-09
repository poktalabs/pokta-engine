import { describe, expect, it } from 'vitest';
import { estimateModel, isStrongSkuSignal } from './model-extraction.js';

describe('isStrongSkuSignal', () => {
  it('keeps likely manufacturer model SKUs as strong signals', () => {
    expect(isStrongSkuSignal('WT19DPBK')).toBe(true);
    expect(isStrongSkuSignal('MS3032JAS')).toBe(true);
    expect(isStrongSkuSignal('CMPU501GX0')).toBe(true);
  });

  it('rejects generic, numeric, compound and capacity-only SKUs', () => {
    expect(isStrongSkuSignal('SKU020')).toBe(false);
    expect(isStrongSkuSignal('11111')).toBe(false);
    expect(isStrongSkuSignal('2025-DIRT3-250CC-ROJA')).toBe(false);
    expect(isStrongSkuSignal('IPHONE-15-PRO-MAX-256')).toBe(false);
    expect(isStrongSkuSignal('90cc')).toBe(false);
    expect(isStrongSkuSignal('19kg')).toBe(false);
    expect(isStrongSkuSignal('128gb')).toBe(false);
  });
});

describe('estimateModel', () => {
  it('uses strong SKU as estimated model', () => {
    expect(estimateModel({
      sku: 'WT19DPBK',
      title: 'Lavadora LG Carga Superior Inverter 19kg WT19DPBK',
    })).toMatchObject({
      modelo_estimado: 'WT19DPBK',
      modelo_confianza: 'high',
      modelo_source: 'sku_rule',
      sku_es_senal_fuerte: true,
    });
  });

  it('does not use long compound SKU as model', () => {
    expect(estimateModel({
      sku: '2025-DIRT3-250CC-ROJA',
      title: '2025 DIRT3 roja 250cc',
    })).toMatchObject({
      modelo_confianza: 'pending',
      modelo_source: 'none',
      sku_es_senal_fuerte: false,
    });
  });

  it('can use a controlled commercial model even when SKU is generic', () => {
    expect(estimateModel({
      sku: 'SKU020',
      title: 'DKNY Be Delicious',
    })).toMatchObject({
      modelo_estimado: 'DKNY Be Delicious',
      modelo_confianza: 'medium',
      modelo_source: 'title_rule',
      sku_es_senal_fuerte: false,
    });
  });

  it('does not use numeric SKU as model', () => {
    expect(estimateModel({
      sku: '11111',
      title: 'AC50 4G',
    })).toMatchObject({
      modelo_confianza: 'pending',
      modelo_source: 'none',
      sku_es_senal_fuerte: false,
    });
  });

  it('can surface a weak title model token for later validation', () => {
    expect(estimateModel({
      sku: 'IPHONE-15-PRO-MAX-256',
      title: 'IPHONE 15 PRO MAX RFB 5G ESIM 256GB',
    })).toMatchObject({
      modelo_estimado: 'IPHONE 15 PRO MAX',
      modelo_confianza: 'medium',
      modelo_source: 'title_rule',
      sku_es_senal_fuerte: false,
    });
  });

  it('extracts controlled commercial models from title without relying on SKU', () => {
    expect(estimateModel({
      sku: 'A16-5G',
      title: 'Samsung Galaxy A16 5G',
    }).modelo_estimado).toBe('Samsung Galaxy A16 5G');

    expect(estimateModel({
      sku: 'G35-5G',
      title: 'Motorola Moto G35 5G',
    }).modelo_estimado).toBe('Motorola Moto G35 5G');

    expect(estimateModel({
      sku: 'SKU024',
      title: 'Coach Wild Rose',
    }).modelo_estimado).toBe('Coach Wild Rose');

    expect(estimateModel({
      sku: 'SKU020',
      title: 'DKNY Be Delicious',
    }).modelo_estimado).toBe('DKNY Be Delicious');

    expect(estimateModel({
      sku: 'TONE-T90S',
      title: 'LG TONE Free T90S con Dolby Atmos',
    }).modelo_estimado).toBe('LG TONE Free T90S');
  });
});
