import { describe, expect, it, vi, beforeEach } from 'vitest'
import { listManifests } from '@godin-engine/workflows'

/**
 * TENANTS/ME block (T6 / §6) — drives `GET /v1/tenants/me` on `buildApp()`.
 *
 * Asserts the INTENDED behavior from the plan §5/§6:
 *   - authed mi-pase (service key)           → 200 with a TenantView:
 *       · typed branding `{ name, badge? }`,
 *       · allowedWorkflows filtered to the tenant's set ∩ the live registry,
 *       · integrations as string[] validated against listIntegrations(),
 *   - no credential                          → 401 UNAUTHENTICATED (auth middleware),
 *   - a DISABLED or PENDING tenant           → 403 TENANT_UNKNOWN (not-active fails closed),
 *   - an unknown principal (no tenant row)   → 403 TENANT_UNKNOWN,
 *   - a Privy principal in a tenant's members[] → 200 (membership resolution),
 *   - branding without a badge               → TenantView.branding omits `badge`.
 *
 * MOCKING POSTURE (matches the canonical engine-api pattern in
 * {auth,isolation,m1-regression}.test.ts): the @godin-engine/db client throws on
 * import without DATABASE_URL, so it is ALWAYS mocked; @godin-engine/queue is
 * mocked too (the /v1/tenants/me path never dispatches, but buildApp imports it).
 * We DO NOT mock ./tenants, @godin-engine/workflows, or @godin-engine/integrations
 * — so toTenantView()/allowedWorkflowsFor() run for REAL against the live workflow
 * + integration registries. That is what makes "integrations validated vs
 * listIntegrations()" and "allowedWorkflows filtered to the live set" real
 * assertions rather than tautologies. The db mock is the only seam controlling
 * which tenant ROW the registry reads.
 */

// ── Tenant rows the mocked db serves (the registry reads through here) ────────
type TenantRow = {
  tenantId: string
  name: string
  status: 'active' | 'pending' | 'disabled'
  currency: string
  locale: string
  branding: { name?: string; badge?: string }
  allowedWorkflows: string[]
  members: string[]
  secretPrefix: string | null
}

// In-memory tenant table the db mock filters. Tests seed this per case.
const store: { tenants: TenantRow[] } = { tenants: [] }

// Real M1/vino workflow ids (verified against listManifests()).
const MIPASE_WORKFLOWS = ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged']

const MIPASE: TenantRow = {
  tenantId: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: MIPASE_WORKFLOWS,
  members: ['did:privy:mipase-owner'],
  secretPrefix: 'MIPASE',
}

const VINO_PENDING: TenantRow = {
  tenantId: 'vino',
  name: 'Vino Design Build',
  status: 'pending',
  currency: 'USD',
  locale: 'en',
  branding: { name: 'Vino Design Build' }, // no badge
  allowedWorkflows: ['call-intake', 'proposal-step', 'send-step'],
  members: [],
  secretPrefix: 'VINO',
}

vi.mock('@godin-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

/**
 * The db mock services exactly the two reads the registry performs:
 *   - getTenant(id)         → db.query.engineTenants.findFirst({ where: eq(tenant_id, id) })
 *   - findTenantByMember(d) → db.select({tenant:T}).from(engine_tenant_members)
 *                               .innerJoin(T, eq(M.tenant_id, T.tenant_id))
 *                               .where(eq(M.did, did)).limit(2)  → [{ tenant }]
 *
 * Membership now lives in engine_tenant_members (Wave 0). The fixture is each tenant
 * row's `members` DID list; the mock resolves a queried DID to the owning tenant
 * row(s) and projects { tenant }. The drizzle-orm mock encodes `eq(col, val)` as
 * { eq: [col, val] }, so the mock reads the queried DID off the where-marker.
 */
vi.mock('@godin-engine/db', () => {
  const findFirst = async ({ where }: { where: { eq?: [string, string] } }) => {
    const wantId = where?.eq?.[0] === 'tenant_id' ? where.eq[1] : undefined
    if (wantId === undefined) return undefined
    return store.tenants.find((t) => t.tenantId === wantId)
  }
  // Pull the queried DID out of an `eq(M.did, did)` where-marker.
  const didFrom = (pred: { eq?: [string, string] }): string | undefined =>
    pred?.eq?.[0] === 'M.did' ? pred.eq[1] : undefined
  // Read a tagged column's value out of an eq-marker.
  const eqVal = (m: unknown, col: string): string | undefined => {
    const w = m as { eq?: [unknown, unknown] }
    return w?.eq && w.eq[0] === col ? (w.eq[1] as string) : undefined
  }
  // Pull (tenant_id, did) out of an and([eq,eq]) marker (tenantRoleOf where).
  const andPairMember = (m: unknown): { tenantId?: string; did?: string } => {
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
    query: {
      engineTenants: { findFirst },
    },
    // Two select shapes are serviced:
    //  - findTenantByMember: select().from(M).innerJoin(T,...).where(eq(M.did,did)).limit(n)
    //  - roles.ts (admin-roles Wave A): isSuperadmin/tenantRoleOf read via
    //    select(cols).from(S|M).where(...).limit(1) — NO innerJoin. The members fixture
    //    has no per-member role here, so tenantRoleOf resolves the role as 'member'
    //    (or null when not a member); engine_superadmins is empty → isSuperadmin false.
    select: (cols?: Record<string, unknown>) => ({
      from: () => ({
        innerJoin: () => ({
          where: (pred: { eq?: [string, string] }) => ({
            limit: async (_n: number) => {
              const did = didFrom(pred)
              return store.tenants
                .filter((t) => did != null && t.members.includes(did))
                .map((tenant) => ({ tenant }))
            },
          }),
        }),
        // roles.ts where(...) — disambiguate by the projected columns.
        where: (pred: unknown) => {
          const wantsRole = !!cols && 'role' in cols
          const wantsDid = !!cols && 'did' in cols
          const run = async () => {
            if (wantsRole) {
              // tenantRoleOf: membership row → 'member' if the DID is in members[].
              const { tenantId, did } = andPairMember(pred)
              const isMember = store.tenants.some(
                (t) => t.tenantId === tenantId && did != null && t.members.includes(did),
              )
              return isMember ? [{ role: 'member' }] : []
            }
            if (wantsDid) {
              // isSuperadmin: engine_superadmins is empty in this fixture → no rows.
              return []
            }
            return []
          }
          return Object.assign(run, { limit: async (_n: number) => run() })
        },
      }),
    }),
  }
  return {
    db,
    schema: {
      engineTenants: { tenantId: 'tenant_id' },
      engineTenantMembers: { tenantId: 'M.tenant_id', did: 'M.did', role: 'M.role' },
      engineSuperadmins: { did: 'S.did' },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x }),
  desc: (x: unknown) => x,
  sql: Object.assign((_s: TemplateStringsArray, ..._vals: unknown[]) => ({}), {
    raw: () => ({}),
  }),
}))

