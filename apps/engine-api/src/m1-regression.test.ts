import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * M1 regression guard (M1.5 / PR1). Proves the Mi Pase daily-pricing flow still
 * works end-to-end AT THE engine-api HTTP boundary AFTER the tenancy scoping
 * rails went in. This is the control-plane complement to the worker-side
 * `pricing-chain.integration.test.ts` (which exercises the real run() impls +
 * fan-out against a real Postgres): here we assert that a valid `mi-pase`
 * SERVICE KEY can still dispatch the `pricing-draft` workflow, list its own
 * runs, and read its own run by id — and that the dispatched run is bound to the
 * authenticated tenant (consumer_id taken from ctx, NEVER from the request body).
 *
 * Hermetic: @pokta-engine/db and @pokta-engine/queue are MOCKED so nothing
 * touches Postgres or pg-boss. We do NOT mock @pokta-engine/workflows — the real
 * `pricing-draft` manifest validates the input, so this also guards that the
 * pricing input contract still admits the M1 shape.
 */

// ── In-memory fakes captured per test ────────────────────────────────────────
type Row = Record<string, unknown>
const state: { runs: Row[]; inserted: Row[] } = { runs: [], inserted: [] }

vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

vi.mock('@pokta-engine/db', () => {
  const chain = (rows: Row[]) => ({
    from: () => ({
      innerJoin: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows.map((r) => ({ approval: r })) }) }) }),
      where: () => ({ orderBy: () => ({ limit: async () => rows }) }),
    }),
  })
  const db = {
    select: (proj?: unknown) => chain(proj ? [] : state.runs),
    insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    // dispatchRun runs inside a transaction; capture the forced row + quota I/O.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => [],
        insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
    query: {
      engineRuns: { findFirst: async () => state.runs[0] },
      engineApprovals: { findFirst: async () => undefined },
    },
  }
  return {
    db,
    schema: {
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', status: 'status', createdAt: 'created_at' },
      engineApprovals: { approvalId: 'approval_id', sourceRunId: 'source_run_id', state: 'state', approver: 'approver', createdAt: 'created_at' },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => x,
  sql: Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) }),
}))

// ── ./tenants registry: mi-pase + other ACTIVE, pricing-draft allow-listed ───
// resolveTenant (PR2) is registry-backed, so the dispatch path now consults the
// tenant registry + per-tenant allow-list. We mock the registry so the M1 flow
// (mi-pase dispatching pricing-draft) keeps resolving without a real DB. This
// does NOT weaken any assertion — the consumer_id binding / body-mismatch / 401
// guards below still hold; we only supply the tenant row resolveTenant now needs.
const TENANTS: Record<string, { status: 'active' | 'pending' | 'disabled'; allowedWorkflows: string[] }> = {
  'mi-pase': { status: 'active', allowedWorkflows: ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged'] },
  other: { status: 'active', allowedWorkflows: ['pricing-draft'] },
}
vi.mock('./tenants', () => ({
  getTenant: async (id: string) => {
    const t = TENANTS[id]
    return t ? { tenantId: id, name: id, status: t.status, allowedWorkflows: t.allowedWorkflows } : undefined
  },
  findTenantByMember: async () => undefined,
  isActive: (row: { status: string }) => row.status === 'active',
  allowedWorkflowsFor: (row: { allowedWorkflows: string[] }) => row.allowedWorkflows,
  toTenantView: (row: { tenantId: string; allowedWorkflows: string[] }) => ({ id: row.tenantId }),
}))

const { buildApp } = await import('./app')
// The REAL workflow registry (NOT mocked) — used below to prove the mi-pase
// allow-list the registry swap now consults actually contains the live M1 ids,
// so the T5 allow-list gate is a no-op for the M1 chain rather than a silent
// blocker. If a future rename drifts the manifest ids away from the seeded
// allow-list, this assertion fails loudly instead of the chain 404-ing.
const { listManifests } = await import('@pokta-engine/workflows')

const MIPASE_KEY = { 'X-Service-Key': 'svc-key-mipase' }

beforeEach(() => {
  state.runs = []
  state.inserted = []
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,other:svc-key-other'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('M1 regression — mi-pase pricing flow at the engine-api boundary (post-scoping)', () => {
  it('mi-pase can dispatch a pricing-draft run → 200 queued with a runId', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...MIPASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { scope: 'vinos', limit: 10 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; status: string; traceId: string }
    expect(body.status).toBe('queued')
    expect(typeof body.runId).toBe('string')
    expect(body.runId.length).toBeGreaterThan(0)
    expect(typeof body.traceId).toBe('string')
  })

  it('binds the dispatched run to the authenticated tenant (consumer_id from ctx, not body)', async () => {
    const app = buildApp()
    // A hostile body claims a DIFFERENT tenant inside the pricing input; the
    // forced consumerId on the inserted run must still be mi-pase, never "other".
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...MIPASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { consumerId: 'other', scope: 'vinos' } }),
    })
    expect(res.status).toBe(200)
    // exactly one run row was inserted, scoped to mi-pase regardless of the body.
    expect(state.inserted).toHaveLength(1)
    const inserted = state.inserted[0] as Row
    expect(inserted.consumerId).toBe('mi-pase')
    expect(inserted.workflowId).toBe('pricing-draft')
    expect(inserted.status).toBe('queued')
  })

  it('rejects a body.consumer_id that mismatches the authenticated tenant → 400 ARGS_INVALID', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...MIPASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ consumer_id: 'other', input: {} }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ARGS_INVALID')
    // and nothing was dispatched
    expect(state.inserted).toHaveLength(0)
  })

  it('mi-pase can list its own runs → 200 with the runs array', async () => {
    state.runs = [
      { runId: 'run-pricing-1', workflowId: 'pricing-draft', consumerId: 'mi-pase', status: 'queued' },
      { runId: 'run-pricing-2', workflowId: 'pricing-draft', consumerId: 'mi-pase', status: 'succeeded' },
    ]
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: MIPASE_KEY })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: Array<{ runId: string; consumerId: string }> }
    expect(body.runs).toHaveLength(2)
    expect(body.runs.map((r) => r.runId)).toEqual(['run-pricing-1', 'run-pricing-2'])
    // every returned row belongs to the authenticated tenant
    expect(body.runs.every((r) => r.consumerId === 'mi-pase')).toBe(true)
  })

  it('mi-pase can read its own pricing run by id → 200 with the run row', async () => {
    // getRun resolves through query.engineRuns.findFirst (scoped to consumerId).
    state.runs = [{ runId: 'run-pricing-1', workflowId: 'pricing-draft', consumerId: 'mi-pase', status: 'queued' }]
    const app = buildApp()
    const res = await app.request('/v1/runs/run-pricing-1', { headers: MIPASE_KEY })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; workflowId: string; consumerId: string }
    expect(body.runId).toBe('run-pricing-1')
    expect(body.workflowId).toBe('pricing-draft')
    expect(body.consumerId).toBe('mi-pase')
  })

  it('still refuses the pricing flow without a credential → 401 UNAUTHENTICATED (auth not bypassable)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })
})

