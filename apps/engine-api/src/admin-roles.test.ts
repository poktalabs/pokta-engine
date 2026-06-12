import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * admin-roles Wave A — the JWT/role-gated team endpoints on buildApp() (§3-§5, §8):
 *
 *   GET    /v1/tenants/:id/invites       — requireTenantAdmin
 *   POST   /v1/tenants/:id/invites       — requireTenantAdmin; reject-not-coerce
 *                                          (non-superadmin role:'admin' → 403); 5-cap
 *                                          → TEAM_FULL (409); other-tenant → generic 409
 *   DELETE /v1/tenants/:id/invites/:email — requireTenantAdmin → deprovision
 *   PATCH  /v1/tenants/:id/members/:did   — requireSuperadmin; last-admin guard → 409
 *   GET    /v1/superadmin/tenants         — requireSuperadmin
 *   GET    /v1/tenants/me                 — additive role + isSuperadmin
 *
 * ANTI-ENUM ★: every authz failure (member, cross-tenant admin, non-superadmin) is the
 * SAME APPROVAL_DENIED 403 — no tenant-existence/role leak.
 *
 * Hermetic: @godin-engine/db is a TINY in-memory store of engine_tenants /
 * engine_tenant_members (role) / engine_tenant_invites (role) / engine_superadmins.
 * drizzle-orm is mocked structurally. Privy auth uses an injected offline verifier.
 */