// Import AFTER the mocks. We import the REAL tenants module too, only to reset its
// in-process TTL cache between cases (so a stale row never leaks across tests).
const { buildApp } = await import('./app')
const { __resetTenantCache } = await import('./tenants')

const MIPASE_KEY = { 'X-Service-Key': 'svc-key-mipase' }

beforeEach(() => {
  store.tenants = []
  __resetTenantCache()
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,vino:svc-key-vino,ghost:svc-key-ghost'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('GET /v1/tenants/me — authed tenant profile (T6)', () => {
  it('authed mi-pase (service key) → 200 with a well-typed TenantView', async () => {
    store.tenants = [MIPASE]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: MIPASE_KEY })
    expect(res.status).toBe(200)
    const view = (await res.json()) as {
      id: string
      name: string
      status: string
      currency: string
      locale: string
      branding: { name: string; badge?: string }
      allowedWorkflows: string[]
    }
    expect(view.id).toBe('mi-pase')
    expect(view.name).toBe('Mi Pase')
    expect(view.status).toBe('active')
    expect(view.currency).toBe('MXN')
    expect(view.locale).toBe('es-MX')
  })

  it('branding is the TYPED projection { name, badge? } — never the raw jsonb column', async () => {
    store.tenants = [MIPASE]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: MIPASE_KEY })
    const view = (await res.json()) as { branding: { name: string; badge?: string } }
    expect(view.branding).toEqual({ name: 'Mi Pase', badge: 'Shopify test store' })
    // Server-only fields must NEVER leak into the view.
    const raw = JSON.stringify(view)
    expect(raw).not.toContain('secretPrefix')
    expect(raw).not.toContain('MIPASE') // secret_prefix value
    expect(raw).not.toContain('members')
  })

  it('branding omits badge when the tenant has none (active w/ no badge)', async () => {
    // An ACTIVE clone of vino (vino itself is pending) with no branding.badge.
    store.tenants = [{ ...VINO_PENDING, status: 'active' }]
    process.env.SERVICE_KEYS = 'vino:svc-key-vino'
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: { 'X-Service-Key': 'svc-key-vino' } })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { branding: { name: string; badge?: string } }
    expect(view.branding).toEqual({ name: 'Vino Design Build' })
    expect(view.branding.badge).toBeUndefined()
  })

  it("allowedWorkflows is FILTERED to the tenant's set ∩ the live workflow registry", async () => {
    store.tenants = [MIPASE]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: MIPASE_KEY })
    const view = (await res.json()) as { allowedWorkflows: string[] }
    // Exactly mi-pase's three pricing ids, and every one is a real live workflow.
    expect([...view.allowedWorkflows].sort()).toEqual([...MIPASE_WORKFLOWS].sort())
    const live = new Set(listManifests().map((m) => m.id))
    expect(view.allowedWorkflows.every((id) => live.has(id))).toBe(true)
    // It must NOT include vino's workflows (another tenant's allow-list).
    expect(view.allowedWorkflows).not.toContain('call-intake')
  })

  it('a configured workflow id that is NOT in the live registry is dropped from the view', async () => {
    store.tenants = [
      { ...MIPASE, allowedWorkflows: [...MIPASE_WORKFLOWS, 'ghost-workflow-not-real'] },
    ]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: MIPASE_KEY })
    const view = (await res.json()) as { allowedWorkflows: string[] }
    expect(view.allowedWorkflows).not.toContain('ghost-workflow-not-real')
    expect([...view.allowedWorkflows].sort()).toEqual([...MIPASE_WORKFLOWS].sort())
  })

  it('unauthenticated (no credential) → 401 UNAUTHENTICATED', async () => {
    store.tenants = [MIPASE]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('a bad service key → 401 UNAUTHENTICATED (never leaks tenant info)', async () => {
    store.tenants = [MIPASE]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: { 'X-Service-Key': 'svc-key-WRONG' } })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('a DISABLED tenant → 403 TENANT_UNKNOWN (status not enforced ⇒ fails closed)', async () => {
    store.tenants = [{ ...MIPASE, status: 'disabled' }]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: MIPASE_KEY })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
    // It must not leak that the tenant exists-but-is-disabled.
    expect(JSON.stringify(body)).not.toContain('disabled')
  })

  it('a PENDING tenant → 403 TENANT_UNKNOWN (not yet active ⇒ fails closed)', async () => {
    store.tenants = [VINO_PENDING]
    process.env.SERVICE_KEYS = 'vino:svc-key-vino'
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: { 'X-Service-Key': 'svc-key-vino' } })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })

  it('an authed principal whose tenant row does not exist → 403 TENANT_UNKNOWN', async () => {
    // 'ghost' has a valid service key but NO row in the registry.
    store.tenants = [MIPASE]
    const app = buildApp()
    const res = await app.request('/v1/tenants/me', { headers: { 'X-Service-Key': 'svc-key-ghost' } })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })
})

