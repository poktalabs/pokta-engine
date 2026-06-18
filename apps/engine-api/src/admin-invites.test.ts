import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave 3 — operator-gated admin invite management (POST/GET/DELETE
 * /admin/tenants/:tenantId/invites). Hermetic: @pokta-engine/db + @pokta-engine/queue
 * mocked, no Postgres/pg-boss. The db mock is a TINY in-memory engine_tenant_invites
 * + engine_tenant_members store that emulates the real constraints exercised by the
 * routes (PK (tenant_id, email), the partial unique ACTIVE-email index, the FK on a
 * non-existent tenant, and the deprovision revoke + member-remove tx).
 *
 * Coverage:
 *   ★ OPERATOR GATE — OPERATOR_KEY unset → 404 (never confirm existence); wrong key →
 *     404; correct key → routes work.
 *   POST add → pending row inserted; re-add pending → already-pending (idempotent);
 *     add a revoked email → reactivated→pending; add an email ACTIVE for ANOTHER
 *     tenant → 409 conflict-other-tenant; add a CLAIMED email → already-claimed
 *     (NO un-claim); invalid email → 400; non-existent tenant (FK) → 404.
 *   GET → the tenant's InviteView rows.
 *   DELETE → deprovisionInvite: invite revoked + claimed member removed.
 */

interface InviteRow {
  tenantId: string
  email: string
  status: 'pending' | 'claimed' | 'revoked'
  claimedByDid: string | null
  claimedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
interface MemberRow {
  tenantId: string
  did: string
}

const store: { invites: InviteRow[]; members: MemberRow[] } = { invites: [], members: [] }

// Known tenant ids; an insert for an UNKNOWN tenant trips the FK (23503).
const KNOWN_TENANTS = new Set(['mi-pase', 'other'])

class FkViolation extends Error {
  code = '23503'
  constructor(tenantId: string) {
    super(`insert violates foreign key constraint (tenant '${tenantId}')`)
  }
}
class ActiveEmailUnique extends Error {
  code = '23505'
  constraint = 'tenant_invites_active_email'
  constructor(email: string) {
    super(`duplicate key value violates unique constraint "tenant_invites_active_email" (${email})`)
  }
}

vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

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
  // Pull the (tenantId,email) pair out of an and(eq(V.tenant_id,..),eq(V.email,..)).
  const invitePair = (m: unknown): { tenantId?: string; email?: string } => {
    const w = m as { and?: unknown[] }
    const out: { tenantId?: string; email?: string } = {}
    for (const part of w?.and ?? []) {
      const p = part as { eq?: [string, string] }
      if (p?.eq?.[0] === 'V.tenant_id') out.tenantId = p.eq[1]
      if (p?.eq?.[0] === 'V.email') out.email = p.eq[1]
    }
    return out
  }
  // A plain eq(V.tenant_id, id) → the tenant id (listInvites where).
  const tenantOf = (m: unknown): string | undefined => {
    const p = m as { eq?: [string, string] }
    return p?.eq?.[0] === 'V.tenant_id' ? p.eq[1] : undefined
  }
  const memberPair = (m: unknown): { tenantId?: string; did?: string } => {
    const w = m as { and?: unknown[] }
    const out: { tenantId?: string; did?: string } = {}
    for (const part of w?.and ?? []) {
      const p = part as { eq?: [string, string] }
      if (p?.eq?.[0] === 'M.tenant_id') out.tenantId = p.eq[1]
      if (p?.eq?.[0] === 'M.did') out.did = p.eq[1]
    }
    return out
  }

  // True iff inserting/activating `email` for `tenantId` would create a SECOND active
  // (non-revoked) row for that email across a DIFFERENT tenant → unique violation.
  const wouldConflict = (tenantId: string, email: string): boolean =>
    store.invites.some((i) => i.email === email && i.tenantId !== tenantId && i.status !== 'revoked')

