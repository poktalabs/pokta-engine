import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * GET /v1/integrations endpoint tests (P5b). Hermetic: we MOCK @pokta-engine/db
 * and @pokta-engine/queue so nothing touches Postgres or pg-boss, and the route's
 * auth is the in-process service-key path (no Privy verifier needed). The fake db
 * is PREDICATE-AWARE for the engine_tenant_integrations read: forConsumer(db, id)
 * issues `db.select().from(I).where(eq(I.tenantId, id))`, so the mock filters its
 * `state.integrations` array by the tenant id carried in that predicate. That is
 * what makes the cross-tenant ISOLATION case a real test (a dropped tenant_id
 * predicate would leak the other tenant's rows) rather than a tautology.
 *
 * The route enriches each stored row with the LIVE integration registry descriptor
 * (displayName/category) via getIntegration(row.integrationId) — we do NOT mock
 * @pokta-engine/integrations, so the real registry (notion/resend/shopify/
 * mercado-libre) drives the enrichment, exactly as in prod. A stored row whose
 * integration_id is not in the live registry is SKIPPED (defensive). No secret is
 * ever returned: we assert the serialized body contains NONE of the registry
 * secretKeys NAMES and none of the env secret VALUES we plant.
 */

type Row = Record<string, unknown>

// In-memory fake db state. `integrations` is the engine_tenant_integrations table
// (multi-tenant — seeded with BOTH the authed tenant's rows and a cross-tenant row
// the predicate-aware mock must filter out). `runs`/`approvals`/`inserted` are
// carried only to keep the shared select/insert chain shape identical to app.test.ts.
const state: { runs: Row[]; approvals: Row[]; inserted: Row[]; integrations: Row[] } = {
  runs: [],
  approvals: [],
  inserted: [],
  integrations: [],
}

/** Pull the tenant_id asserted by `eq(I.tenantId, x)` from the drizzle-mock predicate. */
function tenantFromPredicate(pred: unknown): string | undefined {
  if (!pred || typeof pred !== 'object') return undefined
  const p = pred as { and?: unknown[]; eq?: [unknown, unknown] }
  if (Array.isArray(p.and)) {
    for (const clause of p.and) {
      const found = tenantFromPredicate(clause)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (Array.isArray(p.eq) && p.eq[0] === 'integration:tenant_id') return p.eq[1] as string
  return undefined
}

vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

// Both spine tenants are ACTIVE so service-mode resolveTenant succeeds and the
// route scopes to the resolved tenant id (== the service-key consumer id).
const REGISTRY: Row[] = [
  { tenantId: 'mi-pase', name: 'Mi Pase', status: 'active', currency: 'MXN', locale: 'es-MX', branding: {}, allowedWorkflows: [], members: ['did:privy:abc'], secretPrefix: 'MIPASE' },
  { tenantId: 'other', name: 'Other', status: 'active', currency: 'USD', locale: 'en', branding: {}, allowedWorkflows: [], members: [], secretPrefix: 'OTHER' },
]

vi.mock('@pokta-engine/db', () => {
  // The engine_tenant_integrations read is `select().from(I).where(eq(I.tenantId,id))`
  // and is AWAITED directly (no orderBy/limit). The runs read is
  // `select().from(R).where(pred).orderBy().limit()`. We return one object from
  // `.where()` that is BOTH awaitable (resolves to the integration rows filtered by
  // the tenant predicate) AND carries `.orderBy().limit()` (runs list). Which table
  // was queried is disambiguated by the predicate: the integrations read carries an
  // `integration:tenant_id` eq; the runs read carries a `consumer_id` eq.
  const fromChain = {
    innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.approvals.map((r) => ({ approval: r })) }) }) }),
    where: (pred: unknown) => {
      const wantTenant = tenantFromPredicate(pred)
      const integrationRows =
        wantTenant === undefined
          ? state.integrations
          : state.integrations.filter((r) => r.tenantId === wantTenant)
      // Thenable so `await db.select().from(I).where(...)` resolves to the rows,
      // while `.orderBy().limit()` still serves the runs-list path.
      return {
        then: (resolve: (rows: Row[]) => unknown) => resolve(integrationRows),
        orderBy: () => ({ limit: async () => state.runs }),
        limit: async (_n: number) =>
          REGISTRY.filter((t) => {
            const p = pred as { member?: string }
            return p?.member != null && (t.members as string[]).includes(p.member)
          }),
      }
    },
  }
  const db = {
    select: (proj?: unknown) =>
      proj
        ? { from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => state.approvals.map((r) => ({ approval: r })) }) }) }) }) }
        : { from: () => fromChain },
    insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => [],
        insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
    query: {
      engineRuns: { findFirst: async () => state.runs[0] },
      engineApprovals: { findFirst: async () => state.approvals[0] },
      engineTenants: {
        findFirst: async ({ where }: { where: { eq?: [string, string] } }) => {
          const wantId = where?.eq?.[0] === 'tenant_id' ? where.eq[1] : undefined
          return REGISTRY.find((t) => t.tenantId === wantId)
        },
      },
    },
  }
  return {
    db,
    schema: {
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', status: 'status', createdAt: 'created_at' },
      engineApprovals: { approvalId: 'approval_id', sourceRunId: 'source_run_id', state: 'state', approver: 'approver', createdAt: 'created_at' },
      engineTenants: { tenantId: 'tenant_id', members: 'members' },
      engineTenantIntegrations: { tenantId: 'integration:tenant_id', integrationId: 'integration:integration_id', status: 'integration:status' },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => x,
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  sql: Object.assign((_s: TemplateStringsArray, ...vals: unknown[]) => {
    const did = vals.find((v) => typeof v === 'string' && v !== 'members') as string | undefined
    return { member: did }
  }, { raw: () => ({}) }),
}))

