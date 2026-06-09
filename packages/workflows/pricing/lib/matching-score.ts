export type MatchConfidence = 'high' | 'medium' | 'low';
export type MatchReasonCode =
  | 'identifier_match'
  | 'brand_and_model_match'
  | 'model_match'
  | 'legacy_high_confidence'
  | 'manual_review_low_overlap'
  | 'brand_mismatch'
  | 'model_mismatch'
  | 'model_missing'
  | 'accepted_without_model'
  | 'required_terms_match'
  | 'forbidden_terms_found'
  | 'price_outlier_low'
  | 'price_outlier_high'
  | 'brand_and_model_missing'
  | 'low_confidence';

export type MatchInput = {
  sku: string;
  title: string;
  search_query: string;
  brand?: string;
  model?: string;
  category?: string;
  barcode?: string;
  gtin?: string;
  ean?: string;
  expected_ml_title?: string;
  required_terms?: string[];
  forbidden_terms?: string[];
  accept_without_model?: boolean;
};

export type MatchSignals = {
  target_tokens: string[];
  matched_tokens: string[];
  shared_tokens: string[];
  token_overlap_ratio: number;
  target_model_tokens: string[];
  matched_model_tokens: string[];
  shared_model_tokens: string[];
  sku_exact_match: boolean;
  expected_brand?: string;
  brand_match: boolean | null;
  expected_model?: string;
  model_exact_match: boolean | null;
  expected_identifiers: string[];
  identifier_exact_match: boolean;
  model_conflict: boolean;
  required_terms: string[];
  matched_required_terms: string[];
  missing_required_terms: string[];
  forbidden_terms: string[];
  matched_forbidden_terms: string[];
  accept_without_model: boolean;
};

export type MatchScore = {
  score: number;
  confidence: MatchConfidence;
  reason_code: MatchReasonCode;
  reason: string;
  signals: MatchSignals;
};

const STOPWORDS = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'para',
  'con',
  'sin',
  'por',
  'una',
  'uno',
  'unos',
  'unas',
  'color',
  'nuevo',
  'nueva',
  'original',
  'electrico',
  'electrica',
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function tokenizeForMatching(value: string): string[] {
  return unique(
    normalizeText(value)
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
  );
}

function modelTokensFrom(tokens: string[]): string[] {
  return tokens.filter((token) =>
    /[a-z]/.test(token) &&
    /\d/.test(token) &&
    token.length >= 4 &&
    !/^\d+(cc|kg|hz|gb|tb|lt|lts|l|w|cm|mm|hp)$/.test(token)
  );
}

function normalizedCompact(value: string | null | undefined): string {
  return normalizeText(value ?? '').replace(/[^a-z0-9]+/g, '');
}

function normalizedIdentifier(value: string | null | undefined): string | null {
  const normalized = (value ?? '').replace(/\D+/g, '');
  return normalized.length >= 8 ? normalized : null;
}

function contextText(target: MatchInput): string {
  return normalizeText([
    target.sku,
    target.title,
    target.search_query,
    target.brand,
    target.model,
    target.category,
  ].filter(Boolean).join(' '));
}

function globalForbiddenTermsFor(target: MatchInput): string[] {
  const text = contextText(target);
  const terms = new Set<string>();
  const add = (values: string[]) => values.forEach((value) => terms.add(normalizedCompact(value)));

  if (/\b\d{2,4}\s*cc\b/.test(text) || text.includes('carabela') || text.includes('moto')) {
    add([
      'funda',
      'cubierta',
      'lona',
      'refaccion',
      'refacción',
      'repuesto',
      'rin',
      'llanta',
      'tablero',
      'cable',
      'relay',
      'indicador',
      'perilla',
      'casco',
      'aceite',
      'balatas',
      'pastillas',
      'faro',
      'espejo',
      'manubrio',
      'motosierra',
      'bicicleta',
    ]);
  }

  if (
    text.includes('celular') ||
    text.includes('iphone') ||
    text.includes('samsung') ||
    text.includes('motorola') ||
    text.includes('infinix') ||
    text.includes('oppo') ||
    text.includes('tecno') ||
    text.includes('5g') ||
    text.includes('4g')
  ) {
    add([
      'funda',
      'mica',
      'micas',
      'pantalla',
      'display',
      'carcasa',
      'hidrogel',
      'protector',
      'kit funda',
      'modulo',
      'touch',
      'flex',
    ]);
  }

  if (
    text.includes('audio') ||
    text.includes('bocina') ||
    text.includes('soundbar') ||
    text.includes('xboom') ||
    text.includes('barra de sonido')
  ) {
    add([
      'cable',
      'alimentacion',
      'control',
      'soporte',
      'base',
      'refaccion',
      'refacción',
      'repuesto',
    ]);
  }

  if (
    text.includes('lavadora') ||
    text.includes('estufa') ||
    text.includes('microondas') ||
    text.includes('refrigerador') ||
    text.includes('campana')
  ) {
    add([
      'refaccion',
      'refacción',
      'repuesto',
      'perilla',
      'plato',
      'tarjeta',
      'filtro',
      'soporte',
      'base',
    ]);
  }

  return [...terms].filter(Boolean);
}

