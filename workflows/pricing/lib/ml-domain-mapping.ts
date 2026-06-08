import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeShopifyProductType } from './shopify-normalization.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MAPPING_PATH = resolve(__dirname, './config/mapping-shopify-ml-dominios.csv');

export type MLDomainMappingRule = {
  categoria_interna: string;
  ml_domains_allowed: string[];
  ml_domains_blocked: string[];
  requiere_ml_domain: boolean;
};

export type MLDomainValidationDecision =
  | 'allowed'
  | 'blocked'
  | 'missing_domain'
  | 'no_mapping';

export type MLDomainValidation = {
  decision: MLDomainValidationDecision;
  categoria_interna?: string;
  ml_domain_id?: string;
  reason_code: string;
  reason: string;
  allowed_domains: string[];
  blocked_domains: string[];
};

function compact(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value: string | null | undefined): string {
  return compact(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function splitDomains(value: string | undefined): string[] {
  return compact(value)
    .split('|')
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean {
  return normalizeKey(value) === 'true' || normalizeKey(value) === 'si';
}

export function parseMLDomainMappingCsv(csv: string): MLDomainMappingRule[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const [, ...rows] = lines;

  return rows.map((row) => {
    const [
      categoriaInterna,
      allowed,
      blocked,
      requiereDomain,
    ] = row.split(',');

    return {
      categoria_interna: normalizeShopifyProductType(categoriaInterna) || compact(categoriaInterna),
      ml_domains_allowed: splitDomains(allowed),
      ml_domains_blocked: splitDomains(blocked),
      requiere_ml_domain: parseBoolean(requiereDomain),
    };
  });
}

export function loadMLDomainMapping(mappingPath = DEFAULT_MAPPING_PATH): MLDomainMappingRule[] {
  return parseMLDomainMappingCsv(readFileSync(mappingPath, 'utf-8'));
}

export function findMLDomainMappingRule(
  categoriaInterna: string | null | undefined,
  rules: MLDomainMappingRule[] = loadMLDomainMapping()
): MLDomainMappingRule | null {
  const normalizedCategory = normalizeKey(normalizeShopifyProductType(categoriaInterna));
  if (!normalizedCategory) return null;

  return rules.find((rule) => normalizeKey(rule.categoria_interna) === normalizedCategory) ?? null;
}

export function validateMLDomainForCategory(input: {
  categoria_interna?: string | null;
  ml_domain_id?: string | null;
  rules?: MLDomainMappingRule[];
}): MLDomainValidation {
  const rules = input.rules ?? loadMLDomainMapping();
  const rule = findMLDomainMappingRule(input.categoria_interna, rules);
  const domain = compact(input.ml_domain_id);

  if (!rule) {
    return {
      decision: 'no_mapping',
      ...(input.categoria_interna ? { categoria_interna: input.categoria_interna } : {}),
      ...(domain ? { ml_domain_id: domain } : {}),
      reason_code: 'ml_domain_no_mapping',
      reason: 'No existe mapping de dominio ML para esta categoria interna.',
      allowed_domains: [],
      blocked_domains: [],
    };
  }

  if (!domain) {
    return {
      decision: rule.requiere_ml_domain ? 'missing_domain' : 'allowed',
      categoria_interna: rule.categoria_interna,
      reason_code: rule.requiere_ml_domain ? 'ml_domain_missing' : 'ml_domain_not_required',
      reason: rule.requiere_ml_domain
        ? 'Mercado Libre no devolvio dominio; requiere revision conservadora.'
        : 'La categoria interna no requiere dominio ML.',
      allowed_domains: rule.ml_domains_allowed,
      blocked_domains: rule.ml_domains_blocked,
    };
  }

  if (rule.ml_domains_blocked.includes(domain)) {
    return {
      decision: 'blocked',
      categoria_interna: rule.categoria_interna,
      ml_domain_id: domain,
      reason_code: 'ml_domain_blocked',
      reason: `Dominio ML bloqueado para ${rule.categoria_interna}: ${domain}.`,
      allowed_domains: rule.ml_domains_allowed,
      blocked_domains: rule.ml_domains_blocked,
    };
  }

  if (rule.ml_domains_allowed.length > 0 && !rule.ml_domains_allowed.includes(domain)) {
    return {
      decision: 'blocked',
      categoria_interna: rule.categoria_interna,
      ml_domain_id: domain,
      reason_code: 'ml_domain_not_allowed',
      reason: `Dominio ML no permitido para ${rule.categoria_interna}: ${domain}.`,
      allowed_domains: rule.ml_domains_allowed,
      blocked_domains: rule.ml_domains_blocked,
    };
  }

  return {
    decision: 'allowed',
    categoria_interna: rule.categoria_interna,
    ml_domain_id: domain,
    reason_code: 'ml_domain_allowed',
    reason: `Dominio ML permitido para ${rule.categoria_interna}: ${domain}.`,
    allowed_domains: rule.ml_domains_allowed,
    blocked_domains: rule.ml_domains_blocked,
  };
}