interface TenantRow {
  tenantId: string
  name: string
  status: 'active' | 'pending' | 'disabled'
  currency: string
  locale: string
  branding: { name?: string; badge?: string }
  allowedWorkflows: string[]
  secretPrefix: string | null
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
  claimedByDid: string | null
  claimedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const store: {
  tenants: TenantRow[]
  members: MemberRow[]
  invites: InviteRow[]
  supers: string[]
} = { tenants: [], members: [], invites: [], supers: [] }

const MIPASE: TenantRow = {
  tenantId: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase' },
  allowedWorkflows: ['pricing-draft'],
  secretPrefix: 'MIPASE',
}
const OTHER: TenantRow = {
  tenantId: 'other',
  name: 'Other Co',
  status: 'active',
  currency: 'USD',
  locale: 'en',
  branding: { name: 'Other Co' },
  allowedWorkflows: [],
  secretPrefix: 'OTHER',
}

class ActiveEmailUnique extends Error {
  code = '23505'
  constraint = 'tenant_invites_active_email'
  constructor() {
    super('duplicate key value violates unique constraint "tenant_invites_active_email"')
  }
}

vi.mock('@godin-engine/queue', () => ({
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

vi.mock('@godin-engine/db', () => {
  const eqVal = (m: unknown, col: string): string | undefined => {
    const w = m as { eq?: [unknown, unknown] }
    return w?.eq && w.eq[0] === col ? (w.eq[1] as string) : undefined
  }
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
    // select(cols).from(TABLE).where(pred)[.orderBy()|.limit()]
    select: (_cols?: Record<string, unknown>) => ({
      from: (t: { __table?: string }) => {
        const table = t?.__table
        const where = (pred: unknown) => {
          const run = async () => {
            const p = pairs(pred)
            if (table === 'S') {
              return store.supers.filter((d) => d === p['S.did']).map((did) => ({ did }))
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
            if (table === 'V') {
              return store.invites
                .filter(
                  (i) =>
                    (p['V.tenant_id'] === undefined || i.tenantId === p['V.tenant_id']) &&
                    (p['V.status'] === undefined || i.status === p['V.status']),
                )
                .map((i) => ({ email: i.email }))
            }
            // table === 'T' (engine_tenants list)
            return store.tenants.map((x) => ({ tenantId: x.tenantId, name: x.name, status: x.status }))
          }
          const promise = run()
          return Object.assign(promise, {
            limit: async (_n: number) => promise,
            orderBy: async () => {
              if (table === 'T') {
                return [...store.tenants]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((x) => ({ tenantId: x.tenantId, name: x.name, status: x.status }))
              }
              if (table === 'V') {
                const p = pairs(pred)
                return store.invites
                  .filter((i) => i.tenantId === p['V.tenant_id'])
                  .sort((a, b) => a.email.localeCompare(b.email))
              }
              return promise
            },
          })
        }
        // listTenants: select().from(T).orderBy(T.name) — NO where.
        const orderBy = async () => {
          if (table === 'T') {
            return [...store.tenants]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((x) => ({ tenantId: x.tenantId, name: x.name, status: x.status }))
          }
          return []
        }
        // listInvites: select().from(V).where(eq).orderBy(V.email) — also the
        // findTenantByMember innerJoin path is unused here (we go via service/privy).
        return { where, orderBy, innerJoin: () => ({ where: (pred: unknown) => ({ limit: async () => {
          // findTenantByMember (privy resolveTenant): M innerJoin T on M.did
          const p = pairs(pred)
          const did = p['M.did']
          return store.members
            .filter((m) => m.did === did)
            .map((m) => ({ tenant: store.tenants.find((tt) => tt.tenantId === m.tenantId) }))
            .filter((r) => r.tenant)
        } }) }) }
      },
    }),
    insert: (_t: { __table?: string }) => ({
      values: (v: Record<string, unknown>) => {
        // engine_tenant_invites insert (addInvite)
        const ret = {
          onConflictDoNothing: async () => {
            // membership insert (addTenantMember during claim — not used in these tests)
            store.members.push({
              tenantId: v.tenantId as string,
              did: v.did as string,
              role: (v.role as 'admin' | 'member') ?? 'member',
              source: (v.source as string) ?? null,
            })
          },
        }
        // addInvite uses tx.insert(V).values({...}) with NO onConflict — it's awaited.
        const insertInvite = async () => {
          if (wouldConflict(v.tenantId as string, v.email as string)) throw new ActiveEmailUnique()
          const now = new Date('2026-06-12T00:00:00Z')
          store.invites.push({
            tenantId: v.tenantId as string,
            email: v.email as string,
            status: 'pending',
            role: (v.role as 'admin' | 'member') ?? 'member',
            invitedByDid: (v.invitedByDid as string) ?? null,
            claimedByDid: null,
            claimedAt: null,
            createdAt: now,
            updatedAt: now,
          })
        }
        // Return a thenable so `await insert().values()` works AND
        // `.onConflictDoNothing()` is reachable.
        return Object.assign(insertInvite(), ret)
      },
    }),
    update: (_t: { __table?: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (pred: unknown) => {
          const p = pairs(pred)
          // invite update (reactivate)
          const inv = store.invites.find(
            (i) => i.tenantId === p['V.tenant_id'] && i.email === p['V.email'],
          )
          if (inv) {
            if (vals.status === 'pending' && wouldConflict(inv.tenantId, inv.email)) {
              throw new ActiveEmailUnique()
            }
            if (vals.status) inv.status = vals.status as InviteRow['status']
            if ('role' in vals) inv.role = vals.role as 'admin' | 'member'
            return
          }
          // member update (setMemberRole)
          const mem = store.members.find(
            (m) => m.tenantId === p['M.tenant_id'] && m.did === p['M.did'],
          )
          if (mem && 'role' in vals) mem.role = vals.role as 'admin' | 'member'
        },
      }),
    }),
    delete: (_t: { __table?: string }) => ({
      where: async (pred: unknown) => {
        const p = pairs(pred)
        for (let i = store.members.length - 1; i >= 0; i--) {
          if (store.members[i]!.tenantId === p['M.tenant_id'] && store.members[i]!.did === p['M.did']) {
            store.members.splice(i, 1)
          }
        }
      },
    }),
    // deprovision `select ... for update` (vals [tenantId, email]); advisory lock
    // (vals [namespace, tenantId]) → return [] harmlessly.
    execute: async (q: unknown) => {
      const vals = (q as { vals?: unknown[] })?.vals ?? []
      if (vals.length === 2 && typeof vals[0] === 'string' && typeof vals[1] === 'string') {
        const [tenantId, email] = vals as [string, string]
        const inv = store.invites.find(
          (i) => i.tenantId === tenantId && i.email === email && i.status !== 'revoked',
        )
        return inv ? [{ claimed_by_did: inv.claimedByDid, status: inv.status }] : []
      }
      return []
    },
  })

  const db = {
    ...handle(),
    query: {
      engineTenants: {
        findFirst: async ({ where }: { where: { eq?: [string, string] } }) => {
          const id = where?.eq?.[0] === 'tenant_id' ? where.eq[1] : undefined
          return id ? store.tenants.find((t) => t.tenantId === id) : undefined
        },
      },
    },
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
      engineTenants: { __table: 'T', tenantId: 'tenant_id', name: 'T.name', status: 'T.status' },
      engineTenantMembers: { __table: 'M', tenantId: 'M.tenant_id', did: 'M.did', role: 'M.role' },
      engineTenantInvites: {
        __table: 'V',
        tenantId: 'V.tenant_id',
        email: 'V.email',
        status: 'V.status',
        role: 'V.role',
      },
      engineSuperadmins: { __table: 'S', did: 'S.did' },
    },
  }
})

