import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * GET /v1/workspace/workflows (P5b) — workspace CARD composition + ISOLATION ★.
 *
 * Hermetic: we MOCK @pokta-engine/db and @pokta-engine/queue so nothing touches
 * Postgres / pg-boss, and the `./tenants` registry seam so resolveTenant is
 * registry-backed without a DB (mirrors isolation.test.ts / scoped-db.test.ts).
 *
 * The card composition route does TWO scoped reads inside
 * scoped-db.workspaceWorkflowCards:
 *   1) runs    — db.select().from(R).where(eq(R.consumer_id, t)).orderBy().limit()
 *   2) pending — db.select({approval:A}).from(A).innerJoin(R, …)
 *                  .where(and(eq(R.consumer_id, t), eq(A.state,'pending'))).limit()
 * then folds them per card in memory (no N+1). Our fake db is PREDICATE-AWARE:
 * forConsumer injects eq(R.consumer_id, id); the drizzle mock turns that into a
 * plain marker carrying the tenant id, and the fake filters rows by it. That is
 * what makes "tenant A sees only its own data" a real test — drop the predicate
 * and the cross-tenant rows would leak and these assertions would fail.
 *
 * The Daily Pricing family (catalog parent `pricing-draft`) folds children
 * `pricing-apply-confident` + `pricing-apply-flagged`: lastRun is the newest run
 * across the family, pendingApprovals counts pending gates across the family.
 */

type Row = Record<string, unknown>

// In-memory store the predicate-aware mock reads from; tests seed it.
const store: { runs: Row[]; approvals: Row[]; inserted: Row[] } = { runs: [], approvals: [], inserted: [] }

