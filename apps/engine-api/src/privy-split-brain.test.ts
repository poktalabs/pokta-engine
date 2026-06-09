import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * PRIVY SPLIT-BRAIN regression (PR2 harden / isolation-panel findings 1-3).
 *
 * For a Privy principal the membership model (`engine_tenants.members[]`,
 * resolved by `resolveTenant` → `findTenantByMember`) is the SOLE authority for
 * BOTH authorization AND data-plane scoping. The legacy `PRIVY_TENANT_MAP` env
 * (which only sets `consumer.id` in auth.ts) must NEVER be the scope key:
 * trusting it let the allow-list gate (keyed off the resolved tenant) and the
 * actual run write (keyed off the env map) target DIFFERENT tenants — a
 * confused-deputy hole. These tests pin the fix:
 *
 *   - members[]→A while PRIVY_TENANT_MAP→B (DISAGREE): dispatch + reads must NOT
 *     act as B. The fix FAILS CLOSED (TENANT_UNKNOWN) on a non-empty consumer.id
 *     that disagrees with the resolved tenant — never a write under B.
 *   - members[]→A while PRIVY_TENANT_MAP is UNSET (consumer.id=''): the run is
 *     written under the members-resolved tenant A — NEVER under '' (an unowned
 *     namespace), and A's own GET /v1/runs is scoped to A and sees it.
 *
 * Mock posture mirrors tenants-me.test.ts: the db mock serves the registry's two
 * reads (getTenant by PK, findTenantByMember by members[]) AND captures inserted
 * runs so the scope key on a dispatched run is observable. We import the REAL
 * ./tenants + workflows + scoped-db so resolveTenant/forConsumer run for real.
 */

type Row = Record<string, unknown>
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

const store: { tenants: TenantRow[]; runs: Row[]; inserted: Row[] } = { tenants: [], runs: [], inserted: [] }

const MIPASE_WORKFLOWS = ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged']

function tenant(overrides: Partial<TenantRow>): TenantRow {
  return {
    tenantId: 'mi-pase',
    name: 'Mi Pase',
    status: 'active',
    currency: 'MXN',
    locale: 'es-MX',
    branding: { name: 'Mi Pase' },
    allowedWorkflows: MIPASE_WORKFLOWS,
    members: [],
    secretPrefix: 'MIPASE',
    ...overrides,
  }
}