  const handle = () => ({
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          // listInvites: where(eq(V.tenant_id,id)).orderBy(V.email)
          const tid = tenantOf(w)
          if (tid !== undefined) {
            const orderBy = async () =>
              store.invites
                .filter((i) => i.tenantId === tid)
                .sort((a, b) => a.email.localeCompare(b.email))
            // addInvite read: where(and(...)).limit(1)
            return Object.assign(orderBy, {
              orderBy,
              limit: async (_n: number) => {
                const { tenantId, email } = invitePair(w)
                return store.invites.filter((i) => i.tenantId === tenantId && i.email === email)
              },
            })
          }
          const orderBy = async () => []
          return Object.assign(orderBy, {
            orderBy,
            limit: async (_n: number) => {
              const { tenantId, email } = invitePair(w)
              return store.invites.filter((i) => i.tenantId === tenantId && i.email === email)
            },
          })
        },
      }),
    }),
    insert: () => ({
      values: async (v: { tenantId: string; email: string; status: 'pending' }) => {
        if (!KNOWN_TENANTS.has(v.tenantId)) throw new FkViolation(v.tenantId)
        if (wouldConflict(v.tenantId, v.email)) throw new ActiveEmailUnique(v.email)
        const now = new Date('2026-06-12T00:00:00Z')
        store.invites.push({
          tenantId: v.tenantId,
          email: v.email,
          status: 'pending',
          claimedByDid: null,
          claimedAt: null,
          createdAt: now,
          updatedAt: now,
        })
      },
    }),
    update: () => ({
      set: (vals: Partial<InviteRow>) => ({
        where: async (w: unknown) => {
          const { tenantId, email } = invitePair(w)
          const row = store.invites.find((i) => i.tenantId === tenantId && i.email === email)
          if (!row) return
          // Reactivating a revoked row to pending must respect the active-email index.
          if (vals.status === 'pending' && wouldConflict(tenantId!, email!)) {
            throw new ActiveEmailUnique(email!)
          }
          if (vals.status) row.status = vals.status
        },
      }),
    }),
    delete: () => ({
      where: async (w: unknown) => {
        const { tenantId, did } = memberPair(w)
        for (let i = store.members.length - 1; i >= 0; i--) {
          if (store.members[i]!.tenantId === tenantId && store.members[i]!.did === did) {
            store.members.splice(i, 1)
          }
        }
      },
    }),
    // The deprovision `select ... for update` execute carries [tenantId, email].
    execute: async (q: unknown) => {
      const vals = (q as { vals?: unknown[] })?.vals ?? []
      const [tenantId, email] = vals as [string, string]
      const inv = store.invites.find(
        (i) => i.tenantId === tenantId && i.email === email && i.status !== 'revoked',
      )
      return inv ? [{ claimed_by_did: inv.claimedByDid, status: inv.status }] : []
    },
  })

  const db = {
    ...handle(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
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
  }

  return {
    db,
    schema: {
      engineTenantInvites: { tenantId: 'V.tenant_id', email: 'V.email', status: 'V.status' },
      engineTenantMembers: { tenantId: 'M.tenant_id', did: 'M.did' },
    },
  }
})

const { buildApp } = await import('./app')

const OP = { 'X-Operator-Key': 'op-secret', 'Content-Type': 'application/json' }

beforeEach(() => {
  store.invites = []
  store.members = []
  process.env.OPERATOR_KEY = 'op-secret'
})

// ── ★ OPERATOR GATE (fail closed) ───────────────────────────────────────────────
describe('★ operator gate — admin invite routes never serve without the operator key', () => {
  it('404s POST/GET/DELETE when OPERATOR_KEY is unset (never confirm existence)', async () => {
    delete process.env.OPERATOR_KEY
    const app = buildApp()
    const post = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co' }),
    })
    const get = await app.request('/admin/tenants/mi-pase/invites')
    const del = await app.request('/admin/tenants/mi-pase/invites/a@b.co', { method: 'DELETE' })
    expect(post.status).toBe(404)
    expect(get.status).toBe(404)
    expect(del.status).toBe(404)
    // The store was never touched (no existence leak).
    expect(store.invites).toHaveLength(0)
  })

  it('404s with a WRONG X-Operator-Key', async () => {
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: { 'X-Operator-Key': 'nope', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co' }),
    })
    expect(res.status).toBe(404)
    expect(store.invites).toHaveLength(0)
  })

  it('serves with the CORRECT X-Operator-Key', async () => {
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', { headers: OP })
    expect(res.status).toBe(200)
  })
})

