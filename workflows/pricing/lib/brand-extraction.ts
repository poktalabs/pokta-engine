import type { ConfidenceLevel, IdentitySource } from './product-identity.js';

export type BrandExtractionInput = {
  title: string;
  sku?: string;
  vendor_shopify?: string;
  product_type?: string;
};

export type BrandExtractionResult = {
  marca_empresa?: string;
  marca_empresa_confianza: ConfidenceLevel;
  marca_empresa_source: IdentitySource;
  reason: string;
};

type BrandRule = {
  brand: string;
  patterns: RegExp[];
  reason: string;
};

const brandRules: BrandRule[] = [
  {
    brand: 'Apple',
    patterns: [/\biphone\b/i, /\bipad\b/i, /\bmacbook\b/i],
    reason: 'Titulo contiene familia Apple.',
  },
  {
    brand: 'Samsung',
    patterns: [/\bsamsung\b/i, /\bgalaxy\b/i, /\ba0?6\b/i, /\ba16\b/i],
    reason: 'Titulo contiene Samsung/Galaxy.',
  },
  {
    brand: 'Motorola',
    patterns: [/\bmotorola\b/i, /\bmoto\s+[ge]\d+/i, /\bmoto\s+g\d+/i, /\bg0?4s\b/i, /\bg15\b/i, /\bg35\b/i],
    reason: 'Titulo contiene Motorola o modelo Moto G/E.',
  },
  {
    brand: 'Infinix',
    patterns: [/\binfinix\b/i, /\bhot\s+\d+/i],
    reason: 'Titulo contiene Infinix.',
  },
  {
    brand: 'Tecno',
    patterns: [/\btecno\b/i, /\bcamon\b/i],
    reason: 'Titulo contiene Tecno/Camon.',
  },
  {
    brand: 'Honor',
    patterns: [/\bhonor\b/i],
    reason: 'Titulo contiene Honor.',
  },
  {
    brand: 'Amazon',
    patterns: [/\becho\b/i, /\balexa\b/i],
    reason: 'Titulo contiene Amazon Echo/Alexa.',
  },
  {
    brand: 'Garow',
    patterns: [/\bgarow\b/i],
    reason: 'Titulo contiene Garow.',
  },
  {
    brand: 'Acer',
    patterns: [/\bacer\b/i, /\baspire\b/i],
    reason: 'Titulo contiene Acer/Aspire.',
  },
  {
    brand: 'HP',
    patterns: [/\bhp\b/i, /\bpavilion\b/i],
    reason: 'Titulo contiene HP/Pavilion.',
  },
  {
    brand: 'Lenovo',
    patterns: [/\blenovo\b/i],
    reason: 'Titulo contiene Lenovo.',
  },
  {
    brand: 'Calvin Klein',
    patterns: [/\bcalvin\s+klein\b/i],
    reason: 'Titulo contiene Calvin Klein.',
  },
  {
    brand: 'Coach',
    patterns: [/\bcoach\b/i],
    reason: 'Titulo contiene Coach.',
  },
  {
    brand: 'Armaf',
    patterns: [/\barmaf\b/i],
    reason: 'Titulo contiene Armaf.',
  },
  {
    brand: 'Lattafa',
    patterns: [/\blattafa\b/i],
    reason: 'Titulo contiene Lattafa.',
  },
  {
    brand: 'Hugo Boss',
    patterns: [/\bhugo\s+boss\b/i, /\bboss\s+bottled\b/i],
    reason: 'Titulo contiene Hugo Boss/Boss Bottled.',
  },
  {
    brand: 'Ariana Grande',
    patterns: [/\bariana\s+grande\b/i, /\bari\b.*\bariana\b/i],
    reason: 'Titulo contiene Ariana Grande.',
  },
  {
    brand: 'Cacharel',
    patterns: [/\bcacharel\b/i, /\bamor\s+amor\b/i],
    reason: 'Titulo contiene Cacharel/Amor Amor.',
  },
  {
    brand: 'DKNY',
    patterns: [/\bdkny\b/i, /\bbe\s+delicious\b/i],
    reason: 'Titulo contiene DKNY/Be Delicious.',
  },
  {
    brand: 'LG',
    patterns: [/\blg\b/i],
    reason: 'Titulo contiene LG.',
  },
  {
    brand: 'MABE',
    patterns: [/\bmabe\b/i],
    reason: 'Titulo contiene Mabe.',
  },
  {
    brand: 'CARABELA',
    patterns: [/\bcarabela\b/i],
    reason: 'Titulo contiene Carabela.',
  },
  {
    brand: 'NUUR',
    patterns: [/\bnuur\b/i, /\bnüür\b/i],
    reason: 'Titulo contiene NUUR.',
  },
  {
    brand: 'BOGNER',
    patterns: [/\bbogner\b/i],
    reason: 'Titulo contiene Bogner.',
  },
  {
    brand: 'SENWA',
    patterns: [/\bsenwa\b/i],
    reason: 'Titulo contiene Senwa.',
  },
];

function compactText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractMarcaEmpresaFromTitle(input: BrandExtractionInput): BrandExtractionResult {
  const haystack = compactText([
    input.title,
    input.sku,
    input.product_type,
  ]);

  if (!haystack) {
    return {
      marca_empresa_confianza: 'pending',
      marca_empresa_source: 'none',
      reason: 'Sin texto suficiente para extraer marca.',
    };
  }

  const matchedRule = brandRules.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(haystack))
  );

  if (!matchedRule) {
    return {
      marca_empresa_confianza: 'pending',
      marca_empresa_source: 'none',
      reason: 'No se encontro marca conocida en titulo/SKU/product_type.',
    };
  }

  return {
    marca_empresa: matchedRule.brand,
    marca_empresa_confianza: 'high',
    marca_empresa_source: 'title_rule',
    reason: matchedRule.reason,
  };
}
