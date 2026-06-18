import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave 0 (D9) SEED-REWIRE + MIGRATION-INTENT coverage. Two halves:
 *
 *  (A) SEED REWIRE — `seedTenants` no longer writes an engine_tenants.members[]
 *      array; it binds each member DID (static seed UNION `${secretPrefix}_MEMBER_DIDS`)
 *      into engine_tenant_members via addTenantMember, INSERT-ONLY
 *      (`ON CONFLICT (tenant_id, did) DO NOTHING`). We assert the binds are
 *      insert-only (a re-seed adds no duplicate and wipes nothing) and that the
 *      tenant ROW write carries no members column.
 *
 *  (B) MIGRATION INTENT — read packages/db/drizzle/0005_*.sql as TEXT and assert
 *      the hand-ordered data-copy (`INSERT INTO engine_tenant_members ... unnest(...)`)
 *      appears BEFORE the `DROP COLUMN members`, and that the global DID-uniqueness
 *      index (`tenant_members_did_unique`) is present. This guards the structural
 *      promise that no existing/env-seeded prod member is lost on migrate.
 *
 * Hermetic: `@pokta-engine/db` throws without DATABASE_URL on import, so it is
 * MOCKED (canonical engine-api pattern). The drizzle table markers tell the mock
 * which table a write targets; member binds use onConflictDoNothing (insert-only).
 * The workflows package stays REAL so validateSeeds' allow-list cross-check runs
 * against actual manifest ids.
 */

// ── In-memory write capture (engine_tenants row upserts + engine_tenant_members binds) ──
type Row = Record<string, unknown>
const writes: {
  upserts: Row[] // engine_tenants row inserts
  conflicts: Row[] // engine_tenants onConflictDoUpdate SET
  memberBinds: Array<{ tenantId: string; did: string; source: unknown; onConflict: string }>
} = { upserts: [], conflicts: [], memberBinds: [] }

