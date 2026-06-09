import { describe, expect, it } from 'vitest';
import { classifyShopifyVendor } from './vendor-rules.js';

describe('classifyShopifyVendor', () => {
  it('classifies brand-like vendors that can be used as brand fallback', () => {
    expect(classifyShopifyVendor('LG')).toMatchObject({
      vendor: 'LG',
      kind: 'brand_like',
      can_use_as_brand_fallback: true,
    });
    expect(classifyShopifyVendor('Mabe')).toMatchObject({
      vendor: 'MABE',
      kind: 'brand_like',
      can_use_as_brand_fallback: true,
    });
    expect(classifyShopifyVendor('Nuur')).toMatchObject({
      vendor: 'NUUR',
      kind: 'brand_like',
      can_use_as_brand_fallback: true,
    });
  });

  it('classifies distributor vendors that must not be used as real brands', () => {
    expect(classifyShopifyVendor('CELMI')).toMatchObject({
      vendor: 'CELMI',
      kind: 'distributor',
      can_use_as_brand_fallback: false,
    });
    expect(classifyShopifyVendor('UNIVERSODEFRAGANCIAS')).toMatchObject({
      vendor: 'UNIVERSODEFRAGANCIAS',
      kind: 'distributor',
      can_use_as_brand_fallback: false,
    });
    expect(classifyShopifyVendor('TopSeller')).toMatchObject({
      vendor: 'TopSeller',
      kind: 'distributor',
      can_use_as_brand_fallback: false,
    });
  });

  it('keeps unknown vendors conservative', () => {
    expect(classifyShopifyVendor('Proveedor Nuevo')).toMatchObject({
      vendor: 'Proveedor Nuevo',
      kind: 'unknown',
      can_use_as_brand_fallback: false,
    });
  });

  it('keeps missing vendors conservative', () => {
    expect(classifyShopifyVendor(null)).toMatchObject({
      vendor: '',
      kind: 'unknown',
      can_use_as_brand_fallback: false,
    });
  });
});
