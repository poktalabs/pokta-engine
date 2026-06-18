import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Per-tenant workflow ALLOW-LIST tests (PR2 T5, §6 ALLOW-LIST block). The registry
 * (`@pokta-engine/workflows`) stays PURE — it knows nothing about tenants — so the
 * allow-list is enforced in the engine-api control plane (`app.ts`): a workflow id
 * is dispatchable by a tenant iff it is BOTH in that tenant's `allowedWorkflows`
 * AND a live registry workflow. A disallowed/cross-tenant workflow is a 404
 * SKILL_NOT_FOUND (NOT 403) — anti-enumeration: a tenant must never be able to
 * discover that ANOTHER tenant's workflow exists.
 *
 * The security property under test: the allow-list gate sits RIGHT AFTER
 * getWorkflow, so a KNOWN-but-disallowed id (e.g. mi-pase POSTing vino's
 * 'call-intake') is indistinguishable at the boundary from a TRULY-unknown id.
 *
 * Mocking: @pokta-engine/db + @pokta-engine/queue + drizzle-orm are mocked
 * (db client throws without DATABASE_URL on import) per the canonical engine-api
 * pattern. We MOCK ./tenants (the registry) to seed two tenants with DISJOINT
 * allow-lists — both ACTIVE so resolveTenant succeeds and execution reaches the
 * allow-list gate (this isolates the allow-list DIMENSION from status gating,
 * which RESOLVE/TENANTS-ME tests own). We do NOT mock @pokta-engine/workflows —
 * the REAL manifests validate input and the REAL listManifests() backs the
 * allow-list ∩ live-registry intersection, so the filter is a genuine test.
 */

type Row = Record<string, unknown>
const state: { inserted: Row[] } = { inserted: [] }

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
    select: (proj?: unknown) => chain(proj ? [] : []),
    insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => [],
        insert: () => ({ values: async (v: Row) => { state.inserted.push(v) } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
    query: {
      engineRuns: { findFirst: async () => undefined },
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

/**
 * ./tenants registry: two ACTIVE tenants with DISJOINT allow-lists.
 *   - mi-pase → ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged']
 *   - vino    → ['call-intake', 'proposal-step', 'send-step']
 * Both ACTIVE so resolveTenant succeeds and the dispatch reaches the allow-list
 * gate. `allowedWorkflowsFor` / `manifestsForTenant` intersect with the LIVE
 * registry (not mocked), exactly as production does — so a gated child id present
 * in the allow-list (pricing-apply-*) still surfaces in the filtered list.
 */
const TENANTS: Record<string, { status: 'active' | 'pending' | 'disabled'; allowedWorkflows: string[] }> = {
  'mi-pase': {
    status: 'active',
    allowedWorkflows: ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged'],
  },
  vino: {
    status: 'active',
    allowedWorkflows: ['call-intake', 'proposal-step', 'send-step'],
  },
}

vi.mock('./tenants', async () => {
  // Pull the REAL listManifests through so allowedWorkflowsFor intersects with the
  // live registry (matches production tenants.ts behavior) — keeps the filter honest.
  const { listManifests } = await import('@pokta-engine/workflows')
  const live = () => new Set(listManifests().map((m) => m.id))
  return {
    getTenant: async (id: string) => {
      const t = TENANTS[id]
      return t ? { tenantId: id, name: id, status: t.status, allowedWorkflows: t.allowedWorkflows } : undefined
    },
    findTenantByMember: async () => undefined,
    isActive: (row: { status: string }) => row.status === 'active',
    allowedWorkflowsFor: (row: { allowedWorkflows: string[] }) =>
      row.allowedWorkflows.filter((wf) => live().has(wf)),
    toTenantView: (row: { tenantId: string }) => ({ id: row.tenantId }),
  }
})

const { buildApp } = await import('./app')

const MIPASE = { 'X-Service-Key': 'svc-key-mipase' }
const VINO = { 'X-Service-Key': 'svc-key-vino' }
const JSON_HDR = { 'Content-Type': 'application/json' }

beforeEach(() => {
  state.inserted = []
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,vino:svc-key-vino'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('ALLOW-LIST — dispatch gate (POST /v1/workflows/:id/runs)', () => {
  it("mi-pase POST 'pricing-draft' (in its allow-list) → 200 queued with a runId", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...MIPASE, ...JSON_HDR },
      body: JSON.stringify({ input: { scope: 'vinos', limit: 5 } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; status: string; traceId: string }
    expect(body.status).toBe('queued')
    expect(typeof body.runId).toBe('string')
    expect(body.runId.length).toBeGreaterThan(0)
    // the dispatched run is bound to mi-pase and is the requested workflow
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]?.consumerId).toBe('mi-pase')
    expect(state.inserted[0]?.workflowId).toBe('pricing-draft')
  })

  it("mi-pase POST 'call-intake' (vino's workflow, NOT in mi-pase's allow-list) → 404 SKILL_NOT_FOUND, never 403", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/call-intake/runs', {
      method: 'POST',
      headers: { ...MIPASE, ...JSON_HDR },
      body: JSON.stringify({ input: { transcript: 'hello there, a real transcript' } }),
    })
    // anti-enumeration: a real-but-disallowed workflow is indistinguishable from unknown
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
    // nothing was dispatched
    expect(state.inserted).toHaveLength(0)
    // the 404 must not leak that this is another tenant's workflow
    expect(JSON.stringify(body)).not.toContain('vino')
    expect(JSON.stringify(body)).not.toContain('allow')
  })

  it("vino POST 'pricing-draft' (mi-pase's workflow, NOT in vino's allow-list) → 404 SKILL_NOT_FOUND, never 403", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...VINO, ...JSON_HDR },
      body: JSON.stringify({ input: { scope: 'anything' } }),
    })
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
    expect(state.inserted).toHaveLength(0)
    expect(JSON.stringify(body)).not.toContain('mi-pase')
  })

  it("vino POST 'call-intake' (in its OWN allow-list) → 200 queued (positive control: allow-list isn't a blanket deny)", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/call-intake/runs', {
      method: 'POST',
      headers: { ...VINO, ...JSON_HDR },
      body: JSON.stringify({ input: { transcript: 'caller wants a kitchen remodel quote' } }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; runId: string }
    expect(body.status).toBe('queued')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]?.consumerId).toBe('vino')
    expect(state.inserted[0]?.workflowId).toBe('call-intake')
  })

  it("a TRULY-unknown workflow id → 404 SKILL_NOT_FOUND (same posture as disallowed: indistinguishable)", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/does-not-exist/runs', {
      method: 'POST',
      headers: { ...MIPASE, ...JSON_HDR },
      body: JSON.stringify({ input: {} }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
    expect(state.inserted).toHaveLength(0)
  })
})

