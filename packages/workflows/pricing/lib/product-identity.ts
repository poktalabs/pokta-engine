import {
  normalizeShopifyProductType,
  normalizeShopifyVendor,
} from './shopify-normalization.js';
import { extractMarcaEmpresaFromTitle } from './brand-extraction.js';
import {
  classifyShopifyVendor,
  type VendorKind,
} from './vendor-rules.js';
import {
  estimateModel,
} from './model-extraction.js';
import { resolveInternalCategory } from './internal-category.js';

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'pending';
export type IdentitySource =
  | 'shopify'
  | 'title_rule'
  | 'vendor_rule'
  | 'sku_rule'
  | 'manual'
  | 'enriched_catalog'
  | 'none';

export type ShopifyProductForIdentity = {
  id: number;
  title: string;
  vendor?: string | null;
  product_type?: string | null;
};

export type ShopifyVariantForIdentity = {
  id: number;
  sku: string | null;
  title?: string | null;
  price: string;
  barcode?: string | null;
};

export type ProductIdentity = {
  sku: string;
  title_shopify: string;
  price_mipase: number;
  vendor_shopify?: string;
  vendor_kind: VendorKind;
  product_type_shopify?: string;
  shopify_product_id: number;
  shopify_variant_id: number;
  barcode?: string;
  ean?: string;
  gtin?: string;
  marca_empresa?: string;
  marca_empresa_confianza: ConfidenceLevel;
  marca_empresa_source: IdentitySource;
  modelo_estimado?: string;
  modelo_confianza: ConfidenceLevel;
  modelo_source: IdentitySource;
  categoria_interna?: string;
  categoria_confianza: ConfidenceLevel;
  categoria_source: IdentitySource;
  sku_es_senal_fuerte: boolean;
  palabras_requeridas: string[];
  palabras_prohibidas: string[];
};

function compactText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForCompare(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parsePrice(value: string): number | null {
  const price = Number.parseFloat(value);
  return Number.isFinite(price) ? price : null;
}

function variantTitleForIdentity(variantTitle: string | null | undefined): string | null {
  if (!variantTitle) return null;
  const normalized = variantTitle.trim();
  if (normalized === '' || normalized.toLowerCase() === 'default title') {
    return null;
  }
  return normalized;
}

export function classifyVendorKind(vendor: string | null | undefined): VendorKind {
  return classifyShopifyVendor(vendor).kind;
}

function titleContainsVendor(title: string, vendor: string): boolean {
  const normalizedTitle = normalizeForCompare(title);
  const normalizedVendor = normalizeForCompare(vendor);
  return normalizedVendor.length > 0 && normalizedTitle.includes(normalizedVendor);
}

export { isStrongSkuSignal } from './model-extraction.js';

function identityBrandFromVendor(title: string, vendor: string | undefined, vendorKind: VendorKind): {
  marca_empresa?: string;
  marca_empresa_confianza: ConfidenceLevel;
  marca_empresa_source: IdentitySource;
} {
  if (!vendor || vendorKind !== 'brand_like') {
    return {
      marca_empresa_confianza: 'pending',
      marca_empresa_source: 'none',
    };
  }

  if (!titleContainsVendor(title, vendor)) {
    return {
      marca_empresa_confianza: 'pending',
      marca_empresa_source: 'none',
    };
  }

  return {
    marca_empresa: vendor,
    marca_empresa_confianza: 'high',
    marca_empresa_source: 'vendor_rule',
  };
}

function identityBrandForProduct(input: {
  title: string;
  sku: string;
  vendor?: string;
  vendorKind: VendorKind;
  productType?: string;
}): {
  marca_empresa?: string;
  marca_empresa_confianza: ConfidenceLevel;
  marca_empresa_source: IdentitySource;
} {
  const vendorBrand = identityBrandFromVendor(input.title, input.vendor, input.vendorKind);
  if (vendorBrand.marca_empresa) return vendorBrand;

  const titleBrand = extractMarcaEmpresaFromTitle({
    title: input.title,
    sku: input.sku,
    vendor_shopify: input.vendor,
    product_type: input.productType,
  });

  return {
    ...(titleBrand.marca_empresa ? { marca_empresa: titleBrand.marca_empresa } : {}),
    marca_empresa_confianza: titleBrand.marca_empresa_confianza,
    marca_empresa_source: titleBrand.marca_empresa_source,
  };
}

export function buildProductIdentityFromShopify(
  product: ShopifyProductForIdentity,
  variant: ShopifyVariantForIdentity
): ProductIdentity | null {
  const sku = variant.sku?.trim();
  const price = parsePrice(variant.price);
  if (!sku || price == null) return null;

  const titleShopify = compactText([
    product.title,
    variantTitleForIdentity(variant.title),
  ]);
  if (!titleShopify) return null;

  const vendorShopify = normalizeShopifyVendor(product.vendor);
  const productTypeShopify = normalizeShopifyProductType(product.product_type);
  const vendorClassification = classifyShopifyVendor(vendorShopify);
  const vendorKind = vendorClassification.kind;
  const brand = identityBrandForProduct({
    title: titleShopify,
    sku,
    vendor: vendorShopify || undefined,
    vendorKind,
    productType: productTypeShopify || undefined,
  });
  const model = estimateModel({
    sku,
    title: titleShopify,
    brand: brand.marca_empresa,
    product_type: productTypeShopify || undefined,
  });
  const category = resolveInternalCategory({
    title: titleShopify,
    sku,
    vendor_shopify: vendorShopify || undefined,
    product_type: productTypeShopify || undefined,
    marca_empresa: brand.marca_empresa,
  });

  return {
    sku,
    title_shopify: titleShopify,
    price_mipase: price,
    ...(vendorShopify ? { vendor_shopify: vendorShopify } : {}),
    vendor_kind: vendorKind,
    ...(productTypeShopify ? { product_type_shopify: productTypeShopify } : {}),
    shopify_product_id: product.id,
    shopify_variant_id: variant.id,
    ...(variant.barcode ? { barcode: variant.barcode } : {}),
    ...brand,
    ...(model.modelo_estimado ? { modelo_estimado: model.modelo_estimado } : {}),
    modelo_confianza: model.modelo_confianza,
    modelo_source: model.modelo_source,
    ...(category.categoria_interna ? { categoria_interna: category.categoria_interna } : {}),
    categoria_confianza: category.categoria_confianza,
    categoria_source: category.categoria_source,
    sku_es_senal_fuerte: model.sku_es_senal_fuerte,
    palabras_requeridas: [],
    palabras_prohibidas: [],
  };
}
