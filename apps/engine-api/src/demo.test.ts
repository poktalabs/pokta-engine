import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

/**
 * Security tests for the PUBLIC /demo surface. The demo has NO operator key, so the
 * load-bearing guarantees are enforced inside demo.ts:
 *   1. every read/write is scoped to consumerId 'demo' — a public caller can NEVER
 *      view, approve, or reject a real tenant's run/approval by id;
 *   2. runs are dispatched no-LLM (scripted: true);
 *   3. /demo/api/run is per-IP rate-limited.
 * We MOCK @pokta-engine/db so nothing touches Postgres and we can drive the
 * consumerId of the rows the handlers see.
 */

const findRun = vi.fn()
const findApproval = vi.fn()
const insertValues = vi.fn().mockResolvedValue(undefined)
const updateReturning = vi.fn().mockResolvedValue([{ approvalId: 'ap-1' }])

vi.mock('@pokta-engine/db', () => ({
  db: {
    query: {
      engineRuns: { findFirst: (...a: unknown[]) => findRun(...a) },
      engineApprovals: { findFirst: (...a: unknown[]) => findApproval(...a) },
    },
    insert: () => ({ values: (v: unknown) => insertValues(v) }),
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => updateReturning() }) }) }),
    transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        execute: async () => [{ state: 'pending' }],
        insert: () => ({ values: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      }),
  },
  schema: {
    engineRuns: { runId: 'run_id', parentRunId: 'parent_run_id', consumerId: 'consumer_id', createdAt: 'created_at' },
    engineApprovals: { approvalId: 'approval_id', sourceRunId: 'source_run_id', createdAt: 'created_at' },
  },
}))
vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: vi.fn().mockResolvedValue(undefined) }),
  QUEUE: 'q',
}))
vi.mock('@pokta-engine/workflows', () => ({
  getWorkflow: () => ({ manifest: { input: { safeParse: () => ({ success: true, data: {} }) } } }),
}))
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
  desc: (x: unknown) => x,
  inArray: (a: unknown, b: unknown) => ({ a, b }),
  sql: (strings: TemplateStringsArray) => strings.join('?'),
}))
vi.mock('./demo-page', () => ({ demoPage: () => '<html>demo</html>', demoOpsPage: () => '<html>ops</html>' }))

const { mountDemo } = await import('./demo')

function appWithDemo() {
  const app = new Hono()
  mountDemo(app)
  return app
}

const TRANSCRIPT = 'Discovery call: homeowner wants a full kitchen and bath remodel, ~$135k.'

beforeEach(() => {
  findRun.mockReset()
  findApproval.mockReset()
  insertValues.mockClear()
  updateReturning.mockReset().mockResolvedValue([{ approvalId: 'ap-1' }])
})
afterEach(() => vi.clearAllMocks())

describe('PUBLIC /demo — consumer scoping (no cross-tenant access by id)', () => {
  it('GET /demo/api/state/:id → 404 when the root run is NOT the demo consumer', async () => {
    findRun.mockResolvedValueOnce({ runId: 'r', workflowId: 'call-intake', consumerId: 'mi-pase' })
    const res = await appWithDemo().request('/demo/api/state/r')
    expect(res.status).toBe(404)
  })

  it('GET /demo/api/state/:id → 200 for a demo run', async () => {
    findRun
      .mockResolvedValueOnce({ runId: 'r', workflowId: 'call-intake', consumerId: 'demo' })
      .mockResolvedValueOnce(undefined) // no child in the chain
    const res = await appWithDemo().request('/demo/api/state/r')
    expect(res.status).toBe(200)
  })

  it('POST approve → denied (409) when the approval belongs to a NON-demo run', async () => {
    findApproval.mockResolvedValueOnce({ approvalId: 'ap-1', sourceRunId: 'real-run', state: 'pending', workflowId: 'proposal-step', artifact: {} })
    findRun.mockResolvedValueOnce({ runId: 'real-run', consumerId: 'mi-pase' }) // real tenant!
    const res = await appWithDemo().request('/demo/api/approvals/ap-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decided_by: 'attacker' }),
    })
    expect(res.status).toBe(409)
    expect(insertValues).not.toHaveBeenCalled() // never dispatched a child run
  })

  it('POST reject → denied (409) when the approval belongs to a NON-demo run', async () => {
    findApproval.mockResolvedValueOnce({ approvalId: 'ap-1', sourceRunId: 'real-run', state: 'pending', workflowId: 'proposal-step', artifact: {} })
    findRun.mockResolvedValueOnce({ runId: 'real-run', consumerId: 'mi-pase' })
    const res = await appWithDemo().request('/demo/api/approvals/ap-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decided_by: 'attacker' }),
    })
    expect(res.status).toBe(409)
    expect(updateReturning).not.toHaveBeenCalled() // never flipped the real approval
  })

  it('POST approve → 200 for a demo approval (scoping allows it)', async () => {
    findApproval.mockResolvedValueOnce({ approvalId: 'ap-1', sourceRunId: 'demo-run', state: 'pending', workflowId: 'proposal-step', artifact: {} })
    findRun.mockResolvedValueOnce({ runId: 'demo-run', consumerId: 'demo' })
    const res = await appWithDemo().request('/demo/api/approvals/ap-1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decided_by: 'demo-owner' }),
    })
    expect(res.status).toBe(200)
  })
})

describe('PUBLIC /demo — dispatch is no-LLM + demo-scoped', () => {
  it('POST /demo/api/run dispatches call-intake as consumer "demo" with scripted:true', async () => {
    const res = await appWithDemo().request('/demo/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
      body: JSON.stringify({ transcript: TRANSCRIPT }),
    })
    expect(res.status).toBe(200)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'call-intake',
        consumerId: 'demo',
        input: expect.objectContaining({ scripted: true }),
      }),
    )
  })

  it('rejects a too-short transcript with 400', async () => {
    const res = await appWithDemo().request('/demo/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.8' },
      body: JSON.stringify({ transcript: 'too short' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('PUBLIC /demo — per-IP rate limit', () => {
  it('returns 429 after the per-IP run budget is exhausted', async () => {
    const app = appWithDemo()
    const ip = '203.0.113.42' // unique to this test so other tests do not consume the budget
    const post = () =>
      app.request('/demo/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ transcript: TRANSCRIPT }),
      })

    const statuses: number[] = []
    for (let i = 0; i < 13; i++) statuses.push((await post()).status)

    expect(statuses.slice(0, 12).every((s) => s === 200)).toBe(true)
    expect(statuses[12]).toBe(429)
  })
})
