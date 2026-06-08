import { normalizeShopifyVendor } from './shopify-normalization.js';

export type VendorKind = 'brand_like' | 'distributor' | 'unknown';

export type VendorClassification = {
  vendor: string;
  kind: VendorKind;
  reason: string;
  can_use_as_brand_fallback: boolean;
};

const brandLikeVendorReasons = new Map<string, string>([
  ['BOGNER', 'Vendor conocido como marca de producto en el catalogo Mi Pase.'],
  ['CARABELA', 'Vendor conocido como marca de motos/productos Carabela.'],
  ['COLCHONES CANADA', 'Vendor conocido como marca de descanso/colchones.'],
  ['LG', 'Vendor coincide con marca fabricante.'],
  ['MABE', 'Vendor coincide con marca fabricante.'],
  ['NUUR', 'Vendor conocido como marca de productos NUUR.'],
  ['SENWA', 'Vendor conocido como marca de audifonos/dispositivos SENWA.'],
]);

const distributorVendorReasons = new Map<string, string>([
  ['CAPITAL NETWORK', 'Vendor funciona como vendedor/distribuidor; no necesariamente es marca real.'],
  ['CELMI', 'Vendor funciona como vendedor/distribuidor de telefonia; no es marca real de iPhone/Samsung/Motorola/etc.'],
  ['TopSeller', 'Vendor funciona como vendedor/distribuidor; la marca real suele venir en el titulo.'],
  ['UNIVERSODEFRAGANCIAS', 'Vendor funciona como vendedor/distribuidor de fragancias; la marca real suele venir en el titulo.'],
]);

export function classifyShopifyVendor(vendor: string | null | undefined): VendorClassification {
  const normalized = normalizeShopifyVendor(vendor);

  if (!normalized) {
    return {
      vendor: '',
      kind: 'unknown',
      reason: 'Vendor vacio o ausente.',
      can_use_as_brand_fallback: false,
    };
  }

  const brandLikeReason = brandLikeVendorReasons.get(normalized);
  if (brandLikeReason) {
    return {
      vendor: normalized,
      kind: 'brand_like',
      reason: brandLikeReason,
      can_use_as_brand_fallback: true,
    };
  }

  const distributorReason = distributorVendorReasons.get(normalized);
  if (distributorReason) {
    return {
      vendor: normalized,
      kind: 'distributor',
      reason: distributorReason,
      can_use_as_brand_fallback: false,
    };
  }

  return {
    vendor: normalized,
    kind: 'unknown',
    reason: 'Vendor sin regla explicita; requiere revision antes de usarlo como marca.',
    can_use_as_brand_fallback: false,
  };
}
