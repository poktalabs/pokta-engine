import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { WorkflowManifest } from '@pokta-engine/contract'

// The graph derivation only reads manifest.id/runtime/policy — not the Zod
// schema — so we stub `input` to avoid pulling zod into engine-api's deps.
const anyInput = {} as WorkflowManifest['input']

/**
 * Hermetic dashboard shape test (D6). We MOCK @pokta-engine/db so nothing touches
 * a live Postgres (the db client throws without DATABASE_URL on import), and mock
 * @pokta-engine/workflows so the derived graph is asserted against a known set of
 * manifests. The fixtures cover the D3 fail-soft case: a status:'succeeded' run
 * whose send outcome is status:'failed', plus a mid-flight run with no outcome.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────
const RUNS = [
  // mid-flight: no output at all -> must not crash, no outcome rows
  {
    runId: 'run-intake',
    workflowId: 'call-intake',
    status: 'running',
    consumerId: 'demo',
    input: {},
    output: null,
    error: null,
    traceId: 't1',
    idempotencyKey: null,
    parentRunId: null,
    createdAt: new Date('2026-06-05T10:00:00Z'),
    startedAt: new Date('2026-06-05T10:00:01Z'),
    finishedAt: null,
  },
  // proposal-step succeeded with a successful Notion crmResult
  {
    runId: 'run-proposal',
    workflowId: 'proposal-step',
    status: 'succeeded',
    consumerId: 'demo',
    input: {},
    output: {
      crmResult: { provider: 'notion', status: 'ok', ref: 'page_123', url: 'https://notion.so/page_123', at: '2026-06-05T10:05:00Z' },
    },
    error: null,
    traceId: 't2',
    idempotencyKey: null,
    parentRunId: 'run-intake',
    createdAt: new Date('2026-06-05T10:05:00Z'),
    startedAt: new Date('2026-06-05T10:05:01Z'),
    finishedAt: new Date('2026-06-05T10:05:02Z'),
  },
  // send-step SUCCEEDED but its Resend outcome FAILED (the D3 case)
  {
    runId: 'run-send',
    workflowId: 'send-step',
    status: 'succeeded',
    consumerId: 'demo',
    input: {},
    output: {
      sendResult: { provider: 'resend', status: 'failed', error: 'rate limited', at: '2026-06-05T10:10:00Z' },
    },
    error: null,
    traceId: 't3',
    idempotencyKey: null,
    parentRunId: 'run-proposal',
    createdAt: new Date('2026-06-05T10:10:00Z'),
    startedAt: new Date('2026-06-05T10:10:01Z'),
    finishedAt: new Date('2026-06-05T10:10:02Z'),
  },
]

const APPROVALS = [
  {
    approvalId: 'ap-1',
    sourceRunId: 'run-intake',
    workflowId: 'proposal-step',
    artifact: {},
    state: 'pending',
    approver: 'role:owner',
    decidedBy: null,
    decidedAt: null,
    dispatchedRunId: null,
    createdAt: new Date('2026-06-05T10:01:00Z'),
  },
]

const MANIFESTS: WorkflowManifest[] = [
  { id: 'call-intake', version: '0.1.0', runtime: 'agent', timeoutMs: 1, policy: [{ kind: 'approval', approver: 'role:owner', onApprove: 'proposal-step' }], input: anyInput },
  { id: 'proposal-step', version: '0.1.0', runtime: 'agent', timeoutMs: 1, policy: [{ kind: 'approval', approver: 'role:owner', onApprove: 'send-step' }], input: anyInput },
  { id: 'send-step', version: '0.1.0', runtime: 'serverless', timeoutMs: 1, policy: [], input: anyInput },
]

// ── Mocks (must be before importing the module under test) ──────────────────
const selectMock = vi.fn()
vi.mock('@pokta-engine/db', () => ({
  db: {
    select: () => ({ from: () => ({ orderBy: () => ({ limit: () => selectMock() }) }) }),
  },
  schema: {
    engineRuns: { createdAt: 'created_at' },
    engineApprovals: { createdAt: 'created_at' },
  },
}))
vi.mock('@pokta-engine/workflows', () => ({
  listManifests: () => MANIFESTS,
}))
vi.mock('drizzle-orm', () => ({ desc: (x: unknown) => x }))

// Import after mocks are registered.
const { buildOverview, deriveGraph, buildOutcomes, mountDashboard } = await import('./dashboard')

describe('buildOverview (pure assembler)', () => {
  const overview = buildOverview(RUNS as never, APPROVALS as never, MANIFESTS)

  it('returns runs + approvals + graph + outcomes in the expected shape', () => {
    expect(overview).toMatchObject({
      runs: expect.any(Array),
      approvals: expect.any(Array),
      graph: { elements: expect.any(Array), chains: expect.any(Array) },
      outcomes: { crm: expect.any(Array), emails: expect.any(Array), failures: expect.any(Array) },
      counts: expect.objectContaining({ runs: 3, pendingApprovals: 1 }),
    })
  })

  it('maps run rows to the view shape (ISO timestamps, parentRunId chain)', () => {
    const send = overview.runs.find((r) => r.runId === 'run-send')
    expect(send).toMatchObject({ workflowId: 'send-step', status: 'succeeded', parentRunId: 'run-proposal' })
    expect(send?.createdAt).toBe('2026-06-05T10:10:00.000Z')
  })

  it('derives the node graph: step → gate → step → gate → step with integration labels', () => {
    const g = deriveGraph(MANIFESTS, RUNS as never)
    const kinds = g.elements.map((e) => `${e.kind}:${e.id}`)
    expect(kinds).toEqual([
      'step:call-intake',
      'gate:proposal-step',
      'step:proposal-step',
      'gate:send-step',
      'step:send-step',
    ])
    const proposal = g.elements.find((e) => e.kind === 'step' && e.id === 'proposal-step')
    const send = g.elements.find((e) => e.kind === 'step' && e.id === 'send-step')
    // static D5 integration map
    expect((proposal as { integration: string }).integration).toBe('notion')
    expect((send as { integration: string }).integration).toBe('resend')
    // chains derived from the real parentRunId links
    expect(g.chains).toEqual(
      expect.arrayContaining([{ parentRunId: 'run-proposal', childRunId: 'run-send', childWorkflowId: 'send-step' }]),
    )
  })

  it('builds the outcome registry: Notion CRM row + a failed Resend send (D3)', () => {
    const { crm, emails, failures } = overview.outcomes
    expect(crm).toHaveLength(1)
    expect(crm[0]).toMatchObject({ provider: 'notion', status: 'ok', url: 'https://notion.so/page_123' })
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({ provider: 'resend', status: 'failed', error: 'rate limited' })
    // The D3 distinct case: run succeeded, outcome failed -> surfaced in failures.
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ runId: 'run-send', runStatus: 'succeeded', status: 'failed' })
    expect(overview.counts).toMatchObject({ crmCreated: 1, emailsSent: 0, failedOutcomes: 1 })
  })

  it('handles mid-flight runs with no crmResult/sendResult without crashing', () => {
    // run-intake has output:null and must not contribute any outcome row.
    expect(() => buildOutcomes([RUNS[0]] as never)).not.toThrow()
    expect(buildOutcomes([RUNS[0]] as never)).toEqual({ crm: [], emails: [], failures: [] })
  })
})

describe('GET /dashboard/api/overview (mocked db)', () => {
  it('returns the assembled overview JSON', async () => {
    selectMock.mockReturnValueOnce(RUNS).mockReturnValueOnce(APPROVALS)
    const app = new Hono()
    mountDashboard(app)
    const res = await app.request('/dashboard/api/overview')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { outcomes: { failures: unknown[] } }
    expect(body).toMatchObject({
      runs: expect.any(Array),
      approvals: expect.any(Array),
      graph: { elements: expect.any(Array) },
      outcomes: { crm: expect.any(Array), emails: expect.any(Array), failures: expect.any(Array) },
    })
    expect(body.outcomes.failures).toHaveLength(1)
  })

  it('serves the HTML dashboard shell at /dashboard', async () => {
    const app = new Hono()
    mountDashboard(app)
    const res = await app.request('/dashboard')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})
