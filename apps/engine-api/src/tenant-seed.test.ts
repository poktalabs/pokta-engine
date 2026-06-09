import { describe, expect, it, vi } from 'vitest'

/**
 * SEED block (PR2 §6 / T8). Asserts the tenant-registry seed VALIDATION enforces
 * the registry invariants from the plan (§4):
 *   - every `allowedWorkflows` id must exist in the live workflow registry
 *     (`listManifests()`); an unknown id fails the seed loudly,
 *   - `secretPrefix` must match the env-var charset `^[A-Z][A-Z0-9_]*$`,
 *   - `secretPrefix` must be UNIQUE across tenants.
 * Plus: the shipped `TENANT_SEEDS` set itself is valid (mi-pase active, vino
 * pending) and `seedTenants` runs validation BEFORE any write (a bad set never
 * reaches the DB).
 *
 * Hermetic: `@godin-engine/db` throws without DATABASE_URL on import, so it is
 * MOCKED (canonical engine-api pattern). The workflows package is REAL — the
 * allow-list cross-check runs against the actual manifest ids, so a workflow
 * rename would (correctly) break these tests rather than silently passing.
 */

// ── Mock the db client so importing seed-tenants does not require Postgres ────
// Capture every upsert so we can prove validation gates the write path.
type Row = Record<string, unknown>
const writes: { upserts: Row[] } = { upserts: [] }

vi.mock('@godin-engine/db', () => {
  const onConflictDoUpdate = async () => undefined
  const insert = () => ({
    values: (v: Row) => {
      writes.upserts.push(v)
      return { onConflictDoUpdate }
    },
  })
  return {
    db: { insert },
    schema: { engineTenants: { tenantId: 'tenant_id' } },
  }
})

import { listManifests } from '@godin-engine/workflows'
import {
  TENANT_SEEDS,
  validateSeeds,
  seedTenants,
  type TenantSeed,
} from './seed-tenants'

const manifestIds = listManifests().map((m) => m.id)
const firstManifestId: string = manifestIds[0] ?? 'pricing-draft'

/** A minimal valid tenant seed; tests override the field under test. */
function seed(overrides: Partial<TenantSeed> = {}): TenantSeed {
  return {
    tenantId: 'acme',
    name: 'Acme',
    status: 'active',
    currency: 'USD',
    locale: 'en',
    branding: { name: 'Acme' },
    allowedWorkflows: [],
    members: [],
    secretPrefix: 'ACME',
    ...overrides,
  }
}

describe('SEED — allowedWorkflows validated against listManifests()', () => {
  it('accepts allowedWorkflows whose ids all exist in the live registry', () => {
    const valid = firstManifestId
    expect(valid).toBeDefined()
    expect(() => validateSeeds([seed({ allowedWorkflows: [valid] })])).not.toThrow()
  })

  it('rejects an allowedWorkflows id that is NOT a live manifest id', () => {
    const bogus = 'definitely-not-a-real-workflow-id'
    expect(manifestIds).not.toContain(bogus)
    expect(() =>
      validateSeeds([seed({ allowedWorkflows: [bogus] })]),
    ).toThrow(/unknown workflow 'definitely-not-a-real-workflow-id'/)
  })

  it('rejects when only ONE id in a multi-id allow-list is unknown', () => {
    const good = firstManifestId
    expect(() =>
      validateSeeds([seed({ allowedWorkflows: [good, 'ghost-workflow'] })]),
    ).toThrow(/unknown workflow 'ghost-workflow'/)
  })

  it("the shipped mi-pase seed's allowedWorkflows are all real manifest ids", () => {
    const mipase = TENANT_SEEDS.find((t) => t.tenantId === 'mi-pase')
    expect(mipase).toBeDefined()
    for (const id of mipase!.allowedWorkflows) {
      expect(manifestIds).toContain(id)
    }
  })

  it("the shipped vino seed's allowedWorkflows are all real manifest ids", () => {
    const vino = TENANT_SEEDS.find((t) => t.tenantId === 'vino')
    expect(vino).toBeDefined()
    for (const id of vino!.allowedWorkflows) {
      expect(manifestIds).toContain(id)
    }
  })
})

