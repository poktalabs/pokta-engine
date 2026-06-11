import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
// Wave 0: membership moved from engine_tenants.members[] into engine_tenant_members.
// seedTenants now (a) upserts the tenant ROW (no members column) then (b) binds each
// member DID via addTenantMember → db.insert(engineTenantMembers).values({tenantId,
// did, source}).onConflictDoNothing(). The mock captures BOTH so we can prove
// validation gates the row write AND that env DIDs bind ADDITIVELY (insert-only).
type Row = Record<string, unknown>
const writes: {
  upserts: Row[] // engine_tenants row inserts
  conflicts: Row[] // engine_tenants onConflictDoUpdate SET
  memberBinds: Array<{ tenantId: string; did: string; source: unknown }> // engine_tenant_members inserts
} = { upserts: [], conflicts: [], memberBinds: [] }

vi.mock('@godin-engine/db', () => {
  // The drizzle table marker passed to db.insert(<table>) tells the mock WHICH
  // table is being written (the schema mock tags each).
  const insert = (table: { __table?: string } | undefined) => {
    if (table?.__table === 'engine_tenant_members') {
      return {
        values: (v: Row) => ({
          // addTenantMember uses onConflictDoNothing (insert-only).
          onConflictDoNothing: async () => {
            writes.memberBinds.push({
              tenantId: v.tenantId as string,
              did: v.did as string,
              source: v.source,
            })
            return undefined
          },
        }),
      }
    }
    // engine_tenants row upsert.
    return {
      values: (v: Row) => {
        writes.upserts.push(v)
        return {
          onConflictDoUpdate: async (cfg: { set?: Row }) => {
            writes.conflicts.push(cfg?.set ?? {})
            return undefined
          },
        }
      },
    }
  }
  return {
    db: { insert },
    schema: {
      engineTenants: { __table: 'engine_tenants', tenantId: 'tenant_id' },
      engineTenantMembers: { __table: 'engine_tenant_members', tenantId: 'M.tenant_id', did: 'M.did' },
    },
  }
})

import { listManifests } from '@godin-engine/workflows'
import {
  TENANT_SEEDS,
  validateSeeds,
  seedTenants,
  envMemberDids,
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

// ─────────────────────────────────────────────────────────────────────────────
// SEED-DID (B) — env-seeded member DIDs are ADDITIVE (PR2b B1 / §4 / §6 / Wave 0 D9).
//
// Member DIDs are ops-owned and read from `${secretPrefix}_MEMBER_DIDS` at seed
// time. Membership now lives in engine_tenant_members (NOT a column): each DID —
// the static seed `members` UNION the env DIDs, deduped — is bound via
// addTenantMember insert-only (ON CONFLICT (tenant_id, did) DO NOTHING). An
// unset/blank env binds nothing (NO-OP, never a wipe → never a deploy-time lockout).
// NO DID literal lives in source — these tests inject DIDs through process.env
// exactly as Railway/.env.local would, and clean them up after.
// ─────────────────────────────────────────────────────────────────────────────

/** Restore env keys this suite mutates so cases never leak DIDs into one another. */
const MEMBER_DID_ENV_KEYS = ['MIPASE_MEMBER_DIDS', 'VINO_MEMBER_DIDS', 'ACME_MEMBER_DIDS']
function clearMemberDidEnv(): void {
  for (const k of MEMBER_DID_ENV_KEYS) delete process.env[k]
}

describe('SEED-DID — envMemberDids parses ${secretPrefix}_MEMBER_DIDS', () => {
  beforeEach(clearMemberDidEnv)
  afterEach(clearMemberDidEnv)

  it('splits a comma-separated list, trims whitespace, and drops empties', () => {
    process.env.MIPASE_MEMBER_DIDS = ' did:privy:abc , did:privy:def ,, '
    expect(envMemberDids('MIPASE')).toEqual(['did:privy:abc', 'did:privy:def'])
  })

  it('dedupes repeated DIDs (preserving first-seen order)', () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:abc,did:privy:def,did:privy:abc'
    expect(envMemberDids('MIPASE')).toEqual(['did:privy:abc', 'did:privy:def'])
  })

  it('returns [] for an UNSET env var (no-op union downstream)', () => {
    expect(process.env.MIPASE_MEMBER_DIDS).toBeUndefined()
    expect(envMemberDids('MIPASE')).toEqual([])
  })

  it('returns [] for a BLANK / whitespace-only env var (never a wipe)', () => {
    process.env.MIPASE_MEMBER_DIDS = '   '
    expect(envMemberDids('MIPASE')).toEqual([])
    process.env.MIPASE_MEMBER_DIDS = ''
    expect(envMemberDids('MIPASE')).toEqual([])
  })

  it('returns [] for a null secretPrefix (a tenant with no env prefix)', () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:abc'
    expect(envMemberDids(null)).toEqual([])
  })

  it('reads ONLY the tenant-scoped key (MIPASE_* does not leak into VINO_*)', () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:mp'
    expect(envMemberDids('VINO')).toEqual([])
    expect(envMemberDids('MIPASE')).toEqual(['did:privy:mp'])
  })
})

