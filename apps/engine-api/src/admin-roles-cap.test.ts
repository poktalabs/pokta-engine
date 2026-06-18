import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SEAT-CAP ★ (admin-roles Wave A / D3) — the 5-seat team cap and its serialization,
 * exercised at the unit level against a TINY in-memory store of the three role tables
 * (engine_superadmins, engine_tenant_members, engine_tenant_invites):
 *
 *   seatCount(tenantId) = (member rows) + (PENDING invite rows)
 *     · a `claimed` invite is NOT double-counted (it already has a member row),
 *     · a `revoked` invite is excluded,
 *     · a PLATFORM-ONLY superadmin (a row in engine_superadmins with NO member row)
 *       adds NO seat — seatCount never reads engine_superadmins (Codex#11).
 *
 *   addInvite(...) — at TEAM_SEAT_CAP (5) → throws TEAM_FULL (the route maps → 409);
 *   under 5 → inserts a pending invite. The cap is checked UNDER the per-tenant
 *   advisory seat lock: the addInvite path calls withTenantSeatLock BEFORE counting +
 *   inserting, so a check-then-insert race cannot exceed the cap.
 *
 * Hermetic: @pokta-engine/db is a tiny mock store; drizzle-orm is mocked structurally
 * so eq/and yield inspectable markers the mock reads. The advisory-lock `execute` is a
 * recorded no-op so we can assert the lock fires before the count/insert SQL.
 */

interface SuperRow {
  did: string
}
interface MemberRow {
  tenantId: string
  did: string
  role: 'admin' | 'member'
  source: string | null
}
interface InviteRow {
  tenantId: string
  email: string
  status: 'pending' | 'claimed' | 'revoked'
  role: 'admin' | 'member'
  invitedByDid: string | null
}

const store: { supers: SuperRow[]; members: MemberRow[]; invites: InviteRow[] } = {
  supers: [],
  members: [],
  invites: [],
}

/**
 * An ORDERED trace of the operations the addInvite tx performs, so we can assert the
 * advisory seat lock is taken BEFORE the seat count + the insert (race-safety).
 */
const trace: string[] = []

class ActiveEmailUnique extends Error {
  code = '23505'
  constructor() {
    super('duplicate key value violates unique constraint "tenant_invites_active_email"')
  }
}

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: strings.join('?'), vals }),
    { raw: (s: unknown) => ({ raw: s }) },
  ),
}))

