import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Cross-tenant ISOLATION tests (M1.5 / T2). Two service-key tenants — A=`mi-pase`
 * and B=`other` — share one process and ONE mocked db. The db is seeded with
 * B-owned rows only, then every probe is driven through the composed app with A's
 * credential. The assertion is the security property: A's scoped reads never
 * surface B's rows, and B's resource ids resolve to 404 (NEVER 403 — we don't
 * confirm existence to the wrong tenant).
 *
 * KEY DESIGN: the mock db is PREDICATE-AWARE. forConsumer(db, id) injects
 * `eq(R.consumerId, id)` into every read; the drizzle-orm mock turns that into a
 * plain object carrying the tenant id, and this mock filters rows by it. That is
 * what makes "A cannot see B" a real test rather than a tautology — if the route
 * (or scoped-db) ever dropped the consumer_id predicate, the filter would let
 * B's rows leak through and these tests would fail.
 */

type Row = Record<string, unknown>

// Seeded data — all B-owned (consumerId 'other'). A (`mi-pase`) must never see it.
const B_RUN: Row = {
  runId: 'run-B-1',
  workflowId: 'call-intake',
  consumerId: 'other',
  status: 'queued',
  input: {},
  output: null,
  error: null,
  traceId: 't-B',
  idempotencyKey: null,
  parentRunId: null,
  createdAt: new Date('2026-06-05T10:00:00Z'),
  startedAt: null,
  finishedAt: null,
}
const A_RUN: Row = { ...B_RUN, runId: 'run-A-1', consumerId: 'mi-pase', traceId: 't-A' }
const B_APPROVAL: Row = {
  approvalId: 'ap-B-1',
  sourceRunId: 'run-B-1', // links to B's run → tenant B only
  workflowId: 'proposal-step',
  artifact: {},
  state: 'pending',
  approver: 'role:owner',
  decidedBy: null,
  decidedAt: null,
  dispatchedRunId: null,
  createdAt: new Date('2026-06-05T10:01:00Z'),
}

// In-memory store the mock reads from. Tests seed `runs`/`approvals`.
// `inserted` captures rows written by dispatchRun (transaction insert) so the
// cross-tenant DISPATCH isolation case can assert the forced consumerId.
const store: { runs: Row[]; approvals: Row[]; inserted: Row[] } = { runs: [], approvals: [], inserted: [] }

