import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * GET /v1/workflows/:id/runs (P5b) — the per-FAMILY run history surface for the
 * operator workspace. Hermetic, modeled on app.test.ts / isolation.test.ts: we
 * MOCK @godin-engine/db (predicate-aware, so the consumer_id + workflowId family
 * filter is REALLY exercised, not tautological) and @godin-engine/queue, and we
 * mock ./tenants so two service-key tenants (A=mi-pase, B=other) are both active
 * with DISJOINT allow-lists. No Postgres.
 *
 * The route flow under test (app.ts): resolveTenant → confused-deputy guard →
 * allowedForTenant(:id) [404 anti-enumeration if not allow-listed] →
 * familyMemberIds(:id) → scoped.listRunsForWorkflows(members) → optional ?status=
 * filter → `{ runs }` envelope. We assert:
 *   (1) an allow-listed PARENT id (pricing-draft) returns the family's scoped run
 *       history — only THIS tenant's runs, across the parent + gated children;
 *   (2) an id OUTSIDE the tenant's allow-list → 404 SKILL_NOT_FOUND (never 403);
 *   (3) cross-tenant runs never appear (ISOLATION ★);
 *   (4) no credential → 401.
 */

type Row = Record<string, unknown>

// Pricing "Daily Pricing" family (catalog parent + gated children).
const A = 'mi-pase'
const B = 'other'

// A-owned runs across the family (parent + both children) + one unrelated A run.
const A_PARENT: Row = mkRun('run-A-parent', 'pricing-draft', A, '2026-06-05T10:00:00Z')
const A_CONFIDENT: Row = mkRun('run-A-confident', 'pricing-apply-confident', A, '2026-06-05T10:01:00Z')
const A_FLAGGED: Row = mkRun('run-A-flagged', 'pricing-apply-flagged', A, '2026-06-05T10:02:00Z')
const A_OTHER_WF: Row = mkRun('run-A-other-wf', 'call-intake', A, '2026-06-05T09:00:00Z')
// B-owned run in the SAME family — A must never see it (isolation).
const B_PARENT: Row = mkRun('run-B-parent', 'pricing-draft', B, '2026-06-05T10:00:00Z')

function mkRun(runId: string, workflowId: string, consumerId: string, iso: string): Row {
  return {
    runId,
    workflowId,
    consumerId,
    status: 'queued',
    input: {},
    output: null,
    error: null,
    traceId: `t-${runId}`,
    idempotencyKey: null,
    parentRunId: null,
    createdAt: new Date(iso),
    startedAt: null,
    finishedAt: null,
  }
}

const store: { runs: Row[] } = { runs: [] }