function confidenceFor(score: number): MatchConfidence {
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function reasonForMatch(
  confidence: MatchConfidence,
  signals: MatchSignals
): { reason_code: MatchReasonCode; reason: string } {
  if (signals.identifier_exact_match) {
    return {
      reason_code: 'identifier_match',
      reason: 'Identificador EAN/GTIN/barcode encontrado en el resultado.',
    };
  }

  if (signals.matched_forbidden_terms.length > 0) {
    return {
      reason_code: 'forbidden_terms_found',
      reason: `Contiene palabras prohibidas: ${signals.matched_forbidden_terms.join(', ')}.`,
    };
  }

  if (signals.brand_match === false) {
    return {
      reason_code: 'brand_mismatch',
      reason: `Marca esperada no coincide${signals.expected_brand ? `: ${signals.expected_brand}` : ''}.`,
    };
  }

  if (signals.model_conflict) {
    return {
      reason_code: 'model_mismatch',
      reason: `Modelo esperado no aparece${signals.expected_model ? `: ${signals.expected_model}` : ''}.`,
    };
  }

  if (signals.model_exact_match === false) {
    if (signals.accept_without_model && signals.missing_required_terms.length === 0) {
      return {
        reason_code: 'accepted_without_model',
        reason: 'Modelo no aparece, pero marca y palabras requeridas coinciden.',
      };
    }

    return {
      reason_code: 'model_missing',
      reason: `Modelo esperado no aparece; requiere revision${signals.expected_model ? `: ${signals.expected_model}` : ''}.`,
    };
  }

  if (signals.brand_match === true && signals.model_exact_match === true) {
    return {
      reason_code: 'brand_and_model_match',
      reason: 'Marca y modelo coinciden con el resultado.',
    };
  }

  if (signals.model_exact_match === true || signals.shared_model_tokens.length > 0 || signals.sku_exact_match) {
    if (signals.required_terms.length > 0 && signals.missing_required_terms.length === 0) {
      return {
        reason_code: 'required_terms_match',
        reason: 'Palabras requeridas coinciden con el resultado.',
      };
    }

    return {
      reason_code: 'model_match',
      reason: 'Modelo o SKU aparece en el resultado.',
    };
  }

  if (signals.brand_match === null && signals.model_exact_match === null && confidence === 'high') {
    return {
      reason_code: 'legacy_high_confidence',
      reason: 'Alta coincidencia por tokens, sin campos enriquecidos.',
    };
  }

  if (signals.expected_brand || signals.expected_model) {
    return {
      reason_code: 'brand_and_model_missing',
      reason: 'Faltan coincidencias fuertes de marca o modelo en el resultado.',
    };
  }

  if (confidence === 'medium') {
    return {
      reason_code: 'manual_review_low_overlap',
      reason: 'Coincidencia parcial; requiere revision humana.',
    };
  }

  return {
    reason_code: 'low_confidence',
    reason: 'Coincidencia baja; no usar automaticamente.',
  };
}

export function scoreProductMatch(target: MatchInput, matchedTitle: string | null): MatchScore | null {
  if (!matchedTitle) return null;

  const targetTokens = tokenizeForMatching(`${target.search_query} ${target.title} ${target.sku}`);
  const matchedTokens = tokenizeForMatching(matchedTitle);
  const sharedTokens = targetTokens.filter((token) => matchedTokens.includes(token));
  const tokenOverlapRatio = targetTokens.length === 0 ? 0 : sharedTokens.length / targetTokens.length;

  const targetModelTokens = modelTokensFrom(targetTokens);
  const matchedModelTokens = modelTokensFrom(matchedTokens);
  const sharedModelTokens = targetModelTokens.filter((token) => matchedModelTokens.includes(token));
  const normalizedTitle = normalizeText(matchedTitle).replace(/[^a-z0-9]+/g, '');
  const normalizedSku = normalizeText(target.sku).replace(/[^a-z0-9]+/g, '');
  const skuExactMatch = normalizedSku.length >= 4 && normalizedTitle.includes(normalizedSku);
  const expectedBrand = target.brand ? normalizeText(target.brand).trim() : undefined;
  const expectedBrandToken = expectedBrand ? normalizedCompact(expectedBrand) : '';
  const brandMatch = expectedBrandToken.length >= 2
    ? matchedTokens.includes(expectedBrandToken) || normalizedTitle.includes(expectedBrandToken)
    : null;
  const expectedModel = target.model ? normalizedCompact(target.model) : '';
  const modelExactMatch = expectedModel.length >= 4 ? normalizedTitle.includes(expectedModel) : null;
  const expectedIdentifiers = unique([
    normalizedIdentifier(target.barcode),
    normalizedIdentifier(target.gtin),
    normalizedIdentifier(target.ean),
  ].filter((value): value is string => Boolean(value)));
  const identifierExactMatch = expectedIdentifiers.some((identifier) =>
    normalizedTitle.includes(identifier)
  );
  const modelConflict =
    modelExactMatch === false &&
    matchedModelTokens.length > 0 &&
    sharedModelTokens.length === 0;
  const requiredTerms = unique((target.required_terms ?? []).map(normalizedCompact).filter(Boolean));
  const forbiddenTerms = unique([
    ...(target.forbidden_terms ?? []).map(normalizedCompact),
    ...globalForbiddenTermsFor(target),
  ].filter(Boolean));
  const matchedRequiredTerms = requiredTerms.filter((term) => normalizedTitle.includes(term));
  const missingRequiredTerms = requiredTerms.filter((term) => !normalizedTitle.includes(term));
  const matchedForbiddenTerms = forbiddenTerms.filter((term) => normalizedTitle.includes(term));
  const acceptWithoutModel = target.accept_without_model === true;

  let score = Math.round(tokenOverlapRatio * 70);

  if (target.expected_ml_title) {
    const expectedTokens = tokenizeForMatching(target.expected_ml_title);
    const sharedExpectedTokens = expectedTokens.filter((token) => matchedTokens.includes(token));
    const expectedOverlap = expectedTokens.length === 0
      ? 0
      : sharedExpectedTokens.length / expectedTokens.length;
    score += Math.round(expectedOverlap * 15);
  }

  if (brandMatch === true) {
    score += 10;
  } else if (brandMatch === false) {
    score -= 20;
  }

  if (modelExactMatch === true) {
    score += 30;
    score = Math.max(score, 85);
  } else if (modelConflict) {
    score -= 30;
  } else if (modelExactMatch === false) {
    score -= 15;
  }

  if (identifierExactMatch) {
    score += 40;
    score = Math.max(score, 95);
  }

  if (requiredTerms.length > 0) {
    const requiredRatio = matchedRequiredTerms.length / requiredTerms.length;
    score += Math.round(requiredRatio * 15);
    if (missingRequiredTerms.length > 0) {
      score -= 10;
    }
  }

  if (matchedForbiddenTerms.length > 0) {
    score -= 50;
  }

  if (sharedModelTokens.length > 0) {
    score += 20;
    score = Math.max(score, 75);
  } else if (targetModelTokens.length > 0 && matchedModelTokens.length > 0) {
    score -= 15;
  }

  if (skuExactMatch) {
    score += 10;
    score = Math.max(score, 80);
  }

  if ((brandMatch === false || modelConflict) && !identifierExactMatch) {
    score = Math.min(score, 39);
  }

  if (matchedForbiddenTerms.length > 0 && !identifierExactMatch) {
    score = Math.min(score, 39);
  }

  if (modelExactMatch === false && brandMatch === true && !modelConflict && !identifierExactMatch) {
    score = Math.max(40, Math.min(score, 64));
  }

  if (
    acceptWithoutModel &&
    modelExactMatch === false &&
    brandMatch === true &&
    missingRequiredTerms.length === 0 &&
    matchedForbiddenTerms.length === 0
  ) {
    score = Math.max(score, 65);
  }

  if (
    !acceptWithoutModel &&
    !identifierExactMatch &&
    (expectedBrand || target.category) &&
    modelExactMatch === null &&
    sharedModelTokens.length === 0 &&
    skuExactMatch === false
  ) {
    score = Math.min(score, 64);
  }

  if (matchedForbiddenTerms.length > 0 && !identifierExactMatch) {
    score = Math.min(score, 39);
  }

  score = Math.max(0, Math.min(100, score));

  const signals: MatchSignals = {
    target_tokens: targetTokens,
    matched_tokens: matchedTokens,
    shared_tokens: sharedTokens,
    token_overlap_ratio: Number(tokenOverlapRatio.toFixed(2)),
    target_model_tokens: targetModelTokens,
    matched_model_tokens: matchedModelTokens,
    shared_model_tokens: sharedModelTokens,
    sku_exact_match: skuExactMatch,
    expected_brand: expectedBrand,
    brand_match: brandMatch,
    expected_model: expectedModel || undefined,
    model_exact_match: modelExactMatch,
    expected_identifiers: expectedIdentifiers,
    identifier_exact_match: identifierExactMatch,
    model_conflict: modelConflict,
    required_terms: requiredTerms,
    matched_required_terms: matchedRequiredTerms,
    missing_required_terms: missingRequiredTerms,
    forbidden_terms: forbiddenTerms,
    matched_forbidden_terms: matchedForbiddenTerms,
    accept_without_model: acceptWithoutModel,
  };
  const confidence = confidenceFor(score);
  const reason = reasonForMatch(confidence, signals);

  return {
    score,
    confidence,
    ...reason,
    signals,
  };
}

export type MatchDecision = 'accept' | 'manual_review' | 'reject';

export function decisionForMatchConfidence(confidence: MatchConfidence | null | undefined): MatchDecision {
  if (confidence === 'high') return 'accept';
  if (confidence === 'medium') return 'manual_review';
  return 'reject';
}
