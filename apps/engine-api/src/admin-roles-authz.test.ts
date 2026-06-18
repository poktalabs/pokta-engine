import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * admin-roles Wave A — the PRIVILEGE-ESCALATION ★ regression (§3-§5, §8). This file
 * is the adversarial twin of admin-roles.test.ts: where that proves the happy paths +
 * each guard fires, THIS pins the security invariants — that an under-privileged caller
 * can NEVER cross the role boundary and learns NOTHING from trying.
 *
 *   (1) a MEMBER (role=member) on ANY team route → 403 APPROVAL_DENIED, byte-identical
 *       envelope across GET/POST/DELETE invites, PATCH members, GET /superadmin/tenants.
 *   (2) a tenant-ADMIN of A acting on B → 403, and the envelope is byte-identical to a
 *       NON-EXISTENT tenant's → no existence/membership leak (anti-enum).
 *   (3) a tenant-admin POST role:'admin' → REJECTED 403 (NOT coerced to member, NOT
 *       written) — the same APPROVAL_DENIED envelope, no DB side effect.
 *   (4) ONLY a superadmin may grant role:'admin', PATCH a member's role, or GET
 *       /superadmin/tenants. (mirrors the authority ceiling from the other direction.)
 *   (5) requireTenantAdmin lets a SUPERADMIN through for ANY tenant — even one it is not
 *       a member of.
 *
 * Hermetic: @pokta-engine/db + @pokta-engine/queue mocked (TINY in-memory engine_tenants
 * / engine_tenant_members(role) / engine_tenant_invites(role) / engine_superadmins store);
 * drizzle-orm mocked structurally; Privy auth via an injected offline verifier on buildApp.
 * The db mock is the same shape as admin-roles.test.ts so the routes exercise their REAL
 * authorize-before-lookup ordering against an in-memory REGISTRY.
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
        const orderBy = async () => {
          if (table === 'T') {
            return [...store.tenants]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((x) => ({ tenantId: x.tenantId, name: x.name, status: x.status }))
          }
          return []
        }
        return {
          where,
          orderBy,
          innerJoin: () => ({
            where: (pred: unknown) => ({
              limit: async () => {
                const p = pairs(pred)
                const did = p['M.did']
                return store.members
                  .filter((m) => m.did === did)
                  .map((m) => ({ tenant: store.tenants.find((tt) => tt.tenantId === m.tenantId) }))
                  .filter((r) => r.tenant)
              },
            }),
          }),
        }
      },
    }),
    insert: (_t: { __table?: string }) => ({
      values: (v: Record<string, unknown>) => {
        const ret = {
          onConflictDoNothing: async () => {
            store.members.push({
              tenantId: v.tenantId as string,
              did: v.did as string,
              role: (v.role as 'admin' | 'member') ?? 'member',
              source: (v.source as string) ?? null,
            })
          },
        }
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
        return Object.assign(insertInvite(), ret)
      },
    }),
    update: (_t: { __table?: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (pred: unknown) => {
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
            return
          }
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

// The fixed anti-enum envelope every role-authz denial returns (§8). Pinned here as a
// CONSTANT so a regression that personalizes the message (leaking which check failed)
// breaks these tests, not just a code check.
const DENIED_ENVELOPE = { error: { code: 'APPROVAL_DENIED', message: 'not authorized', retryable: false } }

/** The full parsed JSON body — used to prove byte-identical envelopes across routes. */
async function envelope(res: Response): Promise<unknown> {
  return res.json()
}

/** Await a hono `app.request(...)` (Response | Promise<Response>) and return its raw text. */
async function bodyText(p: Response | Promise<Response>): Promise<string> {
  return (await p).text()
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) ★ A PLAIN MEMBER is denied on EVERY team route, with the SAME envelope.
// ─────────────────────────────────────────────────────────────────────────────
describe('★ a role=member caller is denied on every team route (identical envelope)', () => {
  beforeEach(() => {
    store.members.push({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'member', source: null })
  })

  it('GET /v1/tenants/:id/invites → 403 APPROVAL_DENIED', async () => {
    const res = await appAs(MEMBER_DID).request('/v1/tenants/mi-pase/invites', { headers: BEARER })
    expect(res.status).toBe(403)
    expect(await envelope(res)).toEqual(DENIED_ENVELOPE)
  })

  it('POST /v1/tenants/:id/invites → 403, and NO invite is written', async () => {
    const res = await appAs(MEMBER_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'x@x.co' }),
    })
    expect(res.status).toBe(403)
    expect(await envelope(res)).toEqual(DENIED_ENVELOPE)
    expect(store.invites).toHaveLength(0)
  })

  it('DELETE /v1/tenants/:id/invites/:email → 403, and NO mutation happens', async () => {
    store.invites.push({
      tenantId: 'mi-pase', email: 'keep@x.co', status: 'claimed', role: 'member',
      invitedByDid: null, claimedByDid: MEMBER_DID, claimedAt: new Date(),
      createdAt: new Date(), updatedAt: new Date(),
    })
    const res = await appAs(MEMBER_DID).request('/v1/tenants/mi-pase/invites/keep@x.co', {
      method: 'DELETE', headers: BEARER,
    })
    expect(res.status).toBe(403)
    expect(await envelope(res)).toEqual(DENIED_ENVELOPE)
    // The deprovision never ran: the invite stays claimed, the member stays bound.
    expect(store.invites[0]!.status).toBe('claimed')
    expect(store.members.find((m) => m.did === MEMBER_DID)).toBeDefined()
  })

  it('PATCH /v1/tenants/:id/members/:did → 403 (members can never reach the superadmin gate)', async () => {
    const res = await appAs(MEMBER_DID).request(`/v1/tenants/mi-pase/members/${ADMIN_DID}`, {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(403)
    expect(await envelope(res)).toEqual(DENIED_ENVELOPE)
  })

  it('GET /v1/superadmin/tenants → 403', async () => {
    const res = await appAs(MEMBER_DID).request('/v1/superadmin/tenants', { headers: BEARER })
    expect(res.status).toBe(403)
    expect(await envelope(res)).toEqual(DENIED_ENVELOPE)
  })

  it('the denial envelope is BYTE-IDENTICAL across all five routes (no per-route leak)', async () => {
    const app = appAs(MEMBER_DID)
    const bodies = await Promise.all([
      bodyText(app.request('/v1/tenants/mi-pase/invites', { headers: BEARER })),
      bodyText(
        app.request('/v1/tenants/mi-pase/invites', {
          method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'x@x.co' }),
        }),
      ),
      bodyText(
        app.request('/v1/tenants/mi-pase/invites/x@x.co', { method: 'DELETE', headers: BEARER }),
      ),
      bodyText(
        app.request(`/v1/tenants/mi-pase/members/${ADMIN_DID}`, {
          method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'member' }),
        }),
      ),
      bodyText(app.request('/v1/superadmin/tenants', { headers: BEARER })),
    ])
    const [first] = bodies
    for (const b of bodies) expect(b).toBe(first)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (2) ★ A tenant-ADMIN of A probing tenant B learns NOTHING — the denial for a
//     real-but-foreign tenant is byte-identical to the denial for a tenant that
//     does not exist at all (anti-enum: no existence oracle).
// ─────────────────────────────────────────────────────────────────────────────
describe('★ cross-tenant: a tenant-admin of A is denied on B, no existence leak', () => {
  beforeEach(() => {
    // ADMIN_DID is an admin of `other`, NOT of `mi-pase`.
    store.members.push({ tenantId: 'other', did: ADMIN_DID, role: 'admin', source: null })
  })

  it('GET on a foreign tenant → 403, identical envelope to a NON-EXISTENT tenant', async () => {
    const app = appAs(ADMIN_DID)
    const foreign = await app.request('/v1/tenants/mi-pase/invites', { headers: BEARER })
    const ghost = await app.request('/v1/tenants/ghost-co/invites', { headers: BEARER })
    expect(foreign.status).toBe(403)
    expect(ghost.status).toBe(403)
    expect(await envelope(foreign)).toEqual(DENIED_ENVELOPE)
    expect(await ghost.json()).toEqual(DENIED_ENVELOPE)
  })

  it('POST on a foreign tenant → 403, NOT written (authorize-before-lookup)', async () => {
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'x@x.co' }),
    })
    expect(res.status).toBe(403)
    expect(await envelope(res)).toEqual(DENIED_ENVELOPE)
    expect(store.invites).toHaveLength(0)
  })

  it('the foreign-tenant denial equals the ghost-tenant denial byte-for-byte', async () => {
    const app = appAs(ADMIN_DID)
    const foreign = await bodyText(app.request('/v1/tenants/mi-pase/invites', { headers: BEARER }))
    const ghost = await bodyText(app.request('/v1/tenants/ghost-co/invites', { headers: BEARER }))
    expect(foreign).toBe(ghost)
  })

  it('a tenant-admin IS allowed on its OWN tenant (control: the gate is not blanket-deny)', async () => {
    const res = await appAs(ADMIN_DID).request('/v1/tenants/other/invites', { headers: BEARER })
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (3) ★ A tenant-admin asking for role:'admin' is REJECTED — never silently
//     coerced to a member invite, never written.
// ─────────────────────────────────────────────────────────────────────────────
describe("★ POST role:'admin' by a tenant-admin → rejected (not coerced)", () => {
  beforeEach(() => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
  })

  it('→ 403 APPROVAL_DENIED, identical envelope, and NO row written', async () => {
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'climber@x.co', role: 'admin' }),
    })
    expect(res.status).toBe(403)
    expect(await envelope(res)).toEqual(DENIED_ENVELOPE)
    // Reject-not-coerce: it was NOT downgraded to a member invite.
    expect(store.invites).toHaveLength(0)
  })

  it("its denial is byte-identical to a plain unauthorized denial (no 'why' leak)", async () => {
    const admin = appAs(ADMIN_DID)
    // A tenant-admin overreaching for role:admin …
    const reject = await bodyText(
      admin.request('/v1/tenants/mi-pase/invites', {
        method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'a@x.co', role: 'admin' }),
      }),
    )
    // … vs a member denied outright. Same fixed envelope, so the role:admin reject
    // cannot be told apart from a pure authz failure.
    store.members.push({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'member', source: null })
    const plain = await bodyText(
      appAs(MEMBER_DID).request('/v1/tenants/mi-pase/invites', {
        method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'b@x.co' }),
      }),
    )
    expect(reject).toBe(plain)
  })

  it('a member-role invite from the SAME admin still succeeds (control)', async () => {
    const res = await appAs(ADMIN_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'ok@x.co', role: 'member' }),
    })
    expect(res.status).toBe(200)
    expect(store.invites[0]).toMatchObject({ email: 'ok@x.co', role: 'member' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (4) Only a SUPERADMIN may grant role:'admin', PATCH member roles, or list tenants.
// ─────────────────────────────────────────────────────────────────────────────
describe('only a superadmin holds the elevated grants', () => {
  it('a superadmin POST role:admin → 200, admin invite written', async () => {
    store.supers.push(SUPER_DID)
    const res = await appAs(SUPER_DID).request('/v1/tenants/mi-pase/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'boss@x.co', role: 'admin' }),
    })
    expect(res.status).toBe(200)
    expect(store.invites[0]).toMatchObject({ email: 'boss@x.co', role: 'admin' })
  })

  it('a superadmin PATCH promotes a member; a tenant-admin cannot', async () => {
    store.members.push({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'member', source: null })
    // tenant-admin denied …
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const denied = await appAs(ADMIN_DID).request(`/v1/tenants/mi-pase/members/${MEMBER_DID}`, {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'admin' }),
    })
    expect(denied.status).toBe(403)
    expect(await envelope(denied)).toEqual(DENIED_ENVELOPE)
    expect(store.members.find((m) => m.did === MEMBER_DID)!.role).toBe('member') // unchanged
    // … superadmin allowed.
    store.supers.push(SUPER_DID)
    const ok = await appAs(SUPER_DID).request(`/v1/tenants/mi-pase/members/${MEMBER_DID}`, {
      method: 'PATCH', headers: BEARER, body: JSON.stringify({ role: 'admin' }),
    })
    expect(ok.status).toBe(200)
    expect(store.members.find((m) => m.did === MEMBER_DID)!.role).toBe('admin')
  })

  it('only a superadmin sees GET /v1/superadmin/tenants', async () => {
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    expect(
      (await appAs(ADMIN_DID).request('/v1/superadmin/tenants', { headers: BEARER })).status,
    ).toBe(403)
    store.supers.push(SUPER_DID)
    const ok = await appAs(SUPER_DID).request('/v1/superadmin/tenants', { headers: BEARER })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { tenants: Array<{ id: string }> }
    expect(body.tenants.map((t) => t.id).sort()).toEqual(['mi-pase', 'other'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (5) requireTenantAdmin passes a SUPERADMIN for ANY tenant — even one it is not a
//     member of. The superadmin is the cross-tenant escape hatch by design.
// ─────────────────────────────────────────────────────────────────────────────
describe('★ requireTenantAdmin admits a superadmin for any tenant (non-member)', () => {
  beforeEach(() => {
    store.supers.push(SUPER_DID)
    // SUPER_DID is NOT a member of mi-pase or other — purely a platform superadmin.
  })

  it('GET on a tenant it is not a member of → 200', async () => {
    const res = await appAs(SUPER_DID).request('/v1/tenants/mi-pase/invites', { headers: BEARER })
    expect(res.status).toBe(200)
  })

  it('POST a member invite on a non-member tenant → 200, written for THAT tenant', async () => {
    const res = await appAs(SUPER_DID).request('/v1/tenants/other/invites', {
      method: 'POST', headers: BEARER, body: JSON.stringify({ email: 'x@x.co' }),
    })
    expect(res.status).toBe(200)
    expect(store.invites[0]).toMatchObject({ tenantId: 'other', email: 'x@x.co', role: 'member' })
  })

  it('DELETE on a non-member tenant → 200 (the superadmin can deprovision anywhere)', async () => {
    store.invites.push({
      tenantId: 'mi-pase', email: 'gone@x.co', status: 'pending', role: 'member',
      invitedByDid: null, claimedByDid: null, claimedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    const res = await appAs(SUPER_DID).request('/v1/tenants/mi-pase/invites/gone@x.co', {
      method: 'DELETE', headers: BEARER,
    })
    expect(res.status).toBe(200)
  })
})
