import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave 1 invites.ts coverage (D2/D5/D8) — findInviteForEmails + claimInvite against a
 * TINY in-memory engine_tenant_invites + engine_tenant_members + engine_tenants store
 * that emulates the real constraints:
 *
 *   findInviteForEmails — matches an ACTIVE (status != 'revoked') invite by the
 *     lowercased email set; >1 distinct tenant across the matched rows → undefined
 *     (fail closed / ambiguous); no emails → undefined.
 *   claimInvite — ONE tx: inactive-tenant gate BEFORE mutation (→ 'inactive'); a
 *     revoked invite → 'not-found'; same-did re-claim → ok no-op; other-did claim →
 *     'collision'; pending → marks claimed + binds the member; a cross-tenant
 *     UNIQUE(did) member collision rolls the tx back → 'collision' (claim undone).
 *
 * Hermetic: @pokta-engine/db mocked. The transaction mock runs the callback against a
 * tx object whose execute() answers the `... for update` SELECT from the in-memory
 * invites, and whose update()/insert() mutate the same stores — and on a thrown
 * error it ROLLS BACK (restores a snapshot) so the atomicity assertion is real.
 */

interface InviteRow {
  tenantId: string
  email: string
  status: 'pending' | 'claimed' | 'revoked'
  claimedByDid: string | null
  role?: 'admin' | 'member'
}
interface MemberRow {
  tenantId: string
  did: string
  role?: 'admin' | 'member'
}
const store: {
  invites: InviteRow[]
  members: MemberRow[]
  tenants: Record<string, { tenantId: string; status: string }>
} = {
  invites: [],
  members: [],
  tenants: {
    'mi-pase': { tenantId: 'mi-pase', status: 'active' },
    vino: { tenantId: 'vino', status: 'pending' }, // NOT active
    other: { tenantId: 'other', status: 'active' },
  },
}

class FakeUniqueViolation extends Error {
  code = '23505'
  constraint = 'tenant_members_did_unique'
  constructor(did: string) {
    super(`duplicate key value violates unique constraint "tenant_members_did_unique" (${did})`)
  }
}

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
  desc: (x: unknown) => ({ desc: x }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ __sql: strings.join('?'), vals }),
    { raw: (s: unknown) => ({ raw: s }) },
  ),
}))

vi.mock('@pokta-engine/db', () => {
  // Read the value of a tagged column out of an eq/inArray/ne marker tree.
  const lowercaseEmails = (m: unknown): string[] | undefined => {
    const w = m as { and?: unknown[] }
    for (const part of w?.and ?? []) {
      const p = part as { inArray?: [unknown, string[]] }
      if (p?.inArray && p.inArray[0] === 'V.email') return p.inArray[1]
    }
    return undefined
  }
  const andPairInvite = (m: unknown): { tenantId?: string; email?: string } => {
    const w = m as { and?: unknown[] }
    const out: { tenantId?: string; email?: string } = {}
    for (const part of w?.and ?? []) {
      const p = part as { eq?: [string, string] }
      if (p?.eq?.[0] === 'V.tenant_id') out.tenantId = p.eq[1]
      if (p?.eq?.[0] === 'V.email') out.email = p.eq[1]
    }
    return out
  }
  const andPairMember = (m: unknown): { tenantId?: string; did?: string } => {
    const w = m as { and?: unknown[] }
    const out: { tenantId?: string; did?: string } = {}
    for (const part of w?.and ?? []) {
      const p = part as { eq?: [string, string] }
      if (p?.eq?.[0] === 'M.tenant_id') out.tenantId = p.eq[1]
      if (p?.eq?.[0] === 'M.did') out.did = p.eq[1]
    }
    return out
  }

  // The `... for update` SELECT in claimInvite — pull the email out of the sql vals.
  const lockedInviteByEmail = (email: string): InviteRow | undefined =>
    store.invites.find((i) => i.email === email && i.status !== 'revoked')

  // A handle (real db OR tx) over the in-memory stores.
  const handle = () => ({
    select: () => ({
      from: () => ({
        where: (w: unknown) => ({
          limit: async (n: number) => {
            const emails = lowercaseEmails(w) ?? []
            const set = new Set(emails)
            return store.invites
              .filter((i) => set.has(i.email) && i.status !== 'revoked')
              .slice(0, n)
          },
        }),
      }),
    }),
    update: () => ({
      set: (vals: Partial<InviteRow>) => ({
        where: async (w: unknown) => {
          const { tenantId, email } = andPairInvite(w)
          const row = store.invites.find((i) => i.tenantId === tenantId && i.email === email)
          if (row) {
            if (vals.status) row.status = vals.status
            if ('claimedByDid' in vals) row.claimedByDid = vals.claimedByDid ?? null
          }
        },
      }),
    }),
    // addTenantMember(tx): insert(M).values({tenantId,did,source,role}).onConflictDoNothing(...)
    insert: () => ({
      values: (v: MemberRow) => ({
        onConflictDoNothing: async () => {
          if (store.members.some((m) => m.tenantId === v.tenantId && m.did === v.did)) return
          if (store.members.some((m) => m.did === v.did)) throw new FakeUniqueViolation(v.did)
          store.members.push({ tenantId: v.tenantId, did: v.did, role: v.role ?? 'member' })
        },
      }),
    }),
    delete: () => ({
      where: async (w: unknown) => {
        const { tenantId, did } = andPairMember(w)
        for (let i = store.members.length - 1; i >= 0; i--) {
          if (store.members[i]!.tenantId === tenantId && store.members[i]!.did === did) {
            store.members.splice(i, 1)
          }
        }
      },
    }),
    execute: async (q: unknown) => {
      // The only `execute` here is the `select ... for update` in claimInvite — its
      // sql vals carry [email]. Return rows in the snake_case shape the code reads.
      const vals = (q as { vals?: unknown[] })?.vals ?? []
      const email = vals.find((v) => typeof v === 'string') as string | undefined
      if (email === undefined) return []
      const inv = lockedInviteByEmail(email)
      return inv
        ? [{ tenant_id: inv.tenantId, email: inv.email, status: inv.status, claimed_by_did: inv.claimedByDid, role: inv.role ?? 'member' }]
        : []
    },
  })

  const db = {
    ...handle(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Snapshot for rollback on throw (emulates a real tx rollback).
      const snapshot = {
        invites: store.invites.map((i) => ({ ...i })),
        members: store.members.map((m) => ({ ...m })),
      }
      try {
        return await fn(handle())
      } catch (e) {
        store.invites = snapshot.invites
        store.members = snapshot.members
        throw e
      }
    },
    query: {
      engineTenants: {
        findFirst: async ({ where }: { where: { eq?: [string, string] } }) => {
          const id = where?.eq?.[0] === 'T.tenant_id' ? where.eq[1] : undefined
          return id ? store.tenants[id] : undefined
        },
      },
    },
  }

  return {
    db,
    schema: {
      engineTenants: { tenantId: 'T.tenant_id' },
      engineTenantInvites: { tenantId: 'V.tenant_id', email: 'V.email', status: 'V.status' },
      engineTenantMembers: { tenantId: 'M.tenant_id', did: 'M.did' },
    },
  }
})

