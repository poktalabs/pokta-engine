import { normalizeShopifyProductType } from './shopify-normalization.js';
import type { ConfidenceLevel, IdentitySource } from './product-identity.js';

export type InternalCategoryInput = {
  title: string;
  sku?: string | null;
  vendor_shopify?: string | null;
  product_type?: string | null;
  marca_empresa?: string | null;
};

export type InternalCategoryResult = {
  categoria_interna?: string;
  categoria_confianza: ConfidenceLevel;
  categoria_source: IdentitySource;
  reason: string;
};

type CategoryRule = {
  category: string;
  patterns: RegExp[];
  reason: string;
};

function normalizeForRules(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

const titleRules: CategoryRule[] = [
  {
    category: 'Celulares',
    patterns: [
      /\biphone\b/,
      /\bsamsung\b/,
      /\bgalaxy\b/,
      /\bmotorola\b/,
      /\bmoto\s*[ge]\d+\b/,
      /\binfinix\b/,
      /\bhonor\b/,
      /\bcelular(?:es)?\b/,
      /\bsmartphone(?:s)?\b/,
    ],
    reason: 'Titulo contiene senales de telefono/celular.',
  },
  {
    category: 'Lavadora',
    patterns: [
      /\blavadora(?:s)?\b/,
      /\blavasecadora(?:s)?\b/,
      /\bcentro(?:s)?\s+de\s+lavado\b/,
    ],
    reason: 'Titulo contiene senales de lavadora o centro de lavado.',
  },
  {
    category: 'Microondas',
    patterns: [
      /\bmicroondas\b/,
      /\bmicrohondas\b/,
      /\bhorno\s+microondas\b/,
      /\bneochef\b/,
    ],
    reason: 'Titulo contiene senales de microondas.',
  },
  {
    category: 'Pantallas',
    patterns: [
      /\bpantalla(?:s)?\b/,
      /\btelevision(?:es)?\b/,
      /\btv\b/,
      /\bsmart\s+tv\b/,
      /\buhd\b/,
      /\b4k\b/,
    ],
    reason: 'Titulo contiene senales de television/pantalla.',
  },
  {
    category: 'Campana',
    patterns: [
      /\bcampana(?:s)?\b/,
      /\bextractora(?:s)?\b/,
      /\bpurificador(?:es)?\b/,
    ],
    reason: 'Titulo contiene senales de campana de cocina.',
  },
  {
    category: 'Audio',
    patterns: [
      /\bxboom\b/,
      /\bbocina(?:s)?\b/,
      /\bsoundbar(?:s)?\b/,
      /\bbarra\s+de\s+sonido\b/,
      /\baudifono(?:s)?\b/,
      /\bdiadema(?:s)?\b/,
      /\btone\s+free\b/,
      /\bdolby\s+atmos\b/,
    ],
    reason: 'Titulo contiene senales de audio.',
  },
  {
    category: 'MOTO',
    patterns: [
      /\bcarabela\b/,
      /\bmoto(?:s)?\b/,
      /\bmotoneta(?:s)?\b/,
      /\b\d{2,4}\s*cc\b/,
      /\bgo\s+kart\b/,
    ],
    reason: 'Titulo contiene senales de moto/motoneta.',
  },
  {
    category: 'Fragancia',
    patterns: [
      /\bperfume(?:s)?\b/,
      /\bfragancia(?:s)?\b/,
      /\bhalloween\b/,
      /\bedp\b/,
      /\bedt\b/,
      /\bspray\b/,
      /\bariana\s+grande\b/,
      /\bcacharel\b/,
      /\bamor\s+amor\b/,
      /\bdkny\b/,
      /\bbe\s+delicious\b/,
      /\bcalvin\s+klein\b/,
      /\bcoach\b/,
      /\barmaf\b/,
      /\blattafa\b/,
      /\bhugo\s+boss\b/,
    ],
    reason: 'Titulo contiene senales de fragancia/perfume.',
  },
  {
    category: 'Descanso/Colchon',
    patterns: [
      /\bcolchon(?:es)?\b/,
      /\bbase\s+(?:matrimonial|individual|king|queen|ks|qs)\b/,
    ],
    reason: 'Titulo contiene senales de colchon o base de descanso.',
  },
  {
    category: 'Computacion',
    patterns: [
      /\blaptop(?:s)?\b/,
      /\bmonitor(?:es)?\b/,
      /\bcomputadora(?:s)?\b/,
      /\bpc\b/,
    ],
    reason: 'Titulo contiene senales de computacion.',
  },
  {
    category: 'Lavavajillas',
    patterns: [
      /\blavavajillas\b/,
    ],
    reason: 'Titulo contiene senales de lavavajillas.',
  },
  {
    category: 'Aire Acondicionado',
    patterns: [
      /\baire(?:s)?\s+acondicionado(?:s)?\b/,
      /\bminisplit(?:s)?\b/,
      /\bmini\s+split(?:s)?\b/,
    ],
    reason: 'Titulo contiene senales de aire acondicionado.',
  },
  {
    category: 'Asador',
    patterns: [
      /\basador(?:es)?\b/,
      /\bparrilla(?:s)?\b/,
      /\bgrill(?:s)?\b/,
    ],
    reason: 'Titulo contiene senales de asador/parrilla.',
  },
  {
    category: 'Bidet',
    patterns: [
      /\bbide(?:t|ts)?\b/,
      /\bwc\s+inteligente\b/,
    ],
    reason: 'Titulo contiene senales de bidet.',
  },
  {
    category: 'Cafetera',
    patterns: [
      /\bcafetera(?:s)?\b/,
      /\bcafe\b/,
      /\bespresso\b/,
    ],
    reason: 'Titulo contiene senales de cafetera.',
  },
  {
    category: 'Cerradura',
    patterns: [
      /\bcerradura(?:s)?\b/,
      /\bllave(?:s)?\b/,
      /\brfid\b/,
    ],
    reason: 'Titulo contiene senales de cerradura o acceso.',
  },
  {
    category: 'Calentador',
    patterns: [
      /\bcalentador(?:es)?\b/,
      /\bboiler(?:s)?\b/,
      /\bgas\s+lp\b/,
      /\bgas\s+natural\b/,
    ],
    reason: 'Titulo contiene senales de calentador.',
  },
  {
    category: 'Estufas',
    patterns: [
      /\bestufa(?:s)?\b/,
      /\bparrilla\s+de\s+cocina\b/,
    ],
    reason: 'Titulo contiene senales de estufa.',
  },
  {
    category: 'Freidora',
    patterns: [
      /\bfreidora(?:s)?\b/,
      /\bair\s*fryer\b/,
    ],
    reason: 'Titulo contiene senales de freidora.',
  },
  {
    category: 'Extractor Jugos',
    patterns: [
      /\bextractor(?:es)?\s+de\s+jugo(?:s)?\b/,
      /\bexprimidor(?:es)?\b/,
    ],
    reason: 'Titulo contiene senales de extractor de jugos.',
  },
  {
    category: 'Licuadora',
    patterns: [
      /\blicuadora(?:s)?\b/,
      /\bblender(?:s)?\b/,
    ],
    reason: 'Titulo contiene senales de licuadora.',
  },
  {
    category: 'Ollas',
    patterns: [
      /\bolla(?:s)?\b/,
      /\bbateria\s+apilable\b/,
      /\bbateria\s+de\s+cocina\b/,
      /\bjgo\s+ollas\b/,
    ],
    reason: 'Titulo contiene senales de ollas/bateria de cocina.',
  },
  {
    category: 'Maquina Hielo',
    patterns: [
      /\bmaquina\s+para\s+hacer\s+hielo\b/,
      /\bfabrica(?:dor|dora)?\s+de\s+hielo\b/,
      /\bhielera\b/,
    ],
    reason: 'Titulo contiene senales de maquina de hielo.',
  },
  {
    category: 'Refrigerador',
    patterns: [
      /\brefrigerador(?:es)?\b/,
      /\bcongelador(?:es)?\b/,
      /\benfriador(?:es)?\s+de\s+bebida(?:s)?\b/,
    ],
    reason: 'Titulo contiene senales de refrigerador.',
  },
  {
    category: 'Frigobar',
    patterns: [
      /\bfrigobar(?:es)?\b/,
      /\bmini\s+bar\b/,
      /\bminibar\b/,
    ],
    reason: 'Titulo contiene senales de frigobar.',
  },
  {
    category: 'Limpieza',
    patterns: [
      /\baspiradora(?:s)?\b/,
      /\bvacuum\b/,
    ],
    reason: 'Titulo contiene senales de limpieza/aspiradora.',
  },
];

export function resolveInternalCategory(input: InternalCategoryInput): InternalCategoryResult {
  const productType = normalizeShopifyProductType(input.product_type);
  const shouldPreferTitleRule = productType === 'Electrodomesticos';

  if (productType && !shouldPreferTitleRule) {
    return {
      categoria_interna: productType,
      categoria_confianza: 'medium',
      categoria_source: 'shopify',
      reason: 'Shopify product_type disponible.',
    };
  }

  const normalizedText = normalizeForRules([
    input.title,
    input.sku,
    input.vendor_shopify,
    input.marca_empresa,
  ].filter(Boolean).join(' '));

  for (const rule of titleRules) {
    if (hasPattern(normalizedText, rule.patterns)) {
      return {
        categoria_interna: rule.category,
        categoria_confianza: 'medium',
        categoria_source: 'title_rule',
        reason: rule.reason,
      };
    }
  }

  if (productType) {
    return {
      categoria_interna: productType,
      categoria_confianza: shouldPreferTitleRule ? 'low' : 'medium',
      categoria_source: 'shopify',
      reason: shouldPreferTitleRule
        ? 'Shopify product_type generico; no se encontro una categoria mas especifica por titulo.'
        : 'Shopify product_type disponible.',
    };
  }

  return {
    categoria_confianza: 'pending',
    categoria_source: 'none',
    reason: 'No se encontro categoria interna confiable.',
  };
}
