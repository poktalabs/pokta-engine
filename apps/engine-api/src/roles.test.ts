import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * roles.ts coverage (admin-roles Wave A / §2) — the role/authz READ layer against a
 * TINY in-memory store of the three role-bearing tables (engine_superadmins,
 * engine_tenant_members, engine_tenant_invites):
 *
 *   isSuperadmin(did)        — true iff a row exists in engine_superadmins.
 *   tenantRoleOf(tenantId,d) — the member row's role, or null when not a member.
 *   seatCount(tenantId)      — member rows + PENDING invite rows (claimed/revoked
 *                              invites excluded; members already counted via rows).
 *   withTenantSeatLock       — runs fn (the advisory-lock execute is a no-op here).
 *
 * Hermetic: @pokta-engine/db mocked; drizzle-orm mocked structurally so eq/and yield
 * inspectable markers the mock reads to filter the in-memory stores.
 */

interface SuperRow {
  did: string
}
interface MemberRow {
  tenantId: string
  did: string
  role: 'admin' | 'member'
}
interface InviteRow {
  tenantId: string
  email: string
  status: 'pending' | 'claimed' | 'revoked'
}
const store: { supers: SuperRow[]; members: MemberRow[]; invites: InviteRow[] } = {
  supers: [],
  members: [],
  invites: [],
}

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: strings.join('?'), vals }),
    { raw: (s: unknown) => ({ raw: s }) },
  ),
}))

vi.mock('@pokta-engine/db', () => {
  const eqVal = (m: unknown, col: string): string | undefined => {
    const w = m as { eq?: [unknown, unknown] }
    return w?.eq && w.eq[0] === col ? (w.eq[1] as string) : undefined
  }
  const andPairs = (m: unknown): Record<string, string> => {
    const w = m as { and?: unknown[]; eq?: [string, string] }
    const out: Record<string, string> = {}
    const parts = w?.and ?? (w?.eq ? [w] : [])
    for (const part of parts) {
      const p = part as { eq?: [string, string] }
      if (p?.eq) out[p.eq[0]] = p.eq[1]
    }
    return out
  }

  // seatCount now runs a SINGLE raw query summing members + pending invites against ONE
  // snapshot (claim-straddle hardening). The mock detects it by its SQL text and the two
  // tenantId binds, then computes the sum from the in-memory store.
  const execute = async (q: unknown): Promise<Array<{ seats: number }>> => {
    const sqlText = (q as { __sql?: string })?.__sql ?? ''
    const vals = ((q as { vals?: unknown[] })?.vals ?? []) as string[]
    if (sqlText.includes('engine_tenant_members') && sqlText.includes('engine_tenant_invites')) {
      const tenantId = vals[0]
      const m = store.members.filter((x) => x.tenantId === tenantId).length
      const p = store.invites.filter((x) => x.tenantId === tenantId && x.status === 'pending').length
      return [{ seats: m + p }]
    }
    return []
  }

  // select(cols).from(TABLE).where(pred)[.limit(n)] — dispatch by the from-table tag.
  const db = {
    execute,
    select: (_cols?: Record<string, unknown>) => ({
      from: (t: { __table?: string }) => {
        const table = t?.__table
        return {
        where: (pred: unknown) => {
          const run = async () => {
            const p = andPairs(pred)
            if (table === 'S') {
              return store.supers.filter((s) => s.did === p['S.did']).map((s) => ({ did: s.did }))
            }
            if (table === 'M') {
              return store.members
                .filter(
                  (m) =>
                    (p['M.tenant_id'] === undefined || m.tenantId === p['M.tenant_id']) &&
                    (p['M.did'] === undefined || m.did === p['M.did']),
                )
                .map((m) => ({ did: m.did, role: m.role }))
            }
            // table === 'V' (invites)
            return store.invites
              .filter(
                (i) =>
                  (p['V.tenant_id'] === undefined || i.tenantId === p['V.tenant_id']) &&
                  (p['V.status'] === undefined || i.status === p['V.status']),
              )
              .map((i) => ({ email: i.email }))
          }
          // where() is awaited directly (seatCount) AND .limit()-chained
          // (isSuperadmin/tenantRoleOf). Return a thenable that also has .limit.
          const promise = run()
          return Object.assign(promise, { limit: async (_n: number) => promise })
        },
        }
      },
    }),
  }
  return {
    db,
    schema: {
      engineSuperadmins: { __table: 'S', did: 'S.did' },
      engineTenantMembers: { __table: 'M', tenantId: 'M.tenant_id', did: 'M.did', role: 'M.role' },
      engineTenantInvites: { __table: 'V', tenantId: 'V.tenant_id', email: 'V.email', status: 'V.status' },
    },
  }
})

const { isSuperadmin, tenantRoleOf, seatCount, withTenantSeatLock } = await import('./roles')

beforeEach(() => {
  store.supers = []
  store.members = []
  store.invites = []
})

describe('isSuperadmin', () => {
  it('true iff a row exists in engine_superadmins', async () => {
    store.supers.push({ did: 'did:privy:super' })
    expect(await isSuperadmin('did:privy:super')).toBe(true)
    expect(await isSuperadmin('did:privy:nobody')).toBe(false)
  })
  it('empty did → false (fail closed)', async () => {
    expect(await isSuperadmin('')).toBe(false)
  })
})

describe('tenantRoleOf', () => {
  it("returns the member row's role", async () => {
    store.members.push({ tenantId: 'mi-pase', did: 'did:a', role: 'admin' })
    store.members.push({ tenantId: 'mi-pase', did: 'did:b', role: 'member' })
    expect(await tenantRoleOf('mi-pase', 'did:a')).toBe('admin')
    expect(await tenantRoleOf('mi-pase', 'did:b')).toBe('member')
  })
  it('null when the DID is not a member of the tenant', async () => {
    store.members.push({ tenantId: 'other', did: 'did:a', role: 'admin' })
    expect(await tenantRoleOf('mi-pase', 'did:a')).toBeNull()
    expect(await tenantRoleOf('mi-pase', 'did:none')).toBeNull()
  })
})

describe('seatCount', () => {
  it('counts member rows + PENDING invites only', async () => {
    store.members.push(
      { tenantId: 'mi-pase', did: 'did:a', role: 'admin' },
      { tenantId: 'mi-pase', did: 'did:b', role: 'member' },
    )
    store.invites.push(
      { tenantId: 'mi-pase', email: 'p@x.co', status: 'pending' },
      { tenantId: 'mi-pase', email: 'c@x.co', status: 'claimed' }, // NOT counted
      { tenantId: 'mi-pase', email: 'r@x.co', status: 'revoked' }, // NOT counted
      { tenantId: 'other', email: 'o@x.co', status: 'pending' }, // other tenant
    )
    // 2 members + 1 pending = 3
    expect(await seatCount('mi-pase')).toBe(3)
    expect(await seatCount('other')).toBe(1)
    expect(await seatCount('empty')).toBe(0)
  })
})

describe('withTenantSeatLock', () => {
  it('runs fn (the advisory lock execute is a no-op in the mock tx)', async () => {
    const tx = { execute: async () => [] } as unknown as typeof import('@pokta-engine/db').db
    const out = await withTenantSeatLock('mi-pase', tx, async () => 'ran')
    expect(out).toBe('ran')
  })
})