const { findInviteForEmails, claimInvite } = await import('./invites')
const { __resetTenantCache } = await import('./tenants')

beforeEach(() => {
  store.invites = []
  store.members = []
  __resetTenantCache()
})

// ── findInviteForEmails ────────────────────────────────────────────────────────
describe('findInviteForEmails — global-unique active match, fail closed on ambiguity', () => {
  it('returns the single active invite whose email is in the input set', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', claimedByDid: null })
    const found = await findInviteForEmails(['A@B.co'])
    expect(found?.tenantId).toBe('mi-pase')
  })

  it('no emails → undefined', async () => {
    expect(await findInviteForEmails([])).toBeUndefined()
  })

  it('a REVOKED invite never matches', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'revoked', claimedByDid: 'did:old' })
    expect(await findInviteForEmails(['a@b.co'])).toBeUndefined()
  })

  it('matches spanning TWO tenants → undefined (fail closed / ambiguous)', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', claimedByDid: null })
    store.invites.push({ tenantId: 'other', email: 'c@d.co', status: 'pending', claimedByDid: null })
    expect(await findInviteForEmails(['a@b.co', 'c@d.co'])).toBeUndefined()
  })
})

// ── claimInvite ────────────────────────────────────────────────────────────────
describe('claimInvite — atomic bind, inactive gate, collision', () => {
  it('pending → claimed binds the member (one tx)', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', claimedByDid: null })
    const out = await claimInvite({ email: 'a@b.co', did: 'did:privy:new' })
    expect(out).toEqual({ ok: true, tenantId: 'mi-pase' })
    expect(store.invites[0]).toMatchObject({ status: 'claimed', claimedByDid: 'did:privy:new' })
    expect(store.members).toContainEqual({ tenantId: 'mi-pase', did: 'did:privy:new', role: 'member' })
  })

  it('claim grants the INVITE\'s role to the bound member (D2)', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', claimedByDid: null, role: 'admin' })
    const out = await claimInvite({ email: 'a@b.co', did: 'did:privy:promoted' })
    expect(out).toEqual({ ok: true, tenantId: 'mi-pase' })
    expect(store.members).toContainEqual({ tenantId: 'mi-pase', did: 'did:privy:promoted', role: 'admin' })
  })

  it('same-did re-claim is an idempotent no-op success', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'claimed', claimedByDid: 'did:me' })
    const out = await claimInvite({ email: 'a@b.co', did: 'did:me' })
    expect(out).toEqual({ ok: true, tenantId: 'mi-pase' })
  })

  it('other-did on a claimed invite → collision (no rebind)', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'claimed', claimedByDid: 'did:owner' })
    const out = await claimInvite({ email: 'a@b.co', did: 'did:intruder' })
    expect(out).toBe('collision')
    expect(store.invites[0]?.claimedByDid).toBe('did:owner')
  })

  it('INACTIVE tenant → rejected BEFORE any mutation', async () => {
    // vino is pending (not active).
    store.invites.push({ tenantId: 'vino', email: 'v@b.co', status: 'pending', claimedByDid: null })
    const out = await claimInvite({ email: 'v@b.co', did: 'did:privy:v' })
    expect(out).toBe('inactive')
    // No mutation: invite still pending, no member bound.
    expect(store.invites[0]?.status).toBe('pending')
    expect(store.members).toHaveLength(0)
  })

  it('revoked invite → not-found', async () => {
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'revoked', claimedByDid: null })
    expect(await claimInvite({ email: 'a@b.co', did: 'did:x' })).toBe('not-found')
  })

  it('a cross-tenant UNIQUE(did) member collision ROLLS BACK → collision (claim undone)', async () => {
    // The DID is already a member of `other`; claiming mi-pase's invite must roll back.
    store.members.push({ tenantId: 'other', did: 'did:roam' })
    store.invites.push({ tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', claimedByDid: null })
    const out = await claimInvite({ email: 'a@b.co', did: 'did:roam' })
    expect(out).toBe('collision')
    // Atomicity: the claim was undone — invite back to pending, no new member.
    expect(store.invites[0]?.status).toBe('pending')
    expect(store.members).toEqual([{ tenantId: 'other', did: 'did:roam' }])
  })
})