// ── Predicate extraction (same shape as isolation.test.ts) ───────────────────
function consumerFromPredicate(pred: unknown): string | undefined {
  if (!pred || typeof pred !== 'object') return undefined
  const p = pred as { and?: unknown[]; eq?: [unknown, unknown] }
  if (Array.isArray(p.and)) {
    for (const clause of p.and) {
      const found = consumerFromPredicate(clause)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (Array.isArray(p.eq) && p.eq[0] === 'consumer_id') return p.eq[1] as string
  return undefined
}
function workflowIdsFromPredicate(pred: unknown): string[] | undefined {
  if (!pred || typeof pred !== 'object') return undefined
  const p = pred as { and?: unknown[]; inArray?: [unknown, unknown[]] }
  if (Array.isArray(p.and)) {
    for (const clause of p.and) {
      const found = workflowIdsFromPredicate(clause)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (Array.isArray(p.inArray) && p.inArray[0] === 'workflow_id') return p.inArray[1] as string[]
  return undefined
}

vi.mock('@godin-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

vi.mock('@godin-engine/db', () => {
  // listRunsForWorkflows → select().from(R).where(and(eq(consumer_id), inArray(workflow_id, ids)))
  //   .orderBy().limit(). Filter by BOTH the consumer_id predicate AND the family ids.
  const runsChain = {
    from: () => ({
      where: (pred: unknown) => {
        const consumer = consumerFromPredicate(pred)
        const wfIds = workflowIdsFromPredicate(pred)
        const rows = store.runs.filter(
          (r) =>
            (consumer === undefined || r.consumerId === consumer) &&
            (wfIds === undefined || wfIds.includes(r.workflowId as string)),
        )
        return { orderBy: () => ({ limit: async () => rows }) }
      },
    }),
  }
  const db = {
    select: () => runsChain,
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => [],
        insert: () => ({ values: async () => undefined }),
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
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', workflowId: 'workflow_id', status: 'status', createdAt: 'created_at' },
      engineApprovals: { approvalId: 'approval_id', sourceRunId: 'source_run_id', state: 'state', approver: 'approver', createdAt: 'created_at' },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  inArray: (a: unknown, b: unknown[]) => ({ inArray: [a, b] }),
  desc: (x: unknown) => x,
  sql: Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) }),
}))

// ── ./tenants registry mock — A and B both active, DISJOINT allow-lists ───────
// A=mi-pase is allow-listed for the Daily Pricing parent (pricing-draft); B=other
// is allow-listed for a different workflow. This lets us prove (a) A sees its own
// family runs, (b) A cannot enumerate B's workflow (call-intake → 404), and the
// route never widens access.
const TENANTS: Record<string, { status: 'active' | 'pending' | 'disabled'; allowedWorkflows: string[] }> = {
  'mi-pase': { status: 'active', allowedWorkflows: ['pricing-draft'] },
  other: { status: 'active', allowedWorkflows: ['call-intake'] },
}
vi.mock('./tenants', () => ({
  getTenant: async (id: string) => {
    const t = TENANTS[id]
    return t ? { tenantId: id, name: id, status: t.status, allowedWorkflows: t.allowedWorkflows } : undefined
  },
  findTenantByMember: async () => undefined,
  isActive: (row: { status: string }) => row.status === 'active',
  allowedWorkflowsFor: (row: { allowedWorkflows: string[] }) => row.allowedWorkflows,
  toTenantView: (row: { tenantId: string }) => ({ id: row.tenantId }),
}))

const { buildApp } = await import('./app')

const A_HEADER = { 'X-Service-Key': 'svc-key-mipase' }

beforeEach(() => {
  store.runs = []
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,other:svc-key-other'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('GET /v1/workflows/:id/runs — family run history (P5b)', () => {
  it("(1) allow-listed parent (pricing-draft) → THIS tenant's FAMILY run history (parent + gated children)", async () => {
    store.runs = [A_PARENT, A_CONFIDENT, A_FLAGGED, A_OTHER_WF]
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: Array<{ runId: string; workflowId: string; consumerId: string }> }
    const ids = body.runs.map((r) => r.runId)
    // All three family members (parent + onComplete + onApprove children) included.
    expect(ids).toContain('run-A-parent')
    expect(ids).toContain('run-A-confident')
    expect(ids).toContain('run-A-flagged')
    // A run for a DIFFERENT (non-family) workflow is NOT in this card's history.
    expect(ids).not.toContain('run-A-other-wf')
    expect(body.runs.every((r) => r.consumerId === 'mi-pase')).toBe(true)
  })

  it('(2) id OUTSIDE the tenant allow-list → 404 SKILL_NOT_FOUND (anti-enumeration), never 403', async () => {
    // call-intake is B's workflow, NOT in A's allow-list. A must not be able to
    // discover it exists for another tenant → 404, indistinguishable from unknown.
    const app = buildApp()
    const res = await app.request('/v1/workflows/call-intake/runs', { headers: A_HEADER })
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
  })

  it('(2b) a fully unknown workflow id → 404 SKILL_NOT_FOUND (same as disallowed)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/no-such-workflow/runs', { headers: A_HEADER })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
  })

  it("(3) ISOLATION ★ — B's family runs never appear in A's history", async () => {
    // Both A's and B's pricing-draft runs are in the table; A queries the family.
    store.runs = [A_PARENT, B_PARENT]
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: Array<{ runId: string; consumerId: string }> }
    const ids = body.runs.map((r) => r.runId)
    expect(ids).toContain('run-A-parent')
    expect(ids).not.toContain('run-B-parent')
    expect(body.runs.every((r) => r.consumerId === 'mi-pase')).toBe(true)
    // The 404-free path must not leak B's data anywhere in the body.
    expect(JSON.stringify(body)).not.toContain('run-B-parent')
    expect(JSON.stringify(body)).not.toContain('"other"')
  })

  it("(3b) when ONLY B's family runs exist → A gets an empty list (no leak)", async () => {
    store.runs = [B_PARENT]
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: unknown[] }
    expect(body.runs).toEqual([])
  })

  it('?status= filters the family history to matching runs only', async () => {
    const done = { ...A_CONFIDENT, runId: 'run-A-confident-done', status: 'succeeded' }
    store.runs = [A_PARENT, done]
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs?status=succeeded', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: Array<{ runId: string; status: string }> }
    expect(body.runs.map((r) => r.runId)).toEqual(['run-A-confident-done'])
    expect(body.runs.every((r) => r.status === 'succeeded')).toBe(true)
  })

  it('(4) no credential → 401 UNAUTHENTICATED', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('an invalid service key → 401 (not a leak of the workflow)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', { headers: { 'X-Service-Key': 'nope' } })
    expect(res.status).toBe(401)
  })
})
