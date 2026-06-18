import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * MEMBERSHIP TABLE coverage (Wave 0 / §3 / D9) — the table-backed membership
 * helpers in `apps/engine-api/src/tenants.ts` after `engine_tenants.members[]` was
 * replaced by the `engine_tenant_members(tenant_id, did, source, created_at)` table:
 *
 *   - findTenantByMember(did) — joins membership → tenant; the (unique) owning
 *     tenant for a bound DID, undefined when none is bound.
 *   - addTenantMember(tenantId, did) — INSERT-ONLY: a fresh (tenant, did) binds;
 *     re-adding the SAME (tenant, did) is an idempotent no-op (PK + onConflictDoNothing);
 *     a DID already bound to ANOTHER tenant raises the UNIQUE(did) violation, which the
 *     helper maps to the typed `MemberDidCollisionError` (the D9 global-uniqueness guard).
 *   - removeTenantMember(tenantId, did) — deletes the membership row; afterwards
 *     findTenantByMember(did) resolves to nothing.
 *
 * Hermetic: @pokta-engine/db throws on import without DATABASE_URL, so we ALWAYS
 * mock it. Here the mock is a TINY in-memory `engine_tenant_members` store that
 * emulates the real constraints — PK(tenant_id, did) for the no-op, and a pg-style
 * `23505` on `tenant_members_did_unique` for the cross-tenant collision — so the
 * helpers' insert/conflict/delete plumbing is exercised end-to-end. drizzle-orm is
 * mocked structurally so `eq`/`and` yield inspectable markers and so
 * `.values().onConflictDoNothing()` / `.delete().where()` are real awaitable calls.
 */

// ── drizzle-orm: structural markers (same encoding as tenants.test.ts) ──────────
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  desc: (x: unknown) => ({ desc: x }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: { strings, vals } }),
    { raw: (s: unknown) => ({ raw: s }) },
  ),
}))

// ── In-memory engine_tenant_members store shared with the db mock ──────────────
interface MemberRow {
  tenantId: string
  did: string
  source: string | null
}
const members: MemberRow[] = []
// Tenant rows the join projects to; keyed by tenantId.
const tenants: Record<string, { tenantId: string; name: string; status: string }> = {
  'mi-pase': { tenantId: 'mi-pase', name: 'Mi Pase', status: 'active' },
  other: { tenantId: 'other', name: 'Other', status: 'active' },
}

/** A pg-style unique-violation matching how the driver surfaces it (code + constraint). */
class FakeUniqueViolation extends Error {
  code = '23505'
  constraint = 'tenant_members_did_unique'
  constructor(did: string) {
    super(`duplicate key value violates unique constraint "tenant_members_did_unique" (${did})`)
  }
}

// ── @pokta-engine/db: schema columns tagged + an in-memory members table ────────
// schema columns are tagged so the eq/and markers reveal which column was queried.
vi.mock('@pokta-engine/db', () => {
  const schema = {
    engineTenants: { tenantId: 'T.tenant_id' },
    engineTenantMembers: { tenantId: 'M.tenant_id', did: 'M.did' },
  }
  // Pull a tagged column's value out of an eq-marker.
  const eqVal = (m: unknown, col: string): string | undefined => {
    const w = m as { eq?: [unknown, unknown] }
    return w?.eq && w.eq[0] === col ? (w.eq[1] as string) : undefined
  }
  // Read both (tenant_id, did) out of an and([eq,eq]) delete-marker.
  const andPair = (m: unknown): { tenantId?: string; did?: string } => {
    const w = m as { and?: unknown[] }
    const out: { tenantId?: string; did?: string } = {}
    for (const part of w?.and ?? []) {
      const t = eqVal(part, 'M.tenant_id')
      if (t != null) out.tenantId = t
      const d = eqVal(part, 'M.did')
      if (d != null) out.did = d
    }
    return out
  }
  const db = {
    // findTenantByMember: select({tenant:T}).from(M).innerJoin(T,..).where(eq(M.did,did)).limit(n)
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (w: unknown) => {
            const did = eqVal(w, 'M.did')
            const matches = members
              .filter((m) => did != null && m.did === did)
              .map((m) => ({ tenant: tenants[m.tenantId] }))
            return { limit: async (n: number) => matches.slice(0, n) }
          },
        }),
      }),
    }),
    // addTenantMember: insert(M).values({tenantId,did,source}).onConflictDoNothing({target:[..]})
    insert: () => ({
      values: (v: MemberRow) => ({
        onConflictDoNothing: async () => {
          // PK(tenant_id, did): re-adding the SAME pair is a silent no-op.
          if (members.some((m) => m.tenantId === v.tenantId && m.did === v.did)) return
          // UNIQUE(did): the DID already belongs to a DIFFERENT tenant → 23505.
          if (members.some((m) => m.did === v.did)) throw new FakeUniqueViolation(v.did)
          members.push({ tenantId: v.tenantId, did: v.did, source: v.source ?? null })
        },
      }),
    }),
    // removeTenantMember: delete(M).where(and(eq(M.tenant_id,t), eq(M.did,d)))
    delete: () => ({
      where: async (w: unknown) => {
        const { tenantId, did } = andPair(w)
        for (let i = members.length - 1; i >= 0; i--) {
          if (members[i]!.tenantId === tenantId && members[i]!.did === did) members.splice(i, 1)
        }
      },
    }),
  }
  return { db, schema }
})