/** All member DIDs bound for a tenant (engine_tenant_members inserts), in order. */
function boundDids(tenantId: string): string[] {
  return writes.memberBinds.filter((b) => b.tenantId === tenantId).map((b) => b.did)
}

describe('SEED-DID — seedTenants binds env DIDs into engine_tenant_members (additive, union, insert-only)', () => {
  beforeEach(() => {
    clearMemberDidEnv()
    writes.upserts.length = 0
    writes.conflicts.length = 0
    writes.memberBinds.length = 0
  })
  afterEach(clearMemberDidEnv)

  it('binds the static seed members UNION env DIDs, deduped, static-first', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:env1,did:privy:env2,did:privy:seed'
    await seedTenants(undefined, [
      seed({
        tenantId: 'mi-pase',
        secretPrefix: 'MIPASE',
        // a pre-existing static member that must survive the union and not duplicate.
        members: ['did:privy:seed'],
        allowedWorkflows: [],
      }),
    ])
    // static seed member first, then the NEW env DIDs; the overlapping 'seed' is not duplicated.
    expect(boundDids('mi-pase')).toEqual(['did:privy:seed', 'did:privy:env1', 'did:privy:env2'])
    // the tenant ROW insert no longer carries a members column.
    expect((writes.upserts[0] as Record<string, unknown>).members).toBeUndefined()
  })

  it('binds with source=seed via insert-only (ON CONFLICT DO NOTHING) — never wipes', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:one'
    await seedTenants(undefined, [
      seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: [], allowedWorkflows: [] }),
    ])
    expect(writes.memberBinds).toHaveLength(1)
    expect(writes.memberBinds[0]).toEqual({ tenantId: 'mi-pase', did: 'did:privy:one', source: 'seed' })
  })

  it('UNSET env → binds exactly the static seed members (no-op, not a wipe)', async () => {
    expect(process.env.MIPASE_MEMBER_DIDS).toBeUndefined()
    await seedTenants(undefined, [
      seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: ['did:privy:existing'], allowedWorkflows: [] }),
    ])
    expect(boundDids('mi-pase')).toEqual(['did:privy:existing'])
  })

  it('BLANK env → still binds only the static seed members (never emptied)', async () => {
    process.env.MIPASE_MEMBER_DIDS = '   '
    await seedTenants(undefined, [
      seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: ['did:privy:keep'], allowedWorkflows: [] }),
    ])
    expect(boundDids('mi-pase')).toEqual(['did:privy:keep'])
  })

  it('the tenant-row onConflict SET no longer touches a members column (membership is its own table)', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:env1'
    await seedTenants(undefined, [
      seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: [], allowedWorkflows: [] }),
    ])
    const set = writes.conflicts[0] as { members?: unknown }
    // No members column on engine_tenants anymore → the conflict SET must not carry one.
    expect(set.members).toBeUndefined()
  })
})

describe('SEED-DID — a seeded DID flows to membership-based tenant resolution (privy → mi-pase active)', () => {
  beforeEach(() => {
    clearMemberDidEnv()
    writes.upserts.length = 0
    writes.conflicts.length = 0
    writes.memberBinds.length = 0
  })
  afterEach(clearMemberDidEnv)

  it('the env DID is bound to mi-pase membership (what findTenantByMember/resolveTenant query), and mi-pase seeds ACTIVE', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:owner'
    // Seed the REAL shipped set so the active/pending statuses are the production ones.
    await seedTenants(undefined, TENANT_SEEDS)
    const statusById = Object.fromEntries(
      writes.upserts.map((u) => [(u as { tenantId: string }).tenantId, (u as { status: string }).status]),
    )
    // mi-pase is the active tenant; the seeded DID is now bound in its membership
    // table — exactly the rows findTenantByMember(did) joins and resolveTenant
    // (privy mode) status-gates on. A DID bound to mi-pase therefore resolves to the
    // ACTIVE mi-pase tenant (resolveTenant's privy chain is unit-proven in
    // tenants.test.ts against this same membership semantics).
    expect(statusById['mi-pase']).toBe('active')
    expect(boundDids('mi-pase')).toContain('did:privy:owner')
    // A DID seeded under no tenant prefix is bound nowhere → it would resolve to
    // TENANT_UNKNOWN. vino got no DID here, so it has no membership bind.
    expect(boundDids('vino')).not.toContain('did:privy:owner')
    expect(boundDids('vino')).toEqual([])
  })

  it('a DID seeded to a DIFFERENT tenant is bound only to that tenant (no cross-tenant leak)', async () => {
    process.env.VINO_MEMBER_DIDS = 'did:privy:vino-only'
    await seedTenants(undefined, TENANT_SEEDS)
    expect(boundDids('vino')).toContain('did:privy:vino-only')
    expect(boundDids('mi-pase')).not.toContain('did:privy:vino-only')
  })
})