vi.mock('@godin-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

vi.mock('@godin-engine/db', () => {
  // getTenant(id): query.engineTenants.findFirst({ where: eq(tenant_id, id) })
  const findFirst = async ({ where }: { where: { eq?: [string, string] } }) => {
    const wantId = where?.eq?.[0] === 'tenant_id' ? where.eq[1] : undefined
    return store.tenants.find((t) => t.tenantId === wantId)
  }
  // Dig the consumer_id out of an `and(eq(consumer_id, id), ...)` predicate tree
  // (the drizzle mock wraps `and` as { and: [...] }, `eq` as { eq: [col, val] }).
  const consumerFrom = (pred: unknown): string | undefined => {
    if (!pred || typeof pred !== 'object') return undefined
    const p = pred as { and?: unknown[]; eq?: [string, string] }
    if (Array.isArray(p.and)) {
      for (const c of p.and) { const f = consumerFrom(c); if (f !== undefined) return f }
      return undefined
    }
    return Array.isArray(p.eq) && p.eq[0] === 'consumer_id' ? p.eq[1] : undefined
  }
  // listRuns(consumerId): select().from(R).where(and(eq(consumer_id,id),...)).orderBy().limit()
  // findTenantByMember(did): select().from(T).where(sql{member}).limit(2)
  const select = (_proj?: unknown) => ({
    from: () => ({
      innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
      where: (pred: { member?: string }) => ({
        orderBy: () => ({
          limit: async () => {
            const want = consumerFrom(pred)
            return store.runs.filter((r) => want === undefined || r.consumerId === want)
          },
        }),
        limit: async (_n: number) =>
          store.tenants.filter((t) => pred?.member != null && t.members.includes(pred.member)),
      }),
    }),
  })
  const db = {
    select,
    insert: () => ({ values: async (v: Row) => { store.inserted.push(v) } }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => [],
        insert: () => ({ values: async (v: Row) => { store.inserted.push(v) } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
    query: {
      engineRuns: { findFirst: async () => undefined },
      engineApprovals: { findFirst: async () => undefined },
      engineTenants: { findFirst },
    },
  }
  return {
    db,
    schema: {
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', status: 'status', createdAt: 'created_at' },
      engineApprovals: { approvalId: 'approval_id', sourceRunId: 'source_run_id', state: 'state', approver: 'approver', createdAt: 'created_at' },
      engineTenants: { tenantId: 'tenant_id', members: 'members' },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => x,
  sql: Object.assign((_s: TemplateStringsArray, ...vals: unknown[]) => {
    const did = vals.find((v) => typeof v === 'string' && v !== 'members') as string | undefined
    return { member: did }
  }, { raw: () => ({}) }),
}))

const { buildApp } = await import('./app')
const { __resetTenantCache } = await import('./tenants')

const JSON_HDR = { 'Content-Type': 'application/json' }
const DID = 'did:privy:owner'

function privyApp() {
  return buildApp({ auth: { verifyPrivyToken: async () => ({ userId: DID, appId: 'app1' }) } })
}

beforeEach(() => {
  store.tenants = []
  store.runs = []
  store.inserted = []
  __resetTenantCache()
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('PRIVY split-brain — members[] is the scope authority, not PRIVY_TENANT_MAP', () => {
  it('PRIVY_TENANT_MAP UNSET (consumer.id=\'\'): dispatch is written under the members-resolved tenant, NEVER \'\'', async () => {
    // mi-pase is active and the DID is its member; no PRIVY_TENANT_MAP → consumer.id=''.
    store.tenants = [tenant({ members: [DID] })]
    const app = privyApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer offline', ...JSON_HDR },
      body: JSON.stringify({ input: { scope: 'vinos', limit: 5 } }),
    })
    expect(res.status).toBe(200)
    expect(store.inserted).toHaveLength(1)
    // The run is scoped to the membership-resolved tenant, NOT the empty-string id.
    expect(store.inserted[0]?.consumerId).toBe('mi-pase')
    expect(store.inserted[0]?.consumerId).not.toBe('')
  })

  it('PRIVY_TENANT_MAP UNSET: the same principal\'s GET /v1/runs is scoped to the resolved tenant and sees its run', async () => {
    store.tenants = [tenant({ members: [DID] })]
    store.runs = [
      { runId: 'r-mp', consumerId: 'mi-pase', status: 'queued', input: {}, traceId: 't', createdAt: new Date() },
      { runId: 'r-empty', consumerId: '', status: 'queued', input: {}, traceId: 't', createdAt: new Date() },
    ]
    const app = privyApp()
    const res = await app.request('/v1/runs', { headers: { Authorization: 'Bearer offline' } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: Array<{ runId: string; consumerId: string }> }
    const ids = body.runs.map((r) => r.runId)
    expect(ids).toContain('r-mp')
    // A run mistakenly written under the empty-string scope is NOT this tenant's.
    expect(ids).not.toContain('r-empty')
    expect(body.runs.every((r) => r.consumerId === 'mi-pase')).toBe(true)
  })

  it('DISAGREEMENT (members[]→mi-pase, PRIVY_TENANT_MAP→other): dispatch FAILS CLOSED, never writes as other', async () => {
    // The DID is mi-pase's member, but the legacy env maps it to a different tenant.
    process.env.PRIVY_TENANT_MAP = `${DID}=other`
    store.tenants = [tenant({ members: [DID] })]
    const app = privyApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer offline', ...JSON_HDR },
      body: JSON.stringify({ input: { scope: 'vinos', limit: 5 } }),
    })
    // consumer.id='other' (from the env) disagrees with the resolved tenant
    // 'mi-pase' → confused-deputy guard fails closed. NOTHING is dispatched, and
    // certainly nothing under 'other'.
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
    expect(store.inserted).toHaveLength(0)
  })

  it('DISAGREEMENT: GET /v1/runs also fails closed (no read scoped to the env-map tenant)', async () => {
    process.env.PRIVY_TENANT_MAP = `${DID}=other`
    store.tenants = [tenant({ members: [DID] })]
    store.runs = [{ runId: 'r-other', consumerId: 'other', status: 'queued', input: {}, traceId: 't', createdAt: new Date() }]
    const app = privyApp()
    const res = await app.request('/v1/runs', { headers: { Authorization: 'Bearer offline' } })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })

  it('AGREEMENT (members[]→mi-pase, PRIVY_TENANT_MAP→mi-pase): dispatch proceeds, bound to mi-pase', async () => {
    // Positive control: when the two sources happen to agree, the run dispatches.
    process.env.PRIVY_TENANT_MAP = `${DID}=mi-pase`
    store.tenants = [tenant({ members: [DID] })]
    const app = privyApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer offline', ...JSON_HDR },
      body: JSON.stringify({ input: { scope: 'vinos', limit: 5 } }),
    })
    expect(res.status).toBe(200)
    expect(store.inserted).toHaveLength(1)
    expect(store.inserted[0]?.consumerId).toBe('mi-pase')
  })

  it('body.consumer_id is checked against the RESOLVED tenant, not the env-map consumer.id', async () => {
    // members[]→mi-pase, env unset (consumer.id=''). A body claiming the resolved
    // tenant is fine; a body claiming anything else is a 400 — the guard keys off
    // the resolved tenant id, so it can't be fooled by the '' consumer.id.
    store.tenants = [tenant({ members: [DID] })]
    const app = privyApp()
    const ok = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer offline', ...JSON_HDR },
      body: JSON.stringify({ consumer_id: 'mi-pase', input: { scope: 'vinos', limit: 5 } }),
    })
    expect(ok.status).toBe(200)
    expect(store.inserted).toHaveLength(1)
    expect(store.inserted[0]?.consumerId).toBe('mi-pase')

    store.inserted = []
    const bad = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { Authorization: 'Bearer offline', ...JSON_HDR },
      body: JSON.stringify({ consumer_id: 'other', input: { scope: 'vinos', limit: 5 } }),
    })
    expect(bad.status).toBe(400)
    const body = (await bad.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ARGS_INVALID')
    expect(store.inserted).toHaveLength(0)
  })
})