const { findTenantByMember, addTenantMember, removeTenantMember, MemberDidCollisionError } =
  await import('./tenants')

beforeEach(() => {
  members.length = 0
})

// ── findTenantByMember (table-backed) ──────────────────────────────────────────
describe('findTenantByMember — table-backed resolution', () => {
  it('returns the tenant whose engine_tenant_members row carries the DID', async () => {
    members.push({ tenantId: 'mi-pase', did: 'did:privy:abc', source: 'seed' })
    const found = await findTenantByMember('did:privy:abc')
    expect(found && 'tenantId' in found && found.tenantId).toBe('mi-pase')
  })

  it('no membership row for the DID → undefined', async () => {
    members.push({ tenantId: 'mi-pase', did: 'did:privy:abc', source: 'seed' })
    expect(await findTenantByMember('did:privy:nobody')).toBeUndefined()
  })
})

// ── addTenantMember (insert-only, idempotent, UNIQUE(did) guard) ────────────────
describe('addTenantMember — insert, idempotency, collision', () => {
  it('inserts a fresh (tenant, did) → resolvable afterwards', async () => {
    await addTenantMember('mi-pase', 'did:privy:abc', undefined, 'seed')
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ tenantId: 'mi-pase', did: 'did:privy:abc', source: 'seed' })

    const found = await findTenantByMember('did:privy:abc')
    expect(found && 'tenantId' in found && found.tenantId).toBe('mi-pase')
  })

  it('re-adding the SAME (tenant, did) is an idempotent no-op (no duplicate row, no throw)', async () => {
    await addTenantMember('mi-pase', 'did:privy:abc')
    await addTenantMember('mi-pase', 'did:privy:abc')
    expect(members).toHaveLength(1)
  })

  it('a DID already bound to ANOTHER tenant → typed MemberDidCollisionError (UNIQUE(did))', async () => {
    await addTenantMember('mi-pase', 'did:privy:dup')
    await expect(addTenantMember('other', 'did:privy:dup')).rejects.toBeInstanceOf(
      MemberDidCollisionError,
    )
    // fails CLOSED — the cross-tenant bind is never written; the DID stays with mi-pase.
    expect(members).toHaveLength(1)
    const found = await findTenantByMember('did:privy:dup')
    expect(found && 'tenantId' in found && found.tenantId).toBe('mi-pase')
  })

  it('the collision error carries the offending DID', async () => {
    await addTenantMember('mi-pase', 'did:privy:dup')
    await expect(addTenantMember('other', 'did:privy:dup')).rejects.toMatchObject({
      did: 'did:privy:dup',
    })
  })
})

// ── removeTenantMember (delete → no longer resolves) ───────────────────────────
describe('removeTenantMember — delete then unresolvable', () => {
  it('deletes the membership row → findTenantByMember returns undefined', async () => {
    await addTenantMember('mi-pase', 'did:privy:abc')
    expect(await findTenantByMember('did:privy:abc')).toBeTruthy()

    await removeTenantMember('mi-pase', 'did:privy:abc')
    expect(members).toHaveLength(0)
    expect(await findTenantByMember('did:privy:abc')).toBeUndefined()
  })

  it('after removal the DID is FREE to bind to another tenant (no lingering UNIQUE(did) lock)', async () => {
    await addTenantMember('mi-pase', 'did:privy:roam')
    await removeTenantMember('mi-pase', 'did:privy:roam')
    // no collision now — the unique row is gone.
    await addTenantMember('other', 'did:privy:roam')
    const found = await findTenantByMember('did:privy:roam')
    expect(found && 'tenantId' in found && found.tenantId).toBe('other')
  })
})