vi.mock('@pokta-engine/db', () => {
  // db.insert(<table>) routes by the schema mock's __table tag. The engine_tenant_members
  // mock records WHICH conflict strategy was used so we can prove inserts are
  // insert-only (onConflictDoNothing) and never an upsert that could overwrite/wipe.
  const insert = (table: { __table?: string } | undefined) => {
    if (table?.__table === 'engine_tenant_members') {
      return {
        values: (v: Row) => ({
          onConflictDoNothing: async () => {
            writes.memberBinds.push({
              tenantId: v.tenantId as string,
              did: v.did as string,
              source: v.source,
              onConflict: 'doNothing',
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

import { TENANT_SEEDS, seedTenants, validateMemberDids, type TenantSeed } from './seed-tenants'

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

const MEMBER_DID_ENV_KEYS = ['MIPASE_MEMBER_DIDS', 'VINO_MEMBER_DIDS', 'ACME_MEMBER_DIDS']
function clearMemberDidEnv(): void {
  for (const k of MEMBER_DID_ENV_KEYS) delete process.env[k]
}
function resetWrites(): void {
  writes.upserts.length = 0
  writes.conflicts.length = 0
  writes.memberBinds.length = 0
}

/** All member DIDs bound for a tenant (engine_tenant_members inserts), in order. */
function boundDids(tenantId: string): string[] {
  return writes.memberBinds.filter((b) => b.tenantId === tenantId).map((b) => b.did)
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) SEED REWIRE — engine_tenant_members binds are INSERT-ONLY (re-seed safe).
// ─────────────────────────────────────────────────────────────────────────────
describe('Wave 0 SEED REWIRE — member DIDs bind into engine_tenant_members (insert-only)', () => {
  beforeEach(() => {
    clearMemberDidEnv()
    resetWrites()
  })
  afterEach(clearMemberDidEnv)

  it('inserts a member row for the static + envMemberDids set (union, static-first, deduped)', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:env1,did:privy:env2,did:privy:seed'
    await seedTenants(undefined, [
      seed({
        tenantId: 'mi-pase',
        secretPrefix: 'MIPASE',
        // a static seed member that overlaps an env DID — must survive, never duplicated.
        members: ['did:privy:seed'],
        allowedWorkflows: [],
      }),
    ])
    // static seed member first, then the NEW env DIDs; the overlapping 'seed' is bound ONCE.
    expect(boundDids('mi-pase')).toEqual(['did:privy:seed', 'did:privy:env1', 'did:privy:env2'])
    // the tenant ROW write no longer carries a members column (membership is its own table).
    expect((writes.upserts[0] as Record<string, unknown>).members).toBeUndefined()
  })

  it('every member bind is INSERT-ONLY (onConflictDoNothing) tagged source=seed', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:one,did:privy:two'
    await seedTenants(undefined, [
      seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: [], allowedWorkflows: [] }),
    ])
    expect(writes.memberBinds).toHaveLength(2)
    for (const bind of writes.memberBinds) {
      expect(bind.onConflict).toBe('doNothing') // insert-only — never an upsert that could overwrite
      expect(bind.source).toBe('seed')
      expect(bind.tenantId).toBe('mi-pase')
    }
  })

  it('RE-SEED is idempotent: a second run binds the SAME DIDs again with no wipe and no duplicate set', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:owner'
    const aSeed = seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: [], allowedWorkflows: [] })

    await seedTenants(undefined, [aSeed])
    const firstRun = boundDids('mi-pase')
    expect(firstRun).toEqual(['did:privy:owner'])

    // Re-run (simulating a re-deploy). The bind is the SAME insert-only statement:
    // ON CONFLICT (tenant_id, did) DO NOTHING dedupes at the DB; the seed emits no
    // DELETE/upsert, so an already-present row is never wiped or overwritten.
    resetWrites()
    await seedTenants(undefined, [aSeed])
    const secondRun = boundDids('mi-pase')
    expect(secondRun).toEqual(['did:privy:owner'])
    // The re-seed issues ONLY insert-only binds — no other engine_tenant_members write shape.
    expect(writes.memberBinds.every((b) => b.onConflict === 'doNothing')).toBe(true)
    // No table-emptying write path exists in the rewired seed (membership is additive-only).
  })

  it('UNSET env → binds exactly the static seed members (no-op union, never a wipe)', async () => {
    expect(process.env.MIPASE_MEMBER_DIDS).toBeUndefined()
    await seedTenants(undefined, [
      seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: ['did:privy:existing'], allowedWorkflows: [] }),
    ])
    expect(boundDids('mi-pase')).toEqual(['did:privy:existing'])
    // still an insert-only bind — never an empty/clear.
    expect(writes.memberBinds[0]?.onConflict).toBe('doNothing')
  })

  it('the tenant-row onConflict SET no longer carries a members column', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:env1'
    await seedTenants(undefined, [
      seed({ tenantId: 'mi-pase', secretPrefix: 'MIPASE', members: [], allowedWorkflows: [] }),
    ])
    const set = writes.conflicts[0] as { members?: unknown }
    expect(set.members).toBeUndefined()
  })

  it('binds DIDs to the OWNING tenant only (no cross-tenant leak) across the shipped set', async () => {
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:mp-only'
    process.env.VINO_MEMBER_DIDS = 'did:privy:vino-only'
    await seedTenants(undefined, TENANT_SEEDS)
    expect(boundDids('mi-pase')).toContain('did:privy:mp-only')
    expect(boundDids('mi-pase')).not.toContain('did:privy:vino-only')
    expect(boundDids('vino')).toContain('did:privy:vino-only')
    expect(boundDids('vino')).not.toContain('did:privy:mp-only')
  })

  // ── Cross-tenant duplicate DID fails FAST, all-or-nothing (no partial seed) ──
  it('a DID shared across two tenants env vars fails the seed FAST with a naming error and writes NO partial membership', async () => {
    // The same operator DID misconfigured under BOTH prefixes. Under the OLD array
    // model both arrays got it (then resolved fail-closed ambiguous); under UNIQUE(did)
    // the per-DID bind would throw MID-LOOP after mi-pase's row was already upserted.
    // The pre-write validateMemberDids gate must abort BEFORE any write instead.
    process.env.MIPASE_MEMBER_DIDS = 'did:privy:shared'
    process.env.VINO_MEMBER_DIDS = 'did:privy:shared'
    await expect(seedTenants(undefined, TENANT_SEEDS)).rejects.toThrow(
      /member DID 'did:privy:shared' is bound to more than one tenant.*'mi-pase'.*'vino'/,
    )
    // All-or-nothing: nothing was bound and no tenant row was partially written.
    expect(writes.memberBinds).toHaveLength(0)
    expect(writes.upserts).toHaveLength(0)
  })

  it('validateMemberDids passes a collision-free set and rejects a static-vs-env cross-tenant collision', () => {
    const env = (prefix: string | null): string[] =>
      prefix === 'BBB' ? ['did:privy:dup'] : []
    // Collision-free (distinct DIDs) → no throw.
    expect(() =>
      validateMemberDids(
        [
          seed({ tenantId: 'a', secretPrefix: 'AAA', members: ['did:privy:a-only'] }),
          seed({ tenantId: 'b', secretPrefix: 'BBB', members: [] }),
        ],
        env,
      ),
    ).not.toThrow()
    // Tenant a carries the DID statically; tenant b pulls the SAME DID from env → reject.
    expect(() =>
      validateMemberDids(
        [
          seed({ tenantId: 'a', secretPrefix: 'AAA', members: ['did:privy:dup'] }),
          seed({ tenantId: 'b', secretPrefix: 'BBB', members: [] }),
        ],
        env,
      ),
    ).toThrow(/member DID 'did:privy:dup' is bound to more than one tenant/)
  })

  it('the SAME DID listed twice for the SAME tenant is NOT a collision (idempotent union)', () => {
    expect(() =>
      validateMemberDids(
        [seed({ tenantId: 'a', secretPrefix: 'AAA', members: ['did:privy:x', 'did:privy:x'] })],
        () => [],
      ),
    ).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (B) MIGRATION INTENT — 0005_*.sql preserves prod members (data-copy BEFORE drop).
// ─────────────────────────────────────────────────────────────────────────────
describe('Wave 0 MIGRATION INTENT — 0005 copies members BEFORE dropping the column', () => {
  // Resolve packages/db/drizzle/0005_*.sql relative to this test file (apps/engine-api/src).
  const here = dirname(fileURLToPath(import.meta.url))
  const drizzleDir = join(here, '..', '..', '..', 'packages', 'db', 'drizzle')

  function read0005(): string {
    const file = readdirSync(drizzleDir).find((f) => /^0005_.*\.sql$/.test(f))
    expect(file, 'a 0005_*.sql migration must exist').toBeDefined()
    return readFileSync(join(drizzleDir, file as string), 'utf8')
  }

  it('contains the INSERT INTO engine_tenant_members ... unnest(...) data-copy', () => {
    const sql = read0005()
    // The data-copy seeds the new table from the legacy array column via unnest().
    const copyRe = /INSERT\s+INTO\s+"?engine_tenant_members"?[\s\S]*?unnest\(\s*"?members"?\s*\)/i
    expect(sql).toMatch(copyRe)
  })

  it('runs the data-copy BEFORE the DROP COLUMN members (else prod members are lost)', () => {
    const sql = read0005()
    const copyIdx = sql.search(/INSERT\s+INTO\s+"?engine_tenant_members"?[\s\S]*?unnest\(/i)
    const dropIdx = sql.search(/DROP\s+COLUMN\s+"?members"?/i)
    expect(copyIdx, 'data-copy INSERT must be present').toBeGreaterThanOrEqual(0)
    expect(dropIdx, 'DROP COLUMN members must be present').toBeGreaterThanOrEqual(0)
    // Strict ordering: the copy must precede the drop, or every existing member
    // (incl. env-seeded prod DIDs) is wiped and every user is locked out.
    expect(copyIdx).toBeLessThan(dropIdx)
  })

  it('creates the GLOBAL DID-uniqueness index tenant_members_did_unique', () => {
    const sql = read0005()
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+"?tenant_members_did_unique"?[\s\S]*?\(\s*"?did"?\s*\)/i,
    )
  })

  it('PREFLIGHT-GUARDS a cross-tenant duplicate DID (RAISE EXCEPTION) BEFORE the data-copy', () => {
    const sql = read0005()
    // A guard that detects a DID present under >1 tenant and ABORTS loudly, so the
    // legacy ambiguous (fail-CLOSED) state can't be silently collapsed into a single
    // arbitrary tenant (fail-OPEN) by ON CONFLICT DO NOTHING against UNIQUE(did).
    const guardRe =
      /HAVING\s+count\(\*\)\s*>\s*1[\s\S]*?RAISE\s+EXCEPTION/i
    expect(sql, 'a cross-tenant duplicate-DID preflight guard must be present').toMatch(guardRe)

    // The guard (RAISE EXCEPTION) must run BEFORE the INSERT ... unnest data-copy,
    // or a duplicate would already have been silently collapsed before the check.
    const guardIdx = sql.search(/RAISE\s+EXCEPTION/i)
    const copyIdx = sql.search(/INSERT\s+INTO\s+"?engine_tenant_members"?[\s\S]*?unnest\(/i)
    expect(guardIdx, 'guard RAISE EXCEPTION must be present').toBeGreaterThanOrEqual(0)
    expect(copyIdx, 'data-copy INSERT must be present').toBeGreaterThanOrEqual(0)
    expect(guardIdx).toBeLessThan(copyIdx)
  })
})