vi.mock('@pokta-engine/db', () => {
  // Flatten an and([..]) / bare eq marker into { col: val }.
  const pairs = (m: unknown): Record<string, string> => {
    const w = m as { and?: unknown[]; eq?: [string, string] }
    const out: Record<string, string> = {}
    const parts = w?.and ?? (w?.eq ? [w] : [])
    for (const part of parts) {
      const p = part as { eq?: [string, string] }
      if (p?.eq) out[p.eq[0]] = p.eq[1]
    }
    return out
  }
  const wouldConflict = (tenantId: string, email: string): boolean =>
    store.invites.some((i) => i.email === email && i.tenantId !== tenantId && i.status !== 'revoked')

  const handle = () => ({
    select: (_cols?: Record<string, unknown>) => ({
      from: (t: { __table?: string }) => {
        const table = t?.__table
        const where = (pred: unknown) => {
          const run = async () => {
            const p = pairs(pred)
            if (table === 'S') {
              // NOTE: seatCount must NEVER hit this table (Codex#11). If it ever does,
              // the trace records it and the assertion in the test fails.
              trace.push('select:S')
              return store.supers.filter((s) => s.did === p['S.did']).map((s) => ({ did: s.did }))
            }
            if (table === 'M') {
              trace.push('select:M')
              return store.members
                .filter(
                  (m) =>
                    (p['M.tenant_id'] === undefined || m.tenantId === p['M.tenant_id']) &&
                    (p['M.did'] === undefined || m.did === p['M.did']),
                )
                .map((m) => ({ did: m.did, role: m.role }))
            }
            // table === 'V' (invites)
            trace.push('select:V')
            return store.invites
              .filter(
                (i) =>
                  (p['V.tenant_id'] === undefined || i.tenantId === p['V.tenant_id']) &&
                  (p['V.email'] === undefined || i.email === p['V.email']) &&
                  (p['V.status'] === undefined || i.status === p['V.status']),
              )
              .map((i) => ({
                tenantId: i.tenantId,
                email: i.email,
                status: i.status,
                role: i.role,
                invitedByDid: i.invitedByDid,
              }))
          }
          const promise = run()
          return Object.assign(promise, { limit: async (_n: number) => promise })
        }
        return { where }
      },
    }),
    insert: (_t: { __table?: string }) => ({
      values: async (v: Record<string, unknown>) => {
        trace.push('insert:V')
        if (wouldConflict(v.tenantId as string, v.email as string)) throw new ActiveEmailUnique()
        store.invites.push({
          tenantId: v.tenantId as string,
          email: v.email as string,
          status: 'pending',
          role: (v.role as 'admin' | 'member') ?? 'member',
          invitedByDid: (v.invitedByDid as string) ?? null,
        })
      },
    }),
    update: (_t: { __table?: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (pred: unknown) => {
          trace.push('update:V')
          const p = pairs(pred)
          const inv = store.invites.find(
            (i) => i.tenantId === p['V.tenant_id'] && i.email === p['V.email'],
          )
          if (inv) {
            if (vals.status === 'pending' && wouldConflict(inv.tenantId, inv.email)) {
              throw new ActiveEmailUnique()
            }
            if (vals.status) inv.status = vals.status as InviteRow['status']
            if ('role' in vals) inv.role = vals.role as 'admin' | 'member'
            if ('invitedByDid' in vals) inv.invitedByDid = (vals.invitedByDid as string) ?? null
          }
        },
      }),
    }),
    // Two raw queries reach execute():
    //   1. pg_advisory_xact_lock(namespace, hashtext(tenantId)) — recorded no-op.
    //   2. seatCount's SINGLE-snapshot sum of members + pending invites (claim-straddle
    //      hardening) — detected by its SQL text + the leading tenantId bind, computed
    //      from the in-memory store and traced as 'count' (replaces the old select:M /
    //      select:V pair, which is the whole point: one snapshot, not two reads).
    execute: async (q: unknown) => {
      const sqlText = (q as { __sql?: string })?.__sql ?? ''
      const vals = ((q as { vals?: unknown[] })?.vals ?? []) as string[]
      if (sqlText.includes('engine_tenant_members') && sqlText.includes('engine_tenant_invites')) {
        trace.push('count')
        const tenantId = vals[0]
        const m = store.members.filter((x) => x.tenantId === tenantId).length
        const p = store.invites.filter((x) => x.tenantId === tenantId && x.status === 'pending').length
        return [{ seats: m + p }] as unknown as []
      }
      trace.push('lock')
      return []
    },
  })

  const db = {
    ...handle(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snap = {
        invites: store.invites.map((i) => ({ ...i })),
        members: store.members.map((m) => ({ ...m })),
      }
      try {
        return await fn(handle())
      } catch (e) {
        store.invites = snap.invites
        store.members = snap.members
        throw e
      }
    },
  }
  return {
    db,
    schema: {
      engineSuperadmins: { __table: 'S', did: 'S.did' },
      engineTenantMembers: {
        __table: 'M',
        tenantId: 'M.tenant_id',
        did: 'M.did',
        role: 'M.role',
        source: 'M.source',
      },
      engineTenantInvites: {
        __table: 'V',
        tenantId: 'V.tenant_id',
        email: 'V.email',
        status: 'V.status',
        role: 'V.role',
        invitedByDid: 'V.invited_by_did',
      },
    },
  }
})

