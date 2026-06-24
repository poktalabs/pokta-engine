import { describe, expect, it } from 'vitest';
import {
  decisionForMatchConfidence,
  scoreProductMatch,
  tokenizeForMatching,
} from './matching-score.js';

describe('tokenizeForMatching', () => {
  it('normalizes accents, punctuation, case, and stopwords', () => {
    expect(tokenizeForMatching('Horno Microondas NeoChef LG 1.1 pies³ EasyClean')).toContain('neochef');
    expect(tokenizeForMatching('CAMPANA 50CM PLATA MABE')).toEqual(['campana', '50cm', 'plata', 'mabe']);
  });
});

describe('scoreProductMatch', () => {
  it('scores exact model matches as high confidence', () => {
    const score = scoreProductMatch(
      {
        sku: 'XG8T',
        title: 'Bocina Bluetooth portatil LG XBOOM Go XG8T',
        search_query: 'bocina LG XBOOM Go XG8T',
        brand: 'LG',
        model: 'XG8T',
      },
      'Bocina LG Xboom Xg8t'
    );

    expect(score?.confidence).toBe('high');
    expect(score?.signals.shared_model_tokens).toContain('xg8t');
    expect(score?.signals.sku_exact_match).toBe(true);
    expect(score?.signals.brand_match).toBe(true);
    expect(score?.signals.model_exact_match).toBe(true);
    expect(score?.reason_code).toBe('brand_and_model_match');
  });

  it('penalizes conflicting model-like tokens', () => {
    const score = scoreProductMatch(
      {
        sku: '50UA8050PSA',
        title: 'Pantalla 50 pulgadas LG UHD AI UA80 4K Smart TV 2025',
        search_query: 'LG 50 pulgadas UHD 4K Smart TV',
        brand: 'LG',
        model: '50UA8050PSA',
      },
      'Tv LG 50 Pulgadas Uhd Ai Ua7510 4k Smart Tv 50ua7510'
    );

    expect(score?.signals.shared_model_tokens).toEqual([]);
    expect(score?.signals.model_exact_match).toBe(false);
    expect(score?.signals.model_conflict).toBe(true);
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('model_mismatch');
  });

  it('sends missing model without conflicting model to manual review', () => {
    const score = scoreProductMatch(
      {
        sku: 'MS3032JAS',
        title: 'Microondas LG NeoChef EasyClean',
        search_query: 'LG Microondas LG NeoChef EasyClean MS3032JAS',
        brand: 'LG',
        model: 'MS3032JAS',
      },
      'Horno De Microondas Neochef 1.5 Pies Negro Con Easyclean LG'
    );

    expect(score?.signals.brand_match).toBe(true);
    expect(score?.signals.model_exact_match).toBe(false);
    expect(score?.signals.model_conflict).toBe(false);
    expect(score?.confidence).toBe('medium');
    expect(score?.reason_code).toBe('model_missing');
  });

  it('accepts without exact model when explicitly allowed and required terms match', () => {
    const score = scoreProductMatch(
      {
        sku: 'MS3032JAS',
        title: 'Microondas LG NeoChef EasyClean',
        search_query: 'LG Microondas LG NeoChef EasyClean MS3032JAS',
        brand: 'LG',
        model: 'MS3032JAS',
        required_terms: ['neochef', 'easyclean', 'microondas'],
        forbidden_terms: ['plato', 'refaccion'],
        accept_without_model: true,
      },
      'Horno De Microondas Neochef 1.5 Pies Negro Con Easyclean LG'
    );

    expect(score?.signals.model_exact_match).toBe(false);
    expect(score?.signals.missing_required_terms).toEqual([]);
    expect(score?.confidence).toBe('high');
    expect(score?.reason_code).toBe('accepted_without_model');
  });

  it('does not auto-accept brand/category-only matches without model permission', () => {
    const score = scoreProductMatch(
      {
        sku: 'HARMONYIND',
        title: 'COLCHON INDIVIDUAL HARMONY',
        search_query: 'COLCHONES CANADA COLCHON INDIVIDUAL HARMONY',
        brand: 'COLCHONES CANADA',
        category: 'Descanso/Colchon',
        required_terms: ['colchon'],
      },
      'Colchones Canada - Colchon Mod. Extra Confort Individual Gris'
    );

    expect(score?.signals.brand_match).toBe(true);
    expect(score?.signals.model_exact_match).toBeNull();
    expect(score?.signals.shared_model_tokens).toEqual([]);
    expect(score?.confidence).toBe('medium');
    expect(score?.reason_code).toBe('brand_and_model_missing');
  });

  it('rejects when forbidden terms are found', () => {
    const score = scoreProductMatch(
      {
        sku: 'MS3032JAS',
        title: 'Microondas LG NeoChef EasyClean',
        search_query: 'LG Microondas LG NeoChef EasyClean MS3032JAS',
        brand: 'LG',
        model: 'MS3032JAS',
        required_terms: ['neochef', 'easyclean'],
        forbidden_terms: ['plato', 'refaccion'],
        accept_without_model: true,
      },
      'Plato De Microondas LG Neochef Easyclean'
    );

    expect(score?.signals.matched_forbidden_terms).toContain('plato');
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('forbidden_terms_found');
  });

  it('does not treat a forbidden term as found when it is only a SUBSTRING of a title word', () => {
    // `led` (forbidden, to exclude cheaper LED panels) must NOT match inside the
    // word `OLED` — the correct premium product was being rejected by substring
    // matching of the separator-stripped title.
    const score = scoreProductMatch(
      {
        sku: 'OLED55C5ESA',
        title: 'LG OLED55C5ESA Pantalla 55 pulgadas LG AI OLED evo C5 4K Smart TV',
        search_query: 'LG OLED55C5ESA Pantalla 55 pulgadas OLED evo C5',
        brand: 'LG',
        model: 'OLED55C5ESA',
        required_terms: ['pantalla', 'smart tv', 'oled evo', 'c5'],
        forbidden_terms: ['lcd', 'led', 'qled', 'samsung', 'sony'],
      },
      'LG Pantalla 55 pulgadas OLED evo AI C5 4K SMART TV 2025'
    );

    expect(score?.signals.matched_forbidden_terms).not.toContain('led');
    expect(score?.reason_code).not.toBe('forbidden_terms_found');
    // multi-word required term `smart tv` still resolves via whole tokens
    expect(score?.signals.missing_required_terms).not.toContain('smart tv');
  });

  it('rejects motorcycle accessories even when the model appears', () => {
    const score = scoreProductMatch(
      {
        sku: '2025-DIRT3-250CC-ROJA',
        title: '2025 DIRT3 roja 250cc',
        search_query: 'CARABELA 2025 DIRT3 roja 250cc 2025-DIRT3-250CC-ROJA',
        brand: 'CARABELA',
        model: 'DIRT3',
        category: 'MOTO',
      },
      'Tablero Completo Moto Carabela Dirt3 250'
    );

    expect(score?.signals.matched_forbidden_terms).toContain('tablero');
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('forbidden_terms_found');
  });

  it('rejects cellphone accessories and replacement screens', () => {
    const score = scoreProductMatch(
      {
        sku: 'C65-4G',
        title: 'Oppo C65 4G',
        search_query: 'CELMI Oppo C65 4G C65-4G',
        brand: 'CELMI',
        model: 'C65-4G',
        category: 'Celulares',
      },
      'Pantalla Para Oppo A5 4G/ A5 Pro 4G 5G/ C65 4G Display'
    );

    expect(score?.signals.matched_forbidden_terms).toEqual(
      expect.arrayContaining(['pantalla', 'display'])
    );
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('forbidden_terms_found');
  });

  it('rejects audio cables even when model appears', () => {
    const score = scoreProductMatch(
      {
        sku: 'RNC7',
        title: 'Bocina LG XBOOM RNC7',
        search_query: 'LG Bocina LG XBOOM RNC7',
        brand: 'LG',
        model: 'RNC7',
        category: 'Audio',
      },
      'Cable Alimentación Celesty Bocina Bluetooth LG XBOOM RNC7 1m Negro'
    );

    expect(score?.signals.matched_forbidden_terms).toContain('cable');
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('forbidden_terms_found');
  });

  it('does not treat capacity units as model matches', () => {
    const score = scoreProductMatch(
      {
        sku: 'WT19DPBK',
        title: 'Lavadora LG Carga Superior Inverter 19kg',
        search_query: 'LG Lavadora LG Carga Superior Inverter 19kg WT19DPBK',
        brand: 'LG',
        category: 'Lavadora',
      },
      'Lavadora Carga Superior Whirlpool 19kg Xpert System'
    );

    expect(score?.signals.target_model_tokens).toEqual(['wt19dpbk']);
    expect(score?.signals.shared_model_tokens).toEqual([]);
    expect(score?.signals.brand_match).toBe(false);
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('brand_mismatch');
  });

  it('rejects motorcycle false positives such as chainsaws', () => {
    const score = scoreProductMatch(
      {
        sku: '2025-VOLKANO-90CC-BLANCO-NEGRO',
        title: '2025 VOLKANO 90CC BLANCO Y NEGRO',
        search_query: 'CARABELA 2025 VOLKANO 90CC BLANCO Y NEGRO 2025-VOLKANO-90CC-BLANCO-NEGRO',
        brand: 'CARABELA',
      },
      'Motosierra a gasolina Makita 90cc DCS901030 6.7hp'
    );

    expect(score?.signals.matched_forbidden_terms).toContain('motosierra');
    expect(score?.signals.shared_model_tokens).toEqual([]);
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('forbidden_terms_found');
  });

  it('rejects when enriched brand is missing from the matched title', () => {
    const score = scoreProductMatch(
      {
        sku: 'MS3032JAS',
        title: 'Microondas LG NeoChef EasyClean',
        search_query: 'LG Microondas LG NeoChef EasyClean MS3032JAS',
        brand: 'LG',
        model: 'MS3032JAS',
      },
      'Horno Microondas Samsung EasyClean MS3032JAS'
    );

    expect(score?.signals.brand_match).toBe(false);
    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('brand_mismatch');
  });

  it('raises confidence when a strong identifier is present', () => {
    const score = scoreProductMatch(
      {
        sku: 'XG8T',
        title: 'Bocina LG XBOOM Go XG8T',
        search_query: 'LG Bocina XG8T 8806090000000',
        brand: 'LG',
        model: 'XG8T',
        barcode: '8806090000000',
      },
      'Bocina LG Xboom Xg8t 8806090000000'
    );

    expect(score?.signals.identifier_exact_match).toBe(true);
    expect(score?.confidence).toBe('high');
    expect(score?.score).toBeGreaterThanOrEqual(95);
    expect(score?.reason_code).toBe('identifier_match');
  });

  it('keeps legacy matching usable when enriched fields are absent', () => {
    const score = scoreProductMatch(
      {
        sku: 'XG8T',
        title: 'Bocina Bluetooth portatil LG XBOOM Go XG8T',
        search_query: 'bocina LG XBOOM Go XG8T',
      },
      'Bocina LG Xboom Xg8t'
    );

    expect(score?.confidence).toBe('high');
    expect(score?.signals.brand_match).toBeNull();
    expect(score?.signals.model_exact_match).toBeNull();
    expect(score?.reason_code).toBe('model_match');
  });

  it('returns human reason for weak non-enriched matches', () => {
    const score = scoreProductMatch(
      {
        sku: 'SKU-1',
        title: 'Producto prueba',
        search_query: 'producto prueba',
      },
      'Articulo parecido'
    );

    expect(score?.confidence).toBe('low');
    expect(score?.reason_code).toBe('low_confidence');
  });

  it('returns null when no title was matched', () => {
    expect(scoreProductMatch({ sku: 'ABC', title: 'Test', search_query: 'Test' }, null)).toBeNull();
  });
});


describe('decisionForMatchConfidence', () => {
  it('accepts high confidence matches', () => {
    expect(decisionForMatchConfidence('high')).toBe('accept');
  });

  it('sends medium confidence matches to manual review', () => {
    expect(decisionForMatchConfidence('medium')).toBe('manual_review');
  });

  it('rejects low or missing confidence matches for automatic use', () => {
    expect(decisionForMatchConfidence('low')).toBe('reject');
    expect(decisionForMatchConfidence(null)).toBe('reject');
  });
});