// ── Predicate-tree walkers (drizzle mock encodes eq as { eq:[col,val] }, and as { and:[…] }) ──
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
function stateFromPredicate(pred: unknown): string | undefined {
  if (!pred || typeof pred !== 'object') return undefined
  const p = pred as { and?: unknown[]; eq?: [unknown, unknown] }
  if (Array.isArray(p.and)) {
    for (const clause of p.and) {
      const found = stateFromPredicate(clause)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (Array.isArray(p.eq) && p.eq[0] === 'state') return p.eq[1] as string
  return undefined
}

vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

vi.mock('@pokta-engine/db', () => {
  // runs read: select().from(R).where(pred).orderBy().limit() — filtered by consumer.
  const runsChain = {
    from: () => ({
      where: (pred: unknown) => {
        const consumer = consumerFromPredicate(pred)
        // Emulate `.orderBy(desc(R.created_at))`: newest-first, like the real query.
        // workspaceWorkflowCards picks the FIRST family match as lastRun, so the
        // ordering must be faithful or "most-recent run" assertions are meaningless.
        const rows = store.runs
          .filter((r) => consumer === undefined || r.consumerId === consumer)
          .slice()
          .sort((a, b) => Number(new Date(b.createdAt as string)) - Number(new Date(a.createdAt as string)))
        // `.where()` may be followed by `.orderBy().limit()` (listRuns / cards) OR
        // `.limit()` directly — expose both shapes for safety.
        return {
          orderBy: () => ({ limit: async () => rows }),
          limit: async () => rows,
        }
      },
    }),
  }
  // pending-approvals read: select({approval:A}).from(A).innerJoin(R,…).where(pred).limit()
  // (workspaceWorkflowCards) OR .where(pred).orderBy().limit() (listApprovals). Scope
  // approvals by the JOINED source run's tenant AND any state filter in the predicate.
  const approvalsChain = {
    from: () => ({
      innerJoin: () => ({
        where: (pred: unknown) => {
          const consumer = consumerFromPredicate(pred)
          const wantState = stateFromPredicate(pred)
          const rows = store.approvals.filter((a) => {
            const src = store.runs.find((r) => r.runId === a.sourceRunId)
            const tenantOk = consumer === undefined || src?.consumerId === consumer
            const stateOk = wantState === undefined || a.state === wantState
            return tenantOk && stateOk
          })
          const project = async () => rows.map((a) => ({ approval: a }))
          return {
            orderBy: () => ({ limit: project }),
            limit: project,
          }
        },
      }),
    }),
  }
  const db = {
    select: (proj?: unknown) => (proj ? approvalsChain : runsChain),
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
    },
  }
  return {
    db,
    schema: {
      engineRuns: { runId: 'run_id', consumerId: 'consumer_id', status: 'status', createdAt: 'created_at', workflowId: 'workflow_id' },
      engineApprovals: { approvalId: 'approval_id', sourceRunId: 'source_run_id', state: 'state', approver: 'approver', createdAt: 'created_at' },
      engineTenantIntegrations: { tenantId: 'tenant_id', integrationId: 'integration_id', status: 'status' },
    },
  }
})

vi.mock('drizzle-orm', () => ({
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  desc: (x: unknown) => x,
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  sql: Object.assign((..._a: unknown[]) => ({}), { raw: () => ({}) }),
}))

// ── ./tenants registry seam — resolveTenant(consumer) → getTenant(consumer.id) ──
// A=mi-pase is ACTIVE and allow-listed for the Daily Pricing parent `pricing-draft`
// → the catalog card surfaces. B=other is ACTIVE but allow-listed for a DIFFERENT
// workflow (no pricing-draft) → it surfaces NO Daily Pricing card. `pending`/`disabled`
// tenants do NOT resolve (isActive is the real status predicate — no weakening).
const TENANTS: Record<string, { status: 'active' | 'pending' | 'disabled'; allowedWorkflows: string[] }> = {
  'mi-pase': { status: 'active', allowedWorkflows: ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged'] },
  other: { status: 'active', allowedWorkflows: ['call-intake'] },
  vino: { status: 'pending', allowedWorkflows: ['pricing-draft'] }, // pending → never resolves
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

const A_HEADER = { 'X-Service-Key': 'svc-key-mipase' } // tenant A = mi-pase
const B_HEADER = { 'X-Service-Key': 'svc-key-other' } // tenant B = other
const VINO_HEADER = { 'X-Service-Key': 'svc-key-vino' } // pending tenant

// ── Family rows ──────────────────────────────────────────────────────────────
// A owns runs across the Daily Pricing family + one pending flagged gate.
const A_DRAFT_OLD: Row = {
  runId: 'run-A-draft-old', workflowId: 'pricing-draft', consumerId: 'mi-pase', status: 'succeeded',
  input: {}, output: null, error: null, traceId: 't-A1', idempotencyKey: null, parentRunId: null,
  createdAt: new Date('2026-06-05T10:00:00Z'), startedAt: null, finishedAt: null,
}
const A_APPLY_NEW: Row = {
  ...A_DRAFT_OLD, runId: 'run-A-apply-new', workflowId: 'pricing-apply-confident', status: 'queued',
  traceId: 't-A2', createdAt: new Date('2026-06-05T12:00:00Z'),
}
const A_FLAGGED_RUN: Row = {
  ...A_DRAFT_OLD, runId: 'run-A-flagged', workflowId: 'pricing-apply-flagged', status: 'awaiting_approval',
  traceId: 't-A3', createdAt: new Date('2026-06-05T11:00:00Z'),
}
const A_PENDING_APPROVAL: Row = {
  approvalId: 'ap-A-1', sourceRunId: 'run-A-flagged', workflowId: 'pricing-apply-flagged', artifact: {},
  state: 'pending', approver: 'role:owner', decidedBy: null, decidedAt: null, dispatchedRunId: null,
  createdAt: new Date('2026-06-05T11:01:00Z'),
}

// B owns its OWN Daily Pricing family rows — these must NEVER leak into A's card.
const B_DRAFT: Row = {
  ...A_DRAFT_OLD, runId: 'run-B-draft', workflowId: 'pricing-draft', consumerId: 'other',
  traceId: 't-B1', createdAt: new Date('2026-06-06T09:00:00Z'), // newer than ALL of A's runs
}
const B_PENDING_APPROVAL: Row = {
  ...A_PENDING_APPROVAL, approvalId: 'ap-B-1', sourceRunId: 'run-B-flagged', state: 'pending',
}
const B_FLAGGED_RUN: Row = {
  ...A_FLAGGED_RUN, runId: 'run-B-flagged', consumerId: 'other', traceId: 't-B2',
}

beforeEach(() => {
  store.runs = []
  store.approvals = []
  store.inserted = []
  process.env.SERVICE_KEYS = 'mi-pase:svc-key-mipase,other:svc-key-other,vino:svc-key-vino'
  process.env.OPERATOR_KEY = 'op-secret'
  delete process.env.PRIVY_TENANT_MAP
})

describe('GET /v1/workspace/workflows — card composition for the authed tenant', () => {
  it('folds the Daily Pricing card: lastRun = most-recent family run, pendingApprovals count, hasDetail=true', async () => {
    store.runs = [A_DRAFT_OLD, A_APPLY_NEW, A_FLAGGED_RUN]
    store.approvals = [A_PENDING_APPROVAL]
    const app = buildApp()
    const res = await app.request('/v1/workspace/workflows', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workflows: Array<{
        id: string
        displayName: string
        trigger: string
        lastRun: { status: string; at: string } | null
        pendingApprovals: number
        hasDetail: boolean
      }>
    }
    // Exactly one card — the Daily Pricing family (children are folded, never standalone).
    expect(body.workflows).toHaveLength(1)
    const card = body.workflows[0]!
    expect(card.id).toBe('pricing-draft')
    expect(card.displayName).toBe('Daily Pricing')
    expect(card.trigger).toBe('manual')
    expect(card.hasDetail).toBe(true)
    // lastRun is the newest run ACROSS the family — the 12:00 apply-confident run,
    // not the 10:00 draft. Proves children fold into the parent card.
    expect(card.lastRun).not.toBeNull()
    expect(card.lastRun?.status).toBe('queued')
    expect(card.lastRun?.at).toBe(new Date('2026-06-05T12:00:00Z').toISOString())
    // one pending gate in the family.
    expect(card.pendingApprovals).toBe(1)
  })

  it('lastRun is null and pendingApprovals 0 when the tenant has never run the family', async () => {
    store.runs = []
    store.approvals = []
    const app = buildApp()
    const res = await app.request('/v1/workspace/workflows', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { workflows: Array<{ id: string; lastRun: unknown; pendingApprovals: number }> }
    expect(body.workflows).toHaveLength(1)
    expect(body.workflows[0]!.id).toBe('pricing-draft')
    expect(body.workflows[0]!.lastRun).toBeNull()
    expect(body.workflows[0]!.pendingApprovals).toBe(0)
  })
})

describe('ISOLATION ★ — A sees only its own data; B rows never leak into A card', () => {
  it("a cross-tenant run/approval is excluded — A's lastRun + counts ignore B entirely", async () => {
    // Both tenants present in the shared tables. B's draft (06-06) is NEWER than every
    // A run, and B has its own pending gate — if scoping were dropped, B's run would
    // become A's lastRun and B's gate would inflate A's count.
    store.runs = [A_DRAFT_OLD, A_APPLY_NEW, A_FLAGGED_RUN, B_DRAFT, B_FLAGGED_RUN]
    store.approvals = [A_PENDING_APPROVAL, B_PENDING_APPROVAL]
    const app = buildApp()
    const res = await app.request('/v1/workspace/workflows', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workflows: Array<{ id: string; lastRun: { at: string } | null; pendingApprovals: number }>
    }
    const card = body.workflows[0]!
    // lastRun is A's newest (12:00), NOT B's newer (06-06) run → no cross-tenant leak.
    expect(card.lastRun?.at).toBe(new Date('2026-06-05T12:00:00Z').toISOString())
    // count is A's single gate, NOT inflated by B's pending approval.
    expect(card.pendingApprovals).toBe(1)
    // Nothing in the response references any of B's rows.
    expect(JSON.stringify(body)).not.toContain('run-B-')
    expect(JSON.stringify(body)).not.toContain('ap-B-')
    expect(JSON.stringify(body)).not.toContain('other')
  })

  it("when ONLY B's family rows exist, A's card shows null lastRun + 0 pending (no leak)", async () => {
    store.runs = [B_DRAFT, B_FLAGGED_RUN]
    store.approvals = [B_PENDING_APPROVAL]
    const app = buildApp()
    const res = await app.request('/v1/workspace/workflows', { headers: A_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workflows: Array<{ lastRun: unknown; pendingApprovals: number }>
    }
    expect(body.workflows[0]!.lastRun).toBeNull()
    expect(body.workflows[0]!.pendingApprovals).toBe(0)
  })

  it("symmetry: B sees NO Daily Pricing card (its allow-list excludes pricing-draft)", async () => {
    // Positive control that the card gating is allow-list driven, not global.
    store.runs = [B_DRAFT]
    const app = buildApp()
    const res = await app.request('/v1/workspace/workflows', { headers: B_HEADER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { workflows: unknown[] }
    expect(body.workflows).toEqual([])
  })
})

describe('auth + fail-closed', () => {
  it('unauthenticated → 401 UNAUTHENTICATED', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workspace/workflows')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })

  it('a pending/disabled tenant principal fails closed → TENANT_UNKNOWN (403)', async () => {
    const app = buildApp()
    const res = await app.request('/v1/workspace/workflows', { headers: VINO_HEADER })
    // resolveTenant → getTenant('vino') → status 'pending' → isActive false → not ok.
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TENANT_UNKNOWN')
  })
})