const { seatCount, withTenantSeatLock } = await import('./roles')
const { addInvite, TEAM_SEAT_CAP } = await import('./invites')

const T = 'mi-pase'
const ADMIN = 'did:privy:admin'

function member(did: string, role: 'admin' | 'member' = 'member'): MemberRow {
  return { tenantId: T, did, role, source: null }
}
function invite(email: string, status: InviteRow['status'] = 'pending'): InviteRow {
  return { tenantId: T, email, status, role: 'member', invitedByDid: ADMIN }
}

beforeEach(() => {
  store.supers = []
  store.members = []
  store.invites = []
  trace.length = 0
})

// ── seatCount semantics ★ ────────────────────────────────────────────────────
describe('★ seatCount = member rows + PENDING invites', () => {
  it('counts members + pending; claimed NOT double-counted; revoked excluded', async () => {
    store.members.push(member('did:a', 'admin'), member('did:b'))
    store.invites.push(
      invite('p1@x.co', 'pending'),
      invite('p2@x.co', 'pending'),
      invite('c@x.co', 'claimed'), // already has a member row → NOT a separate seat
      invite('r@x.co', 'revoked'), // released → excluded
    )
    // 2 members + 2 pending = 4 (claimed + revoked add nothing).
    expect(await seatCount(T)).toBe(4)
  })

  it('a claimed invite + its bound member counts as exactly ONE seat', async () => {
    // Before claim: 1 pending invite, 0 members → 1 seat.
    store.invites.push(invite('joiner@x.co', 'pending'))
    expect(await seatCount(T)).toBe(1)
    // After claim: the invite flips claimed AND a member row appears → still 1 seat.
    store.invites[0]!.status = 'claimed'
    store.members.push(member('did:joiner'))
    expect(await seatCount(T)).toBe(1)
  })

  it('a PLATFORM-ONLY superadmin (no member row) adds NO seat', async () => {
    store.supers.push({ did: 'did:privy:super' }) // superadmin, but NOT a member of T
    expect(await seatCount(T)).toBe(0)
    // And the count never reads engine_superadmins (Codex#11).
    expect(trace).not.toContain('select:S')
  })

  it('an empty tenant → 0', async () => {
    expect(await seatCount('nobody')).toBe(0)
  })
})

