import { describe, expect, it } from 'vitest';
import {
  buildProductIdentityFromShopify,
  classifyVendorKind,
  isStrongSkuSignal,
  type ShopifyProductForIdentity,
} from './product-identity.js';

const baseProduct: ShopifyProductForIdentity = {
  id: 100,
  title: 'Lavadora LG Carga Superior Inverter 19kg',
  vendor: 'LG',
  product_type: 'Lavadora',
};

const baseVariant = {
  id: 200,
  sku: 'WT19DPBK',
  title: 'Default Title',
  price: '10800.00',
  barcode: null,
};

describe('classifyVendorKind', () => {
  it('classifies known brand-like vendors', () => {
    expect(classifyVendorKind('LG')).toBe('brand_like');
    expect(classifyVendorKind('Mabe')).toBe('brand_like');
    expect(classifyVendorKind('Nuur')).toBe('brand_like');
  });

  it('classifies known distributor vendors', () => {
    expect(classifyVendorKind('CELMI')).toBe('distributor');
    expect(classifyVendorKind('UNIVERSODEFRAGANCIAS')).toBe('distributor');
    expect(classifyVendorKind('TopSeller')).toBe('distributor');
  });

  it('classifies missing or unknown vendors conservatively', () => {
    expect(classifyVendorKind(null)).toBe('unknown');
    expect(classifyVendorKind('Proveedor Nuevo')).toBe('unknown');
  });
});

describe('isStrongSkuSignal', () => {
  it('keeps manufacturer-like SKUs as strong signals', () => {
    expect(isStrongSkuSignal('WT19DPBK')).toBe(true);
    expect(isStrongSkuSignal('MS3032JAS')).toBe(true);
  });

  it('rejects weak, generic, numeric or compound SKUs as strong signals', () => {
    expect(isStrongSkuSignal('SKU020')).toBe(false);
    expect(isStrongSkuSignal('11111')).toBe(false);
    expect(isStrongSkuSignal('2025-DIRT3-250CC-ROJA')).toBe(false);
    expect(isStrongSkuSignal('IPHONE-15-PRO-MAX-256')).toBe(false);
  });
});

describe('buildProductIdentityFromShopify', () => {
  it('builds identity for a product where vendor is the real brand', () => {
    const identity = buildProductIdentityFromShopify(baseProduct, baseVariant);

    expect(identity).toMatchObject({
      sku: 'WT19DPBK',
      title_shopify: 'Lavadora LG Carga Superior Inverter 19kg',
      price_mipase: 10800,
      vendor_shopify: 'LG',
      vendor_kind: 'brand_like',
      product_type_shopify: 'Lavadora',
      shopify_product_id: 100,
      shopify_variant_id: 200,
      marca_empresa: 'LG',
      marca_empresa_confianza: 'high',
      marca_empresa_source: 'vendor_rule',
      modelo_estimado: 'WT19DPBK',
      modelo_confianza: 'medium',
      modelo_source: 'sku_rule',
      categoria_interna: 'Lavadora',
      categoria_confianza: 'medium',
      categoria_source: 'shopify',
      sku_es_senal_fuerte: true,
    });
  });

  it('does not treat distributor vendor as the real brand', () => {
    const identity = buildProductIdentityFromShopify(
      {
        id: 101,
        title: 'IPHONE 15 PRO MAX RFB 5G ESIM 256GB',
        vendor: 'CELMI',
        product_type: 'Celulares',
      },
      {
        id: 201,
        sku: 'IPHONE-15-PRO-MAX-256',
        title: 'Default Title',
        price: '22000.00',
      }
    );

    expect(identity).toMatchObject({
      sku: 'IPHONE-15-PRO-MAX-256',
      vendor_shopify: 'CELMI',
      vendor_kind: 'distributor',
      marca_empresa: 'Apple',
      marca_empresa_confianza: 'high',
      marca_empresa_source: 'title_rule',
      modelo_estimado: 'IPHONE 15 PRO MAX',
      modelo_confianza: 'medium',
      modelo_source: 'title_rule',
      categoria_interna: 'Celulares',
      sku_es_senal_fuerte: false,
    });
  });

  it('extracts real brand from distributor fragrance titles', () => {
    const identity = buildProductIdentityFromShopify(
      {
        id: 102,
        title: 'Calvin Klein Eternity Dama',
        vendor: 'UNIVERSODEFRAGANCIAS',
        product_type: 'fragancia',
      },
      {
        id: 202,
        sku: '0883001014056',
        title: 'Default Title',
        price: '1199.00',
      }
    );

    expect(identity).toMatchObject({
      vendor_shopify: 'UNIVERSODEFRAGANCIAS',
      vendor_kind: 'distributor',
      marca_empresa: 'Calvin Klein',
      marca_empresa_confianza: 'high',
      marca_empresa_source: 'title_rule',
    });
  });

  it('extracts real brand from TopSeller title instead of using vendor', () => {
    const identity = buildProductIdentityFromShopify(
      {
        id: 103,
        title: 'Coach Wild Rose',
        vendor: 'TopSeller',
        product_type: 'perfume',
      },
      {
        id: 203,
        sku: 'SKU024',
        title: 'Default Title',
        price: '1199.00',
      }
    );

    expect(identity).toMatchObject({
      vendor_shopify: 'TopSeller',
      vendor_kind: 'distributor',
      marca_empresa: 'Coach',
      marca_empresa_confianza: 'high',
      marca_empresa_source: 'title_rule',
      modelo_estimado: 'Coach Wild Rose',
      modelo_confianza: 'medium',
      modelo_source: 'title_rule',
      sku_es_senal_fuerte: false,
    });
  });

  it('infers category from title when Shopify product_type is missing', () => {
    const identity = buildProductIdentityFromShopify(
      {
        ...baseProduct,
        product_type: '',
      },
      baseVariant
    );

    expect(identity).toMatchObject({
      categoria_interna: 'Lavadora',
      categoria_confianza: 'medium',
      categoria_source: 'title_rule',
    });
  });

  it('keeps category pending when product_type and title are ambiguous', () => {
    const identity = buildProductIdentityFromShopify(
      {
        id: 104,
        title: 'Producto especial sin datos suficientes',
        vendor: 'Proveedor Nuevo',
        product_type: '',
      },
      {
        id: 204,
        sku: 'SKU020',
        title: 'Default Title',
        price: '500.00',
      }
    );

    expect(identity).toMatchObject({
      categoria_confianza: 'pending',
      categoria_source: 'none',
    });
    expect(identity?.categoria_interna).toBeUndefined();
  });

  it('returns null when SKU or numeric price is missing', () => {
    expect(buildProductIdentityFromShopify(baseProduct, { ...baseVariant, sku: '' })).toBeNull();
    expect(buildProductIdentityFromShopify(baseProduct, { ...baseVariant, price: 'n/a' })).toBeNull();
  });
});