describe('GET /v1/tenants/me — Privy membership resolution', () => {
  it('a Privy DID listed in a tenant members[] → 200 with that tenant view', async () => {
    store.tenants = [MIPASE]
    const app = buildApp({
      auth: { verifyPrivyToken: async () => ({ userId: 'did:privy:mipase-owner', appId: 'app1' }) },
    })
    const res = await app.request('/v1/tenants/me', {
      headers: { Authorization: 'Bearer offline-token' },
    })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { id: string }
    expect(view.id).toBe('mi-pase')
  })

  it('a Privy DID in NO tenant members[] → 403 TENANT_UNKNOWN', async () => {
    store.tenants = [MIPASE]
    const app = buildApp({
      auth: { verifyPrivyToken: async () => ({ userId: 'did:privy:stranger', appId: 'app1' }) },
    })
    const res = await app.request('/v1/tenants/me', {
      headers: { Authorization: 'Bearer offline-token' },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })

  it('a Privy DID present in TWO tenants members[] → 403 TENANT_UNKNOWN (ambiguous ⇒ fail closed)', async () => {
    const did = 'did:privy:shared'
    store.tenants = [
      { ...MIPASE, members: [did] },
      { ...VINO_PENDING, status: 'active', members: [did] },
    ]
    const app = buildApp({
      auth: { verifyPrivyToken: async () => ({ userId: did, appId: 'app1' }) },
    })
    const res = await app.request('/v1/tenants/me', {
      headers: { Authorization: 'Bearer offline-token' },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })

  // ── Split-brain guard (Wave 0 step 6, Codex fold) ────────────────────────────
  // /v1/tenants/me applies the SAME confused-deputy guard the data routes use: a
  // privy principal whose non-empty consumer.id (from the legacy PRIVY_TENANT_MAP)
  // DISAGREES with the membership-resolved tenant fails closed. Otherwise a
  // post-claim /tenants/me could succeed while later scoped data calls (keyed off
  // the resolved tenant) fail — a split brain.
  it('a Privy DID whose PRIVY_TENANT_MAP consumer.id DISAGREES with the resolved tenant → 403 TENANT_UNKNOWN', async () => {
    store.tenants = [MIPASE] // DID is mi-pase's member…
    process.env.PRIVY_TENANT_MAP = 'did:privy:mipase-owner=other' // …but env maps it to 'other'.
    const app = buildApp({
      auth: { verifyPrivyToken: async () => ({ userId: 'did:privy:mipase-owner', appId: 'app1' }) },
    })
    const res = await app.request('/v1/tenants/me', {
      headers: { Authorization: 'Bearer offline-token' },
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })

  it('happy path still passes when PRIVY_TENANT_MAP AGREES with the resolved tenant → 200', async () => {
    store.tenants = [MIPASE]
    process.env.PRIVY_TENANT_MAP = 'did:privy:mipase-owner=mi-pase' // agrees → no split brain.
    const app = buildApp({
      auth: { verifyPrivyToken: async () => ({ userId: 'did:privy:mipase-owner', appId: 'app1' }) },
    })
    const res = await app.request('/v1/tenants/me', {
      headers: { Authorization: 'Bearer offline-token' },
    })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { id: string }
    expect(view.id).toBe('mi-pase')
  })
})