const { buildApp } = await import('./app')
const { __resetTenantCache } = await import('./tenants')

const SUPER_DID = 'did:privy:super'
const ADMIN_DID = 'did:privy:admin'
const MEMBER_DID = 'did:privy:member'

function appAs(did: string) {
  return buildApp({ auth: { verifyPrivyToken: async () => ({ userId: did, appId: 'app1' }) } })
}
const BEARER = { Authorization: 'Bearer offline', 'Content-Type': 'application/json' }

beforeEach(() => {
  store.tenants = [{ ...MIPASE }, { ...OTHER }]
  store.members = []
  store.invites = []
  store.supers = []
  __resetTenantCache()
  process.env.SERVICE_KEYS = 'mi-pase:k'
  process.env.OPERATOR_KEY = 'op'
  delete process.env.PRIVY_TENANT_MAP
})

// ── requireTenantAdmin gate ──────────────────────────────────────────────────
describe('★ GET /v1/tenants/:id/invites — requireTenantAdmin', () => {
  it('a tenant ADMIN sees its team', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    store.invites.push({
      tenantId: 'mi-pase', email: 'p@x.co', status: 'pending', role: 'member',
      invitedByDid: ADMIN_DID, claimedByDid: null, claimedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', { headers: BEARER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { invites: Array<{ email: string; role: string }> }
    expect(body.invites).toEqual([{ email: 'p@x.co', status: 'pending', role: 'member', claimedByDid: null, claimedAt: null }])
  })

  it('a plain MEMBER → 403 APPROVAL_DENIED ★', async () => {
    store.members.push({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'member', source: null })
    const res = await appAs(MEMBER_DID).request('/v1/tenants/mi-pase/invites', { headers: BEARER })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('APPROVAL_DENIED')
  })

  it('an admin of ANOTHER tenant probing this one → 403 (anti-enum) ★', async () => {
    store.members.push({ tenantId: 'other', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', { headers: BEARER })
    expect(res.status).toBe(403)
  })

  it('a SUPERADMIN passes for any tenant', async () => {
    store.supers.push(SUPER_DID)
    const res = await appAs(SUPER_DID).request('/v1/tenants/mi-pase/invites', { headers: BEARER })
    expect(res.status).toBe(200)
  })
})

// ── POST reject-not-coerce + cap ─────────────────────────────────────────────
describe('★ POST /v1/tenants/:id/invites — role escalation rejected, cap enforced', () => {
  it('a tenant-admin asking for role:admin → 403 (reject, NOT coerce) ★', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'new@x.co', role: 'admin' }),
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('APPROVAL_DENIED')
    // No invite was written (rejected, never silently coerced to member).
    expect(store.invites).toHaveLength(0)
  })

  it('a tenant-admin adds a member invite → added (role member)', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'New@X.co' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'new@x.co', role: 'member', outcome: 'added' })
    expect(store.invites[0]).toMatchObject({ role: 'member', invitedByDid: ADMIN_DID })
  })

  it('a SUPERADMIN may grant role:admin', async () => {
    store.supers.push(SUPER_DID)
    const res = await appAs(SUPER_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'boss@x.co', role: 'admin' }),
    })
    expect(res.status).toBe(200)
    expect(store.invites[0]).toMatchObject({ role: 'admin' })
  })

  it('the 6th seat → TEAM_FULL (409) ★', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    // 5 seats already: the admin member (1) + 4 pending invites = 5.
    for (let i = 0; i < 4; i++) {
      store.invites.push({
        tenantId: 'mi-pase', email: `p${i}@x.co`, status: 'pending', role: 'member',
        invitedByDid: ADMIN_DID, claimedByDid: null, claimedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
      })
    }
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'sixth@x.co' }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('TEAM_FULL')
    expect(store.invites.find((i) => i.email === 'sixth@x.co')).toBeUndefined()
  })

  it('an email ACTIVE for another tenant → generic 409 (no leak) ★', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    store.invites.push({
      tenantId: 'other', email: 'dup@x.co', status: 'pending', role: 'member',
      invitedByDid: null, claimedByDid: null, claimedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'dup@x.co' }),
    })
    expect(res.status).toBe(409)
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toContain('dup@x.co')
    expect(raw).not.toContain('tenant_invites_active_email')
  })
})