describe('SEED — secretPrefix charset ^[A-Z][A-Z0-9_]*$ enforced', () => {
  it('accepts an all-uppercase prefix (letters, digits, underscores)', () => {
    expect(() => validateSeeds([seed({ secretPrefix: 'MIPASE' })])).not.toThrow()
    expect(() => validateSeeds([seed({ secretPrefix: 'A_B2_C3' })])).not.toThrow()
  })

  it('rejects a lowercase prefix', () => {
    expect(() => validateSeeds([seed({ secretPrefix: 'mipase' })])).toThrow(
      /secretPrefix 'mipase' must match/,
    )
  })

  it('rejects a prefix that starts with a digit', () => {
    expect(() => validateSeeds([seed({ secretPrefix: '1ABC' })])).toThrow(
      /secretPrefix '1ABC' must match/,
    )
  })

  it('rejects a prefix that starts with an underscore', () => {
    expect(() => validateSeeds([seed({ secretPrefix: '_ABC' })])).toThrow(
      /must match/,
    )
  })

  it('rejects a prefix containing a hyphen or other punctuation', () => {
    expect(() => validateSeeds([seed({ secretPrefix: 'MI-PASE' })])).toThrow(
      /must match/,
    )
  })

  it('allows a null secretPrefix (charset only checked when set)', () => {
    expect(() => validateSeeds([seed({ secretPrefix: null })])).not.toThrow()
  })
})

describe('SEED — secretPrefix cross-tenant uniqueness enforced', () => {
  it('rejects two tenants sharing the same secretPrefix', () => {
    expect(() =>
      validateSeeds([
        seed({ tenantId: 'a', secretPrefix: 'DUP' }),
        seed({ tenantId: 'b', secretPrefix: 'DUP' }),
      ]),
    ).toThrow(/secretPrefix 'DUP' is not unique/)
  })

  it('allows distinct prefixes across tenants', () => {
    expect(() =>
      validateSeeds([
        seed({ tenantId: 'a', secretPrefix: 'AAA' }),
        seed({ tenantId: 'b', secretPrefix: 'BBB' }),
      ]),
    ).not.toThrow()
  })

  it('does NOT collide two null prefixes (null is exempt from uniqueness)', () => {
    expect(() =>
      validateSeeds([
        seed({ tenantId: 'a', secretPrefix: null }),
        seed({ tenantId: 'b', secretPrefix: null }),
      ]),
    ).not.toThrow()
  })
})

describe('SEED — shipped TENANT_SEEDS set', () => {
  it('passes validation as a whole (uniqueness + charset + manifests)', () => {
    expect(() => validateSeeds(TENANT_SEEDS)).not.toThrow()
  })

  it('seeds mi-pase ACTIVE and vino PENDING (vino must not resolve/dispatch yet)', () => {
    const byId = Object.fromEntries(TENANT_SEEDS.map((t) => [t.tenantId, t]))
    expect(byId['mi-pase']?.status).toBe('active')
    expect(byId['vino']?.status).toBe('pending')
  })

  it('every shipped tenant has a unique, charset-valid secretPrefix', () => {
    const re = /^[A-Z][A-Z0-9_]*$/
    const prefixes = TENANT_SEEDS.map((t) => t.secretPrefix).filter(
      (p): p is string => p !== null,
    )
    for (const p of prefixes) expect(p).toMatch(re)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })
})

describe('SEED — seedTenants gates the write path with validation', () => {
  it('throws BEFORE any DB write when the seed set is invalid', async () => {
    writes.upserts.length = 0
    await expect(
      seedTenants(undefined, [seed({ allowedWorkflows: ['nope-not-real'] })]),
    ).rejects.toThrow(/unknown workflow/)
    // Validation runs first → nothing was written.
    expect(writes.upserts).toHaveLength(0)
  })

  it('upserts every tenant when the seed set is valid', async () => {
    writes.upserts.length = 0
    const good = firstManifestId
    await seedTenants(undefined, [
      seed({ tenantId: 'a', secretPrefix: 'AAA', allowedWorkflows: [good] }),
      seed({ tenantId: 'b', secretPrefix: 'BBB', allowedWorkflows: [] }),
    ])
    expect(writes.upserts.map((u) => u.tenantId)).toEqual(['a', 'b'])
  })
})