const { buildApp } = await import('./app')
const { __resetTenantCache } = await import('./tenants')

const MIPASE_HEADER = { 'X-Service-Key': 'svc-key-mipase' }

beforeEach(() => {
  state.runs = []
  state.approvals = []
  state.inserted = []
  state.integrations = []
  __resetTenantCache()
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,other:svc-key-other'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

// Every registry secretKey name, across all live integrations — none of these
// strings (and none of their PLANTED env VALUES) may appear in any response body.
const ALL_SECRET_KEY_NAMES = [
  'NOTION_API_KEY', 'NOTION_CRM_DB_ID',
  'RESEND_API_KEY', 'RESEND_FROM', 'RESEND_TO',
  'SHOPIFY_BASE_URL', 'SHOPIFY_ACCESS_TOKEN',
  'ML_ACCESS_TOKEN', 'ML_REFRESH_TOKEN', 'ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REDIRECT_URI',
]

describe('GET /v1/integrations — auth', () => {
  it('401 with no credential', async () => {
    const app = buildApp()
    const res = await app.request('/v1/integrations')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('401 with an invalid service key', async () => {
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: { 'X-Service-Key': 'nope' } })
    expect(res.status).toBe(401)
  })
})

describe('GET /v1/integrations — this tenant only, enriched + honest', () => {
  it("returns ONLY the authed tenant's rows, enriched with the live registry descriptor", async () => {
    state.integrations = [
      { tenantId: 'mi-pase', integrationId: 'shopify', status: 'enabled', connectedAt: new Date('2026-06-01T00:00:00Z') },
      { tenantId: 'mi-pase', integrationId: 'mercado-libre', status: 'pending', connectedAt: null },
      { tenantId: 'mi-pase', integrationId: 'resend', status: 'disabled', connectedAt: null },
    ]
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: MIPASE_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { integrations: Array<Record<string, unknown>> }

    const byId = Object.fromEntries(body.integrations.map((i) => [i.id as string, i]))
    expect(Object.keys(byId).sort()).toEqual(['mercado-libre', 'resend', 'shopify'])

    // displayName/category come from the LIVE registry descriptor (not the stored row).
    expect(byId['shopify']).toMatchObject({ displayName: 'Shopify Admin', category: 'commerce', status: 'enabled' })
    expect(byId['mercado-libre']).toMatchObject({ displayName: 'Mercado Libre MX', category: 'marketplace', status: 'pending' })
    expect(byId['resend']).toMatchObject({ displayName: 'Resend Email', category: 'email', status: 'disabled' })

    // Honest status passthrough — each enabled|pending|disabled is rendered as stored.
    const statuses = body.integrations.map((i) => i.status).sort()
    expect(statuses).toEqual(['disabled', 'enabled', 'pending'])
  })

  it('each row is EXACTLY { id, displayName, category, status } (+ optional detail) — no extra keys', async () => {
    state.integrations = [
      { tenantId: 'mi-pase', integrationId: 'notion', status: 'enabled', connectedAt: new Date('2026-06-01T00:00:00Z'), createdAt: new Date(), updatedAt: new Date() },
    ]
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: MIPASE_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { integrations: Array<Record<string, unknown>> }
    expect(body.integrations).toHaveLength(1)
    const row = body.integrations[0] as Record<string, unknown>
    // Shape is exactly the IntegrationStatus contract — no stored connectedAt /
    // createdAt / updatedAt / secret_ref leaks through.
    const keys = Object.keys(row).sort()
    expect(keys.filter((k) => k !== 'detail')).toEqual(['category', 'displayName', 'id', 'status'])
    expect(keys).not.toContain('connectedAt')
    expect(keys).not.toContain('createdAt')
    expect(keys).not.toContain('updatedAt')
    expect(keys).not.toContain('tenantId')
  })

  it('skips a stored row whose integration_id is not in the live registry (defensive)', async () => {
    state.integrations = [
      { tenantId: 'mi-pase', integrationId: 'shopify', status: 'enabled', connectedAt: null },
      { tenantId: 'mi-pase', integrationId: 'coppel', status: 'enabled', connectedAt: null }, // not a live integration
    ]
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: MIPASE_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { integrations: Array<{ id: string }> }
    expect(body.integrations.map((i) => i.id)).toEqual(['shopify'])
    expect(JSON.stringify(body)).not.toContain('coppel')
  })
})

describe('GET /v1/integrations — cross-tenant isolation (ISOLATION ★)', () => {
  it("excludes another tenant's rows even when they share the table", async () => {
    state.integrations = [
      { tenantId: 'mi-pase', integrationId: 'shopify', status: 'enabled', connectedAt: null },
      { tenantId: 'other', integrationId: 'mercado-libre', status: 'enabled', connectedAt: null }, // B's row
    ]
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: MIPASE_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { integrations: Array<{ id: string }> }
    // A sees ONLY its own shopify row; B's mercado-libre row never leaks.
    expect(body.integrations.map((i) => i.id)).toEqual(['shopify'])
    expect(body.integrations.map((i) => i.id)).not.toContain('mercado-libre')
    expect(JSON.stringify(body)).not.toContain('other')
  })

  it("when ONLY another tenant's rows exist → empty list (no leak)", async () => {
    state.integrations = [
      { tenantId: 'other', integrationId: 'shopify', status: 'enabled', connectedAt: null },
    ]
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: MIPASE_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { integrations: unknown[] }
    expect(body.integrations).toEqual([])
  })
})

describe('GET /v1/integrations — empty + no-secret-leak', () => {
  it('a tenant with no rows → { integrations: [] } (empty, honest)', async () => {
    state.integrations = []
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: MIPASE_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { integrations: unknown[] }
    expect(body).toEqual({ integrations: [] })
  })

  it('NO secret VALUE and NO secretKey NAME appears anywhere in the response body', async () => {
    // Plant a secret VALUE in the env for EVERY secretKey of every live integration;
    // the endpoint must never read/echo these. We seed connection rows for all four
    // live integrations so the enrichment path runs for each.
    const SENTINEL = 'SUPER_SECRET_VALUE_ZZZ'
    for (const name of ALL_SECRET_KEY_NAMES) process.env[name] = `${SENTINEL}-${name}`

    state.integrations = [
      { tenantId: 'mi-pase', integrationId: 'notion', status: 'enabled', connectedAt: null },
      { tenantId: 'mi-pase', integrationId: 'resend', status: 'enabled', connectedAt: null },
      { tenantId: 'mi-pase', integrationId: 'shopify', status: 'pending', connectedAt: null },
      { tenantId: 'mi-pase', integrationId: 'mercado-libre', status: 'disabled', connectedAt: null },
    ]
    const app = buildApp()
    const res = await app.request('/v1/integrations', { headers: MIPASE_HEADER })
    expect(res.status).toBe(200)
    const raw = await res.text()

    // (a) No planted env secret VALUE leaks.
    expect(raw).not.toContain(SENTINEL)
    // (b) No secretKey NAME (the env var key itself) leaks either.
    for (const name of ALL_SECRET_KEY_NAMES) {
      expect(raw).not.toContain(name)
    }

    // Sanity: the four enriched rows ARE present (so the no-leak assertion is over a
    // real, non-empty payload, not an accidentally-empty one).
    const body = JSON.parse(raw) as { integrations: Array<{ id: string }> }
    expect(body.integrations.map((i) => i.id).sort()).toEqual(['mercado-libre', 'notion', 'resend', 'shopify'])

    for (const name of ALL_SECRET_KEY_NAMES) delete process.env[name]
  })
})