describe('ALLOW-LIST — list surface (GET /v1/workflows) filtered per tenant', () => {
  it('mi-pase sees ONLY its own allow-listed workflows (no vino workflow leaks)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows', { headers: MIPASE })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { workflows: Array<{ id: string }> }
    const ids = body.workflows.map((w) => w.id).sort()
    expect(ids).toEqual(['pricing-apply-confident', 'pricing-apply-flagged', 'pricing-draft'])
    // none of vino's workflows appear in mi-pase's list
    expect(ids).not.toContain('call-intake')
    expect(ids).not.toContain('proposal-step')
    expect(ids).not.toContain('send-step')
    // and no workflow outside its allow-list leaks (e.g. echo)
    expect(ids).not.toContain('echo')
  })

  it('vino sees ONLY its own allow-listed workflows (no mi-pase workflow leaks)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows', { headers: VINO })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { workflows: Array<{ id: string }> }
    const ids = body.workflows.map((w) => w.id).sort()
    expect(ids).toEqual(['call-intake', 'proposal-step', 'send-step'])
    expect(ids).not.toContain('pricing-draft')
    expect(ids).not.toContain('pricing-apply-confident')
  })

  it('each tenant\'s list is a SUBSET of the live registry ∩ its allow-list (no phantom ids)', async () => {
    const { listManifests } = await import('@pokta-engine/workflows')
    const liveIds = new Set(listManifests().map((m) => m.id))
    const app = buildApp()
    for (const [hdr, tenant] of [[MIPASE, 'mi-pase'], [VINO, 'vino']] as const) {
      const res = await app.request('/v1/workflows', { headers: hdr })
      const body = (await res.json()) as { workflows: Array<{ id: string }> }
      for (const w of body.workflows) {
        // every surfaced id is both live AND in the tenant's allow-list
        expect(liveIds.has(w.id)).toBe(true)
        expect(TENANTS[tenant]?.allowedWorkflows).toContain(w.id)
      }
    }
  })
})
