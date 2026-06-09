import { describe, expect, it } from 'vitest';
import {
  parseMLDomainMappingCsv,
  validateMLDomainForCategory,
  type MLDomainMappingRule,
} from './ml-domain-mapping.js';

const rules: MLDomainMappingRule[] = [
  {
    categoria_interna: 'Celulares',
    ml_domains_allowed: ['MLM-CELLPHONES'],
    ml_domains_blocked: ['MLM-CELLPHONE_COVERS', 'MLM-CELLPHONE_PARTS'],
    requiere_ml_domain: true,
  },
  {
    categoria_interna: 'Audio',
    ml_domains_allowed: ['MLM-SPEAKERS', 'MLM-HEADPHONES'],
    ml_domains_blocked: ['MLM-AUDIO_CABLES'],
    requiere_ml_domain: true,
  },
];

describe('parseMLDomainMappingCsv', () => {
  it('parses allowed and blocked domain lists', () => {
    const parsed = parseMLDomainMappingCsv([
      'categoria_interna,ml_domains_allowed,ml_domains_blocked,requiere_ml_domain',
      'Audio,MLM-SPEAKERS|MLM-HEADPHONES,MLM-AUDIO_CABLES,true',
    ].join('\n'));

    expect(parsed).toEqual([
      {
        categoria_interna: 'Audio',
        ml_domains_allowed: ['MLM-SPEAKERS', 'MLM-HEADPHONES'],
        ml_domains_blocked: ['MLM-AUDIO_CABLES'],
        requiere_ml_domain: true,
      },
    ]);
  });
});

describe('validateMLDomainForCategory', () => {
  it('allows configured domains', () => {
    expect(validateMLDomainForCategory({
      categoria_interna: 'Audio',
      ml_domain_id: 'MLM-SPEAKERS',
      rules,
    })).toMatchObject({
      decision: 'allowed',
      reason_code: 'ml_domain_allowed',
    });
  });

  it('blocks explicitly blocked domains', () => {
    expect(validateMLDomainForCategory({
      categoria_interna: 'Audio',
      ml_domain_id: 'MLM-AUDIO_CABLES',
      rules,
    })).toMatchObject({
      decision: 'blocked',
      reason_code: 'ml_domain_blocked',
    });
  });

  it('blocks domains outside the allowed list', () => {
    expect(validateMLDomainForCategory({
      categoria_interna: 'Celulares',
      ml_domain_id: 'MLM-CELLPHONE_COVERS',
      rules,
    })).toMatchObject({
      decision: 'blocked',
      reason_code: 'ml_domain_blocked',
    });

    expect(validateMLDomainForCategory({
      categoria_interna: 'Celulares',
      ml_domain_id: 'MLM-TELEVISIONS',
      rules,
    })).toMatchObject({
      decision: 'blocked',
      reason_code: 'ml_domain_not_allowed',
    });
  });

  it('requires manual review when domain is missing for mapped categories', () => {
    expect(validateMLDomainForCategory({
      categoria_interna: 'Celulares',
      ml_domain_id: null,
      rules,
    })).toMatchObject({
      decision: 'missing_domain',
      reason_code: 'ml_domain_missing',
    });
  });

  it('does not block when no mapping exists yet', () => {
    expect(validateMLDomainForCategory({
      categoria_interna: 'Categoria Nueva',
      ml_domain_id: 'MLM-UNKNOWN',
      rules,
    })).toMatchObject({
      decision: 'no_mapping',
      reason_code: 'ml_domain_no_mapping',
    });
  });
});