// ── PATCH member role (superadmin) + last-admin guard ────────────────────────
describe('★ PATCH /v1/tenants/:id/members/:did — requireSuperadmin, last-admin guard', () => {
  it('a tenant-admin (not superadmin) → 403', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(ADMIN_DID).request(`/v1/tenants/mi-pase/members/${MEMBER_DID}`, {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(403)
  })

  it('a superadmin promotes a member to admin', async () => {
    store.supers.push(SUPER_DID)
    store.members.push({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'member', source: null })
    const res = await appAs(SUPER_DID).request(`/v1/tenants/mi-pase/members/${MEMBER_DID}`, {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(200)
    expect(store.members.find((m) => m.did === MEMBER_DID)!.role).toBe('admin')
  })

  it('demoting the LAST admin → 409 (no lockout) ★', async () => {
    store.supers.push(SUPER_DID)
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(SUPER_DID).request(`/v1/tenants/mi-pase/members/${ADMIN_DID}`, {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'member' }),
    })
    expect(res.status).toBe(409)
    expect(store.members.find((m) => m.did === ADMIN_DID)!.role).toBe('admin')
  })

  it('demoting one of TWO admins is allowed', async () => {
    store.supers.push(SUPER_DID)
    store.members.push(
      { tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null },
      { tenantId: 'mi-pase', did: 'did:privy:admin2', role: 'admin', source: null },
    )
    const res = await appAs(SUPER_DID).request(`/v1/tenants/mi-pase/members/${ADMIN_DID}`, {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'member' }),
    })
    expect(res.status).toBe(200)
    expect(store.members.find((m) => m.did === ADMIN_DID)!.role).toBe('member')
  })

  it('a non-member target → 403 (anti-enum, not 404) ★', async () => {
    store.supers.push(SUPER_DID)
    const res = await appAs(SUPER_DID).request('/v1/tenants/mi-pase/members/did:privy:ghost', {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(403)
  })
})

// ── superadmin tenant list ───────────────────────────────────────────────────
describe('★ GET /v1/superadmin/tenants — requireSuperadmin', () => {
  it('a superadmin gets the tenant list', async () => {
    store.supers.push(SUPER_DID)
    const res = await appAs(SUPER_DID).request('/v1/superadmin/tenants', { headers: BEARER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tenants: Array<{ id: string }> }
    expect(body.tenants.map((t) => t.id).sort()).toEqual(['mi-pase', 'other'])
  })

  it('a tenant-admin → 403 ★', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(ADMIN_DID).request('/v1/superadmin/tenants', { headers: BEARER })
    expect(res.status).toBe(403)
  })
})

// ── /tenants/me additive role + isSuperadmin ─────────────────────────────────
describe('GET /v1/tenants/me — additive role + isSuperadmin', () => {
  it('an admin member → role admin, isSuperadmin false', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(ADMIN_DID).request('/v1/tenants/me', { headers: BEARER })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { id: string; role?: string; isSuperadmin?: boolean }
    expect(view.id).toBe('mi-pase')
    expect(view.role).toBe('admin')
    expect(view.isSuperadmin).toBe(false)
  })

  it('a superadmin who is also a member → role + isSuperadmin true', async () => {
    store.supers.push(SUPER_DID)
    store.members.push({ tenantId: 'mi-pase', did: SUPER_DID, role: 'member', source: null })
    const res = await appAs(SUPER_DID).request('/v1/tenants/me', { headers: BEARER })
    const view = (await res.json()) as { role?: string; isSuperadmin?: boolean }
    expect(view.role).toBe('member')
    expect(view.isSuperadmin).toBe(true)
  })

  it('a service principal → no role, isSuperadmin false (additive, backward-compatible)', async () => {
    const res = await buildApp().request('/v1/tenants/me', { headers: { 'X-Service-Key': 'k' } })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { id: string; role?: string; isSuperadmin?: boolean }
    expect(view.id).toBe('mi-pase')
    expect(view.role).toBeUndefined()
    expect(view.isSuperadmin).toBe(false)
  })
})