// ── POST add ────────────────────────────────────────────────────────────────────
describe('POST /admin/tenants/:tenantId/invites — addInvite outcomes', () => {
  it('adds a NEW email → pending row inserted (added)', async () => {
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'New@B.co' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'new@b.co', outcome: 'added' })
    expect(store.invites).toContainEqual(
      expect.objectContaining({ tenantId: 'mi-pase', email: 'new@b.co', status: 'pending' }),
    )
  })

  it('re-adding a pending email is idempotent (already-pending)', async () => {
    const app = buildApp()
    await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'a@b.co' }),
    })
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'a@b.co' }),
    })
    expect(await res.json()).toEqual({ email: 'a@b.co', outcome: 'already-pending' })
    expect(store.invites.filter((i) => i.email === 'a@b.co')).toHaveLength(1)
  })

  it('re-adding a REVOKED email reactivates it to pending (reactivated)', async () => {
    store.invites.push({
      tenantId: 'mi-pase',
      email: 'rev@b.co',
      status: 'revoked',
      claimedByDid: null,
      claimedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'rev@b.co' }),
    })
    expect(await res.json()).toEqual({ email: 'rev@b.co', outcome: 'reactivated' })
    expect(store.invites.find((i) => i.email === 'rev@b.co')!.status).toBe('pending')
  })

  it('an email ACTIVE for ANOTHER tenant → 409 (conflict-other-tenant)', async () => {
    store.invites.push({
      tenantId: 'other',
      email: 'dup@b.co',
      status: 'pending',
      claimedByDid: null,
      claimedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'dup@b.co' }),
    })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('APPROVAL_DENIED')
    // No mi-pase row was written (the insert rolled back).
    expect(store.invites.filter((i) => i.tenantId === 'mi-pase')).toHaveLength(0)
  })

  it('a CLAIMED email is left claimed (already-claimed, no un-claim)', async () => {
    store.invites.push({
      tenantId: 'mi-pase',
      email: 'claimed@b.co',
      status: 'claimed',
      claimedByDid: 'did:privy:abc',
      claimedAt: new Date('2026-06-01T00:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'claimed@b.co' }),
    })
    expect(await res.json()).toEqual({ email: 'claimed@b.co', outcome: 'already-claimed' })
    const row = store.invites.find((i) => i.email === 'claimed@b.co')!
    expect(row.status).toBe('claimed')
    expect(row.claimedByDid).toBe('did:privy:abc') // NOT orphaned
  })

  it('an invalid email → 400 ARGS_INVALID', async () => {
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ARGS_INVALID')
    expect(store.invites).toHaveLength(0)
  })

  it('a missing email → 400 ARGS_INVALID', async () => {
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('a non-existent tenant (FK) → 404, not a raw 500', async () => {
    const app = buildApp()
    const res = await app.request('/admin/tenants/ghost/invites', {
      method: 'POST',
      headers: OP,
      body: JSON.stringify({ email: 'a@b.co' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
  })
})

// ── GET list ──────────────────────────────────────────────────────────────────
describe('GET /admin/tenants/:tenantId/invites — InviteView roster', () => {
  it('returns the tenant rows as InviteView (claimedAt as ISO string | null)', async () => {
    store.invites.push(
      {
        tenantId: 'mi-pase',
        email: 'b@b.co',
        status: 'pending',
        claimedByDid: null,
        claimedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        tenantId: 'mi-pase',
        email: 'a@b.co',
        status: 'claimed',
        claimedByDid: 'did:privy:abc',
        claimedAt: new Date('2026-06-01T12:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // a row for a DIFFERENT tenant must NOT appear
      {
        tenantId: 'other',
        email: 'z@b.co',
        status: 'pending',
        claimedByDid: null,
        claimedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    )
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites', { headers: OP })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      invites: Array<{ email: string; status: string; claimedByDid: string | null; claimedAt: string | null }>
    }
    expect(body.invites).toEqual([
      { email: 'a@b.co', status: 'claimed', claimedByDid: 'did:privy:abc', claimedAt: '2026-06-01T12:00:00.000Z' },
      { email: 'b@b.co', status: 'pending', claimedByDid: null, claimedAt: null },
    ])
  })
})

// ── DELETE deprovision ──────────────────────────────────────────────────────────
describe('DELETE /admin/tenants/:tenantId/invites/:email — deprovision', () => {
  it('revokes the invite AND removes the claimed member', async () => {
    store.invites.push({
      tenantId: 'mi-pase',
      email: 'gone@b.co',
      status: 'claimed',
      claimedByDid: 'did:privy:zzz',
      claimedAt: new Date('2026-06-01T00:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    store.members.push({ tenantId: 'mi-pase', did: 'did:privy:zzz' })
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites/gone@b.co', {
      method: 'DELETE',
      headers: OP,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: true, removedMember: 'did:privy:zzz' })
    expect(store.invites.find((i) => i.email === 'gone@b.co')!.status).toBe('revoked')
    expect(store.members).toHaveLength(0)
  })

  it('a missing/already-revoked invite is an idempotent no-op', async () => {
    const app = buildApp()
    const res = await app.request('/admin/tenants/mi-pase/invites/nope@b.co', {
      method: 'DELETE',
      headers: OP,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: false, removedMember: null })
  })
})