/**
 * Allow-list non-regression (PR2 / T5). After resolveTenant became registry-backed
 * and the dispatch POST grew a per-tenant allow-list gate (right after getWorkflow),
 * the WHOLE M1 chain must remain reachable for mi-pase. The three M1 workflow ids
 * MUST be in mi-pase's `allowedWorkflows`, and they must all be LIVE registry ids,
 * or the gate would silently turn the M1 chain into a 404 — the exact regression
 * this block guards. (pricing-apply-* are child-only gated targets, so we assert
 * the gate ADMITS them via the allow-list; a direct POST is separately refused by
 * the gated-target check, not by the allow-list — see the explicit case below.)
 */
describe('M1 allow-list non-regression — the M1 ids stay dispatchable for mi-pase', () => {
  const M1_WORKFLOW_IDS = ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged'] as const

  it('mi-pase allowedWorkflows (registry mock) contains every live M1 workflow id', () => {
    const mipase = TENANTS['mi-pase']
    expect(mipase).toBeDefined()
    expect(mipase!.status).toBe('active')
    for (const id of M1_WORKFLOW_IDS) {
      // in the tenant's allow-list …
      expect(mipase!.allowedWorkflows).toContain(id)
      // … AND a real, live registry workflow (so the gate's registry-∩ keeps it).
      expect(listManifests().some((m) => m.id === id)).toBe(true)
    }
  })

  it('the allow-list gate does NOT block pricing-draft for mi-pase (200 queued, not 404)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...MIPASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { scope: 'vinos', limit: 5 } }),
    })
    // If the allow-list gate (or resolveTenant→registry) had regressed, the
    // post-getWorkflow gate would 404 here instead of dispatching.
    expect(res.status).toBe(200)
    expect(res.status).not.toBe(404)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('queued')
    // exactly one run row written, scoped to mi-pase — the chain head dispatched.
    expect(state.inserted).toHaveLength(1)
    expect((state.inserted[0] as Row).consumerId).toBe('mi-pase')
  })

  it('a workflow NOT in mi-pase allow-list (vino-only) → 404 SKILL_NOT_FOUND, nothing dispatched', async () => {
    // 'call-intake' is a vino workflow id; it is NOT in mi-pase's allow-list. The
    // gate must 404 (anti-enumeration) and dispatch nothing — proving the gate is
    // really consulting the allow-list, so the M1 non-block above is meaningful.
    const app = buildApp()
    const res = await app.request('/v1/workflows/call-intake/runs', {
      method: 'POST',
      headers: { ...MIPASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
    expect(state.inserted).toHaveLength(0)
  })
})