// ── TEAM_FULL boundary via addInvite ★ ───────────────────────────────────────
describe('★ addInvite enforces the 5-seat cap (TEAM_FULL boundary)', () => {
  it('the cap constant is 5', () => {
    expect(TEAM_SEAT_CAP).toBe(5)
  })

  it('UNDER the cap (4 seats) → a new pending invite is added', async () => {
    store.members.push(member(ADMIN, 'admin')) // 1
    store.invites.push(invite('p0@x.co'), invite('p1@x.co'), invite('p2@x.co')) // +3 = 4
    expect(await seatCount(T)).toBe(4)

    const outcome = await addInvite(T, 'New@X.co', 'member', ADMIN)
    expect(outcome).toBe('added')
    // 5th seat written, lowercased.
    expect(store.invites.find((i) => i.email === 'new@x.co')).toMatchObject({
      status: 'pending',
      role: 'member',
      invitedByDid: ADMIN,
    })
    expect(await seatCount(T)).toBe(5)
  })

  it('AT the cap (5 seats) → TEAM_FULL, and NO invite is written (tx rolled back)', async () => {
    store.members.push(member(ADMIN, 'admin')) // 1
    store.invites.push(invite('p0@x.co'), invite('p1@x.co'), invite('p2@x.co'), invite('p3@x.co')) // +4 = 5
    expect(await seatCount(T)).toBe(5)

    await expect(addInvite(T, 'sixth@x.co', 'member', ADMIN)).rejects.toMatchObject({
      code: 'TEAM_FULL',
    })
    expect(store.invites.find((i) => i.email === 'sixth@x.co')).toBeUndefined()
    expect(await seatCount(T)).toBe(5) // unchanged
  })

  it('a platform-only superadmin does NOT consume a seat → cap math is member+pending only', async () => {
    // A superadmin with no member row must not push a 5-member tenant over the cap
    // (they were never a seat). 5 real seats → the 6th add is TEAM_FULL regardless.
    store.supers.push({ did: 'did:privy:super' })
    store.members.push(member(ADMIN, 'admin')) // 1
    store.invites.push(invite('p0@x.co'), invite('p1@x.co'), invite('p2@x.co'), invite('p3@x.co')) // = 5
    await expect(addInvite(T, 'sixth@x.co', 'member', ADMIN)).rejects.toMatchObject({
      code: 'TEAM_FULL',
    })
    expect(trace).not.toContain('select:S')
  })

  it('an already-pending email is a no-op and is NOT cap-checked (idempotent re-touch)', async () => {
    // 5 seats (at cap) but re-touching an EXISTING pending invite must still succeed:
    // it consumes no new seat, so the cap never blocks it.
    store.members.push(member(ADMIN, 'admin')) // 1
    store.invites.push(
      invite('p0@x.co'),
      invite('p1@x.co'),
      invite('p2@x.co'),
      invite('p3@x.co'), // = 5, at cap
    )
    const outcome = await addInvite(T, 'p0@x.co', 'member', ADMIN)
    expect(outcome).toBe('already-pending')
    expect(trace).not.toContain('insert:V')
  })

  it('reactivating a revoked invite at cap → TEAM_FULL (it consumes a fresh seat)', async () => {
    store.members.push(member(ADMIN, 'admin')) // 1
    store.invites.push(
      invite('p0@x.co'),
      invite('p1@x.co'),
      invite('p2@x.co'),
      invite('p3@x.co'), // = 5 pending+member, at cap
      invite('back@x.co', 'revoked'), // excluded from the count
    )
    expect(await seatCount(T)).toBe(5)
    await expect(addInvite(T, 'back@x.co', 'member', ADMIN)).rejects.toMatchObject({
      code: 'TEAM_FULL',
    })
    // Still revoked — reactivation was rolled back.
    expect(store.invites.find((i) => i.email === 'back@x.co')!.status).toBe('revoked')
  })
})

// ── the cap is checked UNDER the advisory lock ★ ──────────────────────────────
describe('★ the seat cap is checked under the per-tenant advisory lock', () => {
  it('addInvite takes the seat lock BEFORE counting + inserting', async () => {
    store.members.push(member(ADMIN, 'admin')) // under cap
    await addInvite(T, 'new@x.co', 'member', ADMIN)
    // The advisory lock fires first; the existing-row lookup (select:V), the single-
    // snapshot seat count ('count') and the insert all happen after it — never before.
    const lockAt = trace.indexOf('lock')
    expect(lockAt).toBeGreaterThanOrEqual(0)
    const firstWork = Math.min(
      ...['select:V', 'count', 'insert:V']
        .map((op) => trace.indexOf(op))
        .filter((idx) => idx >= 0),
    )
    expect(lockAt).toBeLessThan(firstWork)
    // Order within the protected region: the seat count precedes the insert (the cap is
    // re-checked before a new seat is written), and it is a SINGLE snapshot ('count'),
    // not two separate member/invite reads (the claim-straddle fix).
    expect(trace.indexOf('count')).toBeLessThan(trace.indexOf('insert:V'))
    expect(trace.filter((t) => t === 'count')).toHaveLength(1)
  })

  it('withTenantSeatLock runs fn and emits the advisory-lock execute first', async () => {
    const local: string[] = []
    const tx = {
      execute: async () => {
        local.push('lock')
        return []
      },
    } as unknown as typeof import('@pokta-engine/db').db
    const out = await withTenantSeatLock(T, tx, async () => {
      local.push('fn')
      return 'ran'
    })
    expect(out).toBe('ran')
    expect(local).toEqual(['lock', 'fn'])
  })
})