/**
 * Extract the consumerId asserted by an `eq(R.consumerId, x)` clause anywhere in
 * the drizzle-mock predicate tree (`and` wraps an array of `eq` objects). Returns
 * undefined when no consumer_id predicate is present (which would itself be a
 * scoping bug the caller can assert on).
 */
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
function runIdFromPredicate(pred: unknown): string | undefined {
  if (!pred || typeof pred !== 'object') return undefined
  const p = pred as { and?: unknown[]; eq?: [unknown, unknown] }
  if (Array.isArray(p.and)) {
    for (const clause of p.and) {
      const found = runIdFromPredicate(clause)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (Array.isArray(p.eq) && p.eq[0] === 'run_id') return p.eq[1] as string
  return undefined
}
function approvalIdFromPredicate(pred: unknown): string | undefined {
  if (!pred || typeof pred !== 'object') return undefined
  const p = pred as { and?: unknown[]; eq?: [unknown, unknown] }
  if (Array.isArray(p.and)) {
    for (const clause of p.and) {
      const found = approvalIdFromPredicate(clause)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (Array.isArray(p.eq) && p.eq[0] === 'approval_id') return p.eq[1] as string
  return undefined
}

vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

vi.mock('@pokta-engine/db', () => {
  // select() — runs list: .from(R).where(pred).orderBy().limit() filtered by consumer.
  // select({approval:A}) — approvals list: .from(A).innerJoin(R, ...).where(pred)
  //   filtered by the consumer_id predicate (which scopes through the joined run).
  const runsChain = {
    from: () => ({
      where: (pred: unknown) => {
        const consumer = consumerFromPredicate(pred)
        const rows = store.runs.filter((r) => consumer === undefined || r.consumerId === consumer)
        return { orderBy: () => ({ limit: async () => rows }) }
      },
    }),
  }
  const approvalsChain = {
    from: () => ({
      innerJoin: () => ({
        where: (pred: unknown) => {
          const consumer = consumerFromPredicate(pred)
          // Approval rows are scoped by their source run's tenant.
          const rows = store.approvals.filter((a) => {
            const src = store.runs.find((r) => r.runId === a.sourceRunId)
            return consumer === undefined || src?.consumerId === consumer
          })
          return { orderBy: () => ({ limit: async () => rows.map((a) => ({ approval: a })) }) }
        },
      }),
    }),
  }
  const db = {
    select: (proj?: unknown) => (proj ? approvalsChain : runsChain),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async () => [],
        insert: () => ({ values: async (v: Row) => { store.inserted.push(v) } }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
    query: {
      engineRuns: {
        // getRun: where = and(eq(run_id, id), eq(consumer_id, tenant)).
        // A row matches ONLY if both the id AND the tenant match → cross-tenant = undefined.
        findFirst: async ({ where }: { where: unknown }) => {
          const wantRun = runIdFromPredicate(where)
          const wantConsumer = consumerFromPredicate(where)
          return store.runs.find(
            (r) =>
              (wantRun === undefined || r.runId === wantRun) &&
              (wantConsumer === undefined || r.consumerId === wantConsumer),
          )
        },
      },
      engineApprovals: {
        // getApproval first loads the approval by id (no consumer filter here);
        // scoped-db then resolves the tenant via getRun(sourceRunId).
        findFirst: async ({ where }: { where: unknown }) => {
          const wantApproval = approvalIdFromPredicate(where)
          return store.approvals.find((a) => wantApproval === undefined || a.approvalId === wantApproval)
        },
      },
    },
  }
  return {
    db,
    schema: {
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', status: 'status', createdAt: 'created_at' },
      engineApprovals: {
        approvalId: 'approval_id',
        sourceRunId: 'source_run_id',
        state: 'state',
        approver: 'approver',
        createdAt: 'created_at',
      },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => x,
  sql: Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) }),
}))

// ── ./tenants registry mock — needed only by the DISPATCH path (resolveTenant) ──
// The read/approval isolation routes never call resolveTenant (they go straight
// through forConsumer), so the cases above are unaffected by this mock. The
// dispatch POST, however, is registry-backed post-swap: resolveTenant(consumer)
// → getTenant(consumer.id), then the per-tenant allow-list gate. We mock the
// registry so A=mi-pase and B=other are BOTH active, each with a DISJOINT
// allow-list. This lets the dispatch-isolation case prove the registry swap did
// NOT widen access: A cannot dispatch B's workflow, and A's own dispatch is
// force-bound to A regardless of the body.
const TENANTS: Record<string, { status: 'active' | 'pending' | 'disabled'; allowedWorkflows: string[] }> = {
  'mi-pase': { status: 'active', allowedWorkflows: ['pricing-draft'] },
  other: { status: 'active', allowedWorkflows: ['call-intake'] }, // B's workflow, NOT A's
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

// Tenant A = mi-pase, Tenant B = other. A's header is what every probe carries.
const A_HEADER = { 'X-Service-Key': 'svc-key-mipase' }
const B_HEADER = { 'X-Service-Key': 'svc-key-other' }

beforeEach(() => {
  store.runs = []
  store.approvals = []
  store.inserted = []
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,other:svc-key-other'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('cross-tenant isolation — A (mi-pase) cannot reach B (other)', () => {
  it("GET B's run id as A → 404 SKILL_NOT_FOUND (does not confirm existence, never 403)", async () => {
    store.runs = [B_RUN] // only B owns this run
    const app = buildApp()
    const res = await app.request(`/v1/runs/${B_RUN.runId}`, { headers: A_HEADER })
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
    // The 404 body must not leak any of B's row fields.
    expect(JSON.stringify(body)).not.toContain('run-B-1')
    expect(JSON.stringify(body)).not.toContain('other')
  })

  it("GET /v1/runs as A → list is filtered to A only; no B row leaks", async () => {
    store.runs = [B_RUN, A_RUN] // both tenants present in the table
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: Array<{ runId: string; consumerId: string }> }
    const ids = body.runs.map((r) => r.runId)
    expect(ids).toContain('run-A-1')
    expect(ids).not.toContain('run-B-1')
    // No row in A's list belongs to any other tenant.
    expect(body.runs.every((r) => r.consumerId === 'mi-pase')).toBe(true)
  })

  it("GET /v1/runs as A when ONLY B rows exist → empty list (no leak)", async () => {
    store.runs = [B_RUN]
    const app = buildApp()
    const res = await app.request('/v1/runs', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: unknown[] }
    expect(body.runs).toEqual([])
  })

  it("GET /v1/approvals as A → B's approval is filtered out (scoped via source run)", async () => {
    store.runs = [B_RUN]
    store.approvals = [B_APPROVAL]
    const app = buildApp()
    const res = await app.request('/v1/approvals', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approvals: Array<{ approvalId: string }> }
    expect(body.approvals.map((a) => a.approvalId)).not.toContain('ap-B-1')
    expect(body.approvals).toEqual([])
  })

  it("POST approve on B's approval as A → 404 (resolved cross-tenant via sourceRunId), never 403", async () => {
    store.runs = [B_RUN]
    store.approvals = [B_APPROVAL]
    const app = buildApp()
    const res = await app.request(`/v1/approvals/${B_APPROVAL.approvalId}/approve`, {
      method: 'POST',
      headers: A_HEADER,
    })
    // getApproval loads the approval, then loads its source run scoped to A →
    // undefined (B owns the source run) → route 404 SKILL_NOT_FOUND.
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
    expect(JSON.stringify(body)).not.toContain('run-B-1')
  })

  it("POST reject on B's approval as A → 409 APPROVAL_DENIED ('not found or already decided'), never 403", async () => {
    store.runs = [B_RUN]
    store.approvals = [B_APPROVAL]
    const app = buildApp()
    const res = await app.request(`/v1/approvals/${B_APPROVAL.approvalId}/reject`, {
      method: 'POST',
      headers: A_HEADER,
    })
    // reject's ownership gate (getApproval scoped to A) returns not-found for B's
    // approval; the route collapses not-found/already-decided into a single 409.
    expect(res.status).toBe(409)
    expect(res.status).not.toBe(403)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('APPROVAL_DENIED')
    expect(body.error.message).toBe('not found or already decided')
  })
})

describe('positive controls — each tenant sees its OWN data', () => {
  it("A CAN read A's own run (proves the 404s are isolation, not a blanket deny)", async () => {
    store.runs = [A_RUN, B_RUN]
    const app = buildApp()
    const res = await app.request(`/v1/runs/${A_RUN.runId}`, { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; consumerId: string }
    expect(body.runId).toBe('run-A-1')
    expect(body.consumerId).toBe('mi-pase')
  })

  it("symmetry: B CAN read B's own run that A was just denied", async () => {
    store.runs = [A_RUN, B_RUN]
    const app = buildApp()
    const res = await app.request(`/v1/runs/${B_RUN.runId}`, { headers: B_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { runId: string; consumerId: string }
    expect(body.runId).toBe('run-B-1')
    expect(body.consumerId).toBe('other')
  })

  it("B's approvals list contains B's approval (the row A could not see)", async () => {
    store.runs = [B_RUN]
    store.approvals = [B_APPROVAL]
    const app = buildApp()
    const res = await app.request('/v1/approvals', { headers: B_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approvals: Array<{ approvalId: string }> }
    expect(body.approvals.map((a) => a.approvalId)).toContain('ap-B-1')
  })
})

/**
 * DISPATCH isolation under the registry swap (PR2 / ISOLATION ★). The dispatch
 * POST is the one /v1 surface that now flows through resolveTenant→registry +
 * the per-tenant allow-list gate. These cases prove the registry path did NOT
 * widen access: a service-key tenant A still cannot act as B.
 *
 *   - A=mi-pase allow-list = ['pricing-draft']; B=other allow-list = ['call-intake'].
 *   - Cross-tenant dispatch (A POSTing B's 'call-intake') → 404 SKILL_NOT_FOUND
 *     (anti-enumeration: a disallowed id is indistinguishable from an unknown id),
 *     and NOTHING is written.
 *   - A's own allowed dispatch is force-bound to A's consumerId, even when the
 *     body tries to claim B — the registry never re-targets the write.
 */
describe('dispatch isolation — registry swap does not widen cross-tenant access', () => {
  it("A POSTing B's workflow ('call-intake', not in A's allow-list) → 404, nothing dispatched", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/call-intake/runs', {
      method: 'POST',
      headers: { ...A_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    })
    // resolveTenant resolves A fine; the allow-list gate (after getWorkflow) 404s
    // because 'call-intake' ∉ A's allow-list. Must be 404, never 403 (no leak that
    // the workflow exists for another tenant) and never a dispatch.
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('SKILL_NOT_FOUND')
    expect(store.inserted).toHaveLength(0)
  })

  it("A's own dispatch is force-bound to A even when the body claims B (no re-target via registry)", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...A_HEADER, 'Content-Type': 'application/json' },
      // hostile input field claims B; the forced consumerId must still be A.
      body: JSON.stringify({ input: { consumerId: 'other', scope: 'vinos', limit: 3 } }),
    })
    expect(res.status).toBe(200)
    expect(store.inserted).toHaveLength(1)
    const inserted = store.inserted[0] as Row
    expect(inserted.consumerId).toBe('mi-pase')
    expect(inserted.consumerId).not.toBe('other')
    expect(inserted.workflowId).toBe('pricing-draft')
  })

  it("A POSTing pricing-draft with body.consumer_id='other' → 400 ARGS_INVALID, nothing dispatched", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/pricing-draft/runs', {
      method: 'POST',
      headers: { ...A_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ consumer_id: 'other', input: { scope: 'vinos', limit: 3 } }),
    })
    // The body.consumer_id mismatch guard rejects an attempt to dispatch AS B,
    // even though A is otherwise allow-listed for pricing-draft.
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('ARGS_INVALID')
    expect(store.inserted).toHaveLength(0)
  })

  it("symmetry: B CAN dispatch its OWN workflow ('call-intake'), bound to B (not a blanket deny)", async () => {
    const app = buildApp()
    const res = await app.request('/v1/workflows/call-intake/runs', {
      method: 'POST',
      headers: { ...B_HEADER, 'Content-Type': 'application/json' },
      // call-intake requires a non-empty transcript — supply valid input so the
      // request reaches dispatch (the allow-list gate, not input validation, is
      // what we are isolating here).
      body: JSON.stringify({ input: { transcript: 'hi there, calling about a quote' } }),
    })
    // Proves the 404 above is isolation (A∌call-intake), not the workflow being
    // globally unreachable. B is allow-listed for it, so B dispatches and the run
    // is bound to B.
    expect(res.status).toBe(200)
    expect(store.inserted).toHaveLength(1)
    expect((store.inserted[0] as Row).consumerId).toBe('other')
  })
})
