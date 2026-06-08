import type { ConfidenceLevel, IdentitySource } from './product-identity.js';

export type ModelExtractionInput = {
  sku: string;
  title?: string;
  brand?: string;
  product_type?: string;
};

export type ModelExtractionResult = {
  modelo_estimado?: string;
  modelo_confianza: ConfidenceLevel;
  modelo_source: IdentitySource;
  sku_es_senal_fuerte: boolean;
  reason: string;
};

const weakExactSkus = new Set([
  '11111',
]);

const weakSkuPrefixes = [
  /^sku\d*$/i,
];

const capacityOrSpecToken = /^(?:\d+(?:\.\d+)?)(?:cc|kg|hz|gb|tb|lt|lts|l|w|cm|mm|hp|ml)$/i;

function compact(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeSku(value: string): string {
  return compact(value);
}

function skuParts(sku: string): string[] {
  return normalizeSku(sku).split(/[-_\s]+/).filter(Boolean);
}

function isNumericOnlySku(sku: string): boolean {
  return /^\d+$/.test(normalizeSku(sku));
}

function isWeakSku(sku: string): boolean {
  const normalized = normalizeSku(sku);
  if (!normalized) return true;
  if (weakExactSkus.has(normalized)) return true;
  if (weakSkuPrefixes.some((pattern) => pattern.test(normalized))) return true;
  if (isNumericOnlySku(normalized)) return true;
  if (skuParts(normalized).length >= 3) return true;
  if (capacityOrSpecToken.test(normalized)) return true;
  return false;
}

export function isStrongSkuSignal(sku: string): boolean {
  const normalized = normalizeSku(sku);
  if (isWeakSku(normalized)) return false;
  if (normalized.includes('-')) return false;
  return /[a-z]/i.test(normalized) && /\d/.test(normalized) && normalized.length >= 4;
}

function titleContainsSku(title: string | undefined, sku: string): boolean {
  if (!title) return false;
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const normalizedSku = sku.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalizedSku.length >= 4 && normalizedTitle.includes(normalizedSku);
}

function firstStrongModelLikeTokenFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  const tokens = title
    .split(/[^a-zA-Z0-9-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const match = tokens.find((token) =>
    /[a-z]/i.test(token) &&
    /\d/.test(token) &&
    token.length >= 4 &&
    !token.includes('-') &&
    !capacityOrSpecToken.test(token)
  );

  return match ?? null;
}

function firstControlledCommercialModelFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  const normalized = compact(title);
  const patterns = [
    /\biPhone\s+\d{1,2}(?:\s+Pro)?(?:\s+Max)?(?:\s+Plus)?(?:\s+\d+\s*(?:GB|TB))?/i,
    /\bSamsung\s+Galaxy\s+[A-Z]?\d{1,3}(?:\s+\dG)?/i,
    /\bGalaxy\s+[A-Z]?\d{1,3}(?:\s+\dG)?/i,
    /\bMotorola\s+Moto\s+[GE]\d{1,3}(?:\s+\dG)?/i,
    /\bMoto\s+[GE]\d{1,3}(?:\s+\dG)?/i,
    /\bHonor\s+[A-Z0-9]+(?:\s+\dG)?/i,
    /\bInfinix\s+[A-Z0-9]+(?:\s+Pro)?(?:\s+\dG)?/i,
    /\bCalvin\s+Klein\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?/i,
    /\bCoach\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?/i,
    /\bArmaf\s+Club\s+De\s+Nuit(?:\s+[A-Z][A-Za-z]+)?/i,
    /\bLattafa\s+[A-Z][A-Za-z]+/i,
    /\bHugo\s+Boss\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?/i,
    /\bAri\s+Ariana\s+Grande\b/i,
    /\bAriana\s+Grande\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?/i,
    /\bCacharel\s+Amor\s+Amor\b/i,
    /\bDKNY\s+Be\s+Delicious\b/i,
    /\bLG\s+Tone\s+Free\s+[A-Z0-9-]+/i,
  ];

  const matched = patterns
    .map((pattern) => pattern.exec(normalized)?.[0])
    .find((value): value is string => Boolean(value));

  return matched?.replace(/\s+/g, ' ').trim() ?? null;
}

export function estimateModel(input: ModelExtractionInput): ModelExtractionResult {
  const sku = normalizeSku(input.sku);
  const skuIsWeak = isWeakSku(sku);

  if (isStrongSkuSignal(sku)) {
    return {
      modelo_estimado: sku,
      modelo_confianza: titleContainsSku(input.title, sku) ? 'high' : 'medium',
      modelo_source: 'sku_rule',
      sku_es_senal_fuerte: true,
      reason: titleContainsSku(input.title, sku)
        ? 'SKU parece modelo de fabricante y aparece en el titulo.'
        : 'SKU parece modelo de fabricante.',
    };
  }

  const commercialModel = firstControlledCommercialModelFromTitle(input.title);
  if (commercialModel) {
    return {
      modelo_estimado: commercialModel,
      modelo_confianza: 'medium',
      modelo_source: 'title_rule',
      sku_es_senal_fuerte: false,
      reason: 'Se encontro modelo comercial por regla controlada en titulo.',
    };
  }

  if (skuIsWeak) {
    return {
      modelo_confianza: 'pending',
      modelo_source: 'none',
      sku_es_senal_fuerte: false,
      reason: 'SKU debil; no se extrae token suelto de titulo para evitar falsos modelos.',
    };
  }

  const titleModel = firstStrongModelLikeTokenFromTitle(input.title);
  if (titleModel) {
    return {
      modelo_estimado: titleModel,
      modelo_confianza: 'low',
      modelo_source: 'title_rule',
      sku_es_senal_fuerte: false,
      reason: 'Se encontro token tipo modelo en titulo, pero requiere validacion posterior.',
    };
  }

  return {
    modelo_confianza: 'pending',
    modelo_source: 'none',
    sku_es_senal_fuerte: false,
    reason: 'No hay modelo fuerte; SKU es generico, compuesto, numerico o solo especificacion/capacidad.',
  };
}
