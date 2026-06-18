import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * admin-roles Wave A — focused coverage of the THREE role-flows that move a member's
 * role around and surface it on the self-view (§3-§5, §8):
 *
 *   (1) PATCH /v1/tenants/:id/members/:did { role } — requireSuperadmin: a superadmin
 *       PROMOTES a member to admin and DEMOTES an admin back to member; the LAST-ADMIN
 *       guard refuses to demote the only admin → 409 (no lockout).
 *   (2) POST /v1/tenants/claim — claimInvite grants the member the INVITE's role: an
 *       admin-invite, once claimed, binds a member row with role 'admin' (D2). A
 *       member-invite binds 'member'.
 *   (3) GET /v1/tenants/me — ADDITIVE role + isSuperadmin: a plain member sees
 *       role:'member', isSuperadmin:false; the superadmin sees isSuperadmin:true — AND
 *       every pre-existing TenantView field (id/name/status/currency/locale/branding/
 *       allowedWorkflows) is unchanged (purely additive, no shape regression).
 *
 * Hermetic: @pokta-engine/db is a TINY in-memory store of engine_tenants /
 * engine_tenant_members(role) / engine_tenant_invites(role) / engine_superadmins, and
 * drizzle-orm is mocked structurally. Privy auth uses an injected OFFLINE verifier (no
 * JWKS fetch); the claim path uses an injected OFFLINE email resolver (no getUser).
 * No Postgres, no pg-boss.
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
  branding: { name: 'Mi Pase', badge: '🎟️' },
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
    const w = m as { and?: unknown[]; eq?: [string, string]; inArray?: [string, string[]] }
    const out: Record<string, string> = {}
    const parts = w?.and ?? (w?.eq ? [w] : [])
    for (const part of parts) {
      const p = part as { eq?: [string, string] }
      if (p?.eq) out[p.eq[0]] = p.eq[1]
    }
    return out
  }
  // Pull the email[] out of an inArray(V.email, [...]) marker (findInviteForEmails).
  const emailsIn = (m: unknown): string[] | undefined => {
    const w = m as { and?: unknown[] }
    for (const part of w?.and ?? []) {
      const p = part as { inArray?: [string, string[]] }
      if (p?.inArray?.[0] === 'V.email') return p.inArray[1]
    }
    return undefined
  }
  const wouldConflict = (tenantId: string, email: string): boolean =>
    store.invites.some((i) => i.email === email && i.tenantId !== tenantId && i.status !== 'revoked')

  const handle = () => ({
    // select(cols).from(TABLE).where(pred)[.orderBy()|.limit()|.innerJoin()]
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
              // findInviteForEmails: where(and(inArray(V.email,[...]), ne(V.status,'revoked')))
              const emails = emailsIn(pred)
              if (emails) {
                const lowered = new Set(emails.map((e) => e.toLowerCase()))
                return store.invites.filter((i) => lowered.has(i.email) && i.status !== 'revoked')
              }
              return store.invites
                .filter(
                  (i) =>
                    (p['V.tenant_id'] === undefined || i.tenantId === p['V.tenant_id']) &&
                    (p['V.status'] === undefined || i.status === p['V.status']),
                )
                .map((i) => ({ email: i.email }))
            }
            // table === 'T'
            return store.tenants.map((x) => ({ tenantId: x.tenantId, name: x.name, status: x.status }))
          }
          const promise = run()
          return Object.assign(promise, {
            limit: async (_n: number) => promise,
            orderBy: async () => promise,
          })
        }
        // findTenantByMember (privy resolveTenant): M innerJoin T on M.did
        const innerJoin = () => ({
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
        })
        return { where, innerJoin, orderBy: async () => [] }
      },
    }),
    insert: (_t: { __table?: string }) => ({
      values: (v: Record<string, unknown>) => {
        // addTenantMember(tenantId, did, tx, source, role) — insert-only, ON CONFLICT
        // (tenant_id, did) DO NOTHING. Used by claimInvite to bind the member WITH the
        // invite's role.
        const ret = {
          onConflictDoNothing: async () => {
            const exists = store.members.some(
              (m) => m.tenantId === v.tenantId && m.did === v.did,
            )
            if (!exists) {
              store.members.push({
                tenantId: v.tenantId as string,
                did: v.did as string,
                role: (v.role as 'admin' | 'member') ?? 'member',
                source: (v.source as string) ?? null,
              })
            }
          },
        }
        // addInvite path (awaited, no onConflict) — not exercised here, kept honest.
        const insertInvite = async () => {
          if (wouldConflict(v.tenantId as string, v.email as string)) {
            const e = new Error('duplicate active email') as Error & { code: string }
            e.code = '23505'
            throw e
          }
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
          // invite update (claimInvite: mark claimed)
          const inv = store.invites.find(
            (i) => i.tenantId === p['V.tenant_id'] && i.email === p['V.email'],
          )
          if (inv) {
            if (vals.status) inv.status = vals.status as InviteRow['status']
            if ('claimedByDid' in vals) inv.claimedByDid = (vals.claimedByDid as string) ?? null
            if ('role' in vals) inv.role = vals.role as 'admin' | 'member'
            inv.claimedAt = new Date('2026-06-12T00:00:00Z')
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
    // execute() serves three raw-SQL callers, distinguished by vals shape:
    //   - claimThrottle ledger upsert/lock/update → harmless [] (5-tuple / count rows)
    //   - withTenantSeatLock advisory lock → [] (2 numeric-ish vals; not used here)
    //   - claimInvite SELECT ... FOR UPDATE by email → the locked invite row (carries
    //     tenant_id, email, status, claimed_by_did, ROLE — the role the claim grants).
    execute: async (q: unknown) => {
      const vals = (q as { vals?: unknown[] })?.vals ?? []
      // claimInvite locks by a single email value: `where email = ${email} and status != 'revoked'`.
      if (vals.length === 1 && typeof vals[0] === 'string') {
        const email = (vals[0] as string).toLowerCase()
        const inv = store.invites.find((i) => i.email === email && i.status !== 'revoked')
        return inv
          ? [
              {
                tenant_id: inv.tenantId,
                email: inv.email,
                status: inv.status,
                claimed_by_did: inv.claimedByDid,
                role: inv.role,
              },
            ]
          : []
      }
      // ledger select-count FOR UPDATE returns a count row so the throttle reads 0.
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
const { __resetClaimNegCache } = await import('./claim-neg-cache')

const SUPER_DID = 'did:privy:super'
const ADMIN_DID = 'did:privy:admin'
const MEMBER_DID = 'did:privy:member'

const BEARER = { Authorization: 'Bearer offline', 'Content-Type': 'application/json' }

/** An app whose offline Privy verifier returns the given DID as the principal. */
function appAs(did: string) {
  return buildApp({ auth: { verifyPrivyToken: async () => ({ userId: did, appId: 'app1' }) } })
}

/**
 * An app for the claim flow: the offline Privy verifier resolves the bearer to `did`,
 * and the injected email resolver returns `email` as the DID's VERIFIED email (so no
 * getUser network call happens).
 */
function claimApp(did: string, email: string) {
  return buildApp({
    auth: { verifyPrivyToken: async () => ({ userId: did, appId: 'app1' }) },
    resolvePrivyEmails: async () => [email],
  })
}

beforeEach(() => {
  store.tenants = [{ ...MIPASE }, { ...OTHER }]
  store.members = []
  store.invites = []
  store.supers = []
  __resetTenantCache()
  __resetClaimNegCache()
  process.env.SERVICE_KEYS = 'mi-pase:k'
  process.env.OPERATOR_KEY = 'op'
  delete process.env.PRIVY_TENANT_MAP
})

// ── (1) PATCH member role: promote / demote / last-admin guard ───────────────────
describe('PATCH /v1/tenants/:id/members/:did — superadmin promote/demote + last-admin guard', () => {
  it('a superadmin PROMOTES a member to admin', async () => {
    store.supers.push(SUPER_DID)
    store.members.push({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'member', source: null })
    const res = await appAs(SUPER_DID).request(`/v1/tenants/mi-pase/members/${MEMBER_DID}`, {
      method: 'PATCH',
      headers: BEARER,
      body: JSON.stringify({ role: 'admin' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'admin' })
    expect(store.members.find((m) => m.did === MEMBER_DID)!.role).toBe('admin')
  })

  it('a superadmin DEMOTES an admin (when another admin remains)', async () => {
    store.supers.push(SUPER_DID)
    store.members.push(
      { tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null },
      { tenantId: 'mi-pase', did: 'did:privy:admin2', role: 'admin', source: null },
    )
    const res = await appAs(SUPER_DID).request(`/v1/tenants/mi-pase/members/${ADMIN_DID}`, {
      method: 'PATCH',
      headers: BEARER,
      body: JSON.stringify({ role: 'member' }),
    })
    expect(res.status).toBe(200)
    expect(store.members.find((m) => m.did === ADMIN_DID)!.role).toBe('member')
  })

  it('demoting the ONLY admin → 409 (last-admin guard, no lockout) ★', async () => {
    store.supers.push(SUPER_DID)
    store.members.push({ tenantId: 'mi-pase', did: ADMIN_DID, role: 'admin', source: null })
    const res = await appAs(SUPER_DID).request(`/v1/tenants/mi-pase/members/${ADMIN_DID}`, {
      method: 'PATCH',
      headers: BEARER,
      body: JSON.stringify({ role: 'member' }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('APPROVAL_DENIED')
    // The role was NOT changed — the only admin stays admin.
    expect(store.members.find((m) => m.did === ADMIN_DID)!.role).toBe('admin')
  })
})

// ── (2) claimInvite grants the invite's role ─────────────────────────────────────
describe('POST /v1/tenants/claim — claimInvite grants the INVITE role (D2)', () => {
  it('an ADMIN invite, once claimed, binds a member with role admin ★', async () => {
    store.invites.push({
      tenantId: 'mi-pase',
      email: 'boss@x.co',
      status: 'pending',
      role: 'admin',
      invitedByDid: null,
      claimedByDid: null,
      claimedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const res = await claimApp(MEMBER_DID, 'boss@x.co').request('/v1/tenants/claim', {
      method: 'POST',
      headers: BEARER,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    // The claimer is now a member of mi-pase WITH the invite's admin role.
    const bound = store.members.find((m) => m.did === MEMBER_DID)
    expect(bound).toMatchObject({ tenantId: 'mi-pase', role: 'admin' })
    // The invite is marked claimed by this DID (not orphaned).
    const inv = store.invites.find((i) => i.email === 'boss@x.co')!
    expect(inv.status).toBe('claimed')
    expect(inv.claimedByDid).toBe(MEMBER_DID)
  })

  it('a MEMBER invite binds a member with role member', async () => {
    store.invites.push({
      tenantId: 'mi-pase',
      email: 'plain@x.co',
      status: 'pending',
      role: 'member',
      invitedByDid: null,
      claimedByDid: null,
      claimedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const res = await claimApp(MEMBER_DID, 'plain@x.co').request('/v1/tenants/claim', {
      method: 'POST',
      headers: BEARER,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(store.members.find((m) => m.did === MEMBER_DID)).toMatchObject({
      tenantId: 'mi-pase',
      role: 'member',
    })
  })
})

// ── (3) GET /v1/tenants/me — additive role + isSuperadmin (no field regression) ──
describe('GET /v1/tenants/me — additive role + isSuperadmin', () => {
  // The pre-existing TenantView fields (Wave 0) that MUST stay byte-stable — role +
  // isSuperadmin are layered ON TOP, never replacing any of these.
  const MIPASE_VIEW = {
    id: 'mi-pase',
    name: 'Mi Pase',
    status: 'active',
    currency: 'MXN',
    locale: 'es-MX',
    branding: { name: 'Mi Pase', badge: '🎟️' },
    allowedWorkflows: ['pricing-draft'],
  }

  it('a plain member → role:"member", isSuperadmin:false, and TenantView unchanged ★', async () => {
    store.members.push({ tenantId: 'mi-pase', did: MEMBER_DID, role: 'member', source: null })
    const res = await appAs(MEMBER_DID).request('/v1/tenants/me', { headers: BEARER })
    expect(res.status).toBe(200)
    const view = (await res.json()) as Record<string, unknown>
    // Additive fields.
    expect(view.role).toBe('member')
    expect(view.isSuperadmin).toBe(false)
    // Every existing TenantView field is byte-identical (additive, no regression).
    expect(view).toMatchObject(MIPASE_VIEW)
    // The view is EXACTLY the base view + the two additive keys — no integrations leak,
    // no secretPrefix/members exposure.
    expect(Object.keys(view).sort()).toEqual(
      [...Object.keys(MIPASE_VIEW), 'role', 'isSuperadmin'].sort(),
    )
  })

  it('the superadmin (also a member) → isSuperadmin:true, role from membership', async () => {
    store.supers.push(SUPER_DID)
    store.members.push({ tenantId: 'mi-pase', did: SUPER_DID, role: 'admin', source: null })
    const res = await appAs(SUPER_DID).request('/v1/tenants/me', { headers: BEARER })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { role?: string; isSuperadmin?: boolean; id?: string }
    expect(view.isSuperadmin).toBe(true)
    expect(view.role).toBe('admin')
    expect(view).toMatchObject(MIPASE_VIEW)
  })

  it('a service principal → no role, isSuperadmin:false (additive, backward-compatible)', async () => {
    const res = await buildApp().request('/v1/tenants/me', { headers: { 'X-Service-Key': 'k' } })
    expect(res.status).toBe(200)
    const view = (await res.json()) as Record<string, unknown>
    expect(view.role).toBeUndefined()
    expect(view.isSuperadmin).toBe(false)
    expect(view).toMatchObject(MIPASE_VIEW)
  })
})
