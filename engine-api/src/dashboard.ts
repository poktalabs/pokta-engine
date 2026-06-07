import { Hono } from 'hono'
import { desc } from 'drizzle-orm'
import { db, schema } from '@godin-engine/db'
import { listManifests } from '@godin-engine/workflows'
import type { WorkflowManifest } from '@godin-engine/contract'
import type { IntegrationResult } from '@godin-engine/contract'
import { dashboardPage } from './dashboard-page'

/**
 * Operator dashboard (Lane C / TASK-003). Read-only surface, separate from /demo
 * (D4). It observes engine_runs / engine_approvals / listManifests() and derives
 * the workflow node graph + outcome registry from run output (crmResult /
 * sendResult). It NEVER writes to the database.
 *
 * Architecture: the route handlers fetch rows from the db, then hand them to the
 * pure `buildOverview()` assembler. That split keeps the assembly hermetically
 * testable (mock the db, or call buildOverview directly with fixtures).
 */

// ── Static integration map (D5) ─────────────────────────────────────────────
// The node graph is DERIVED from manifests + policy[] + the parentRunId chain.
// Only the step→integration label is static — no manifest fields are added.
const STEP_INTEGRATIONS: Record<string, IntegrationResult['provider']> = {
  'proposal-step': 'notion', // commits the CRM entry -> Notion page
  'send-step': 'resend', // sends the client email -> Resend message
}

/** The Vino pipeline ordering used to lay the derived graph out left-to-right. */
const PIPELINE_ORDER = ['call-intake', 'proposal-step', 'send-step']

// ── Row shapes (mirror the drizzle $inferSelect, kept loose for the assembler) ─
type RunRow = typeof schema.engineRuns.$inferSelect
type ApprovalRow = typeof schema.engineApprovals.$inferSelect

export interface GraphNode {
  id: string
  kind: 'step'
  runtime: string
  integration: IntegrationResult['provider'] | null
  policies: Array<{ kind: string; detail: string }>
}
export interface GraphGate {
  id: string // approval policy onApprove target it guards
  kind: 'gate'
  approver: string
  guards: string // workflow dispatched on approve
}
export type GraphElement = GraphNode | GraphGate

export interface DerivedGraph {
  /** Ordered elements: step → [gate] → step → [gate] → step. */
  elements: GraphElement[]
  /** Edges from the actual parentRunId chains observed in runs (run-level). */
  chains: Array<{ parentRunId: string; childRunId: string; childWorkflowId: string }>
}

export interface RunView {
  runId: string
  workflowId: string
  status: RunRow['status']
  consumerId: string
  parentRunId: string | null
  traceId: string
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface ApprovalView {
  approvalId: string
  workflowId: string
  state: ApprovalRow['state']
  approver: string
  decidedBy: string | null
  sourceRunId: string
  dispatchedRunId: string | null
  createdAt: string | null
}

export interface OutcomeView {
  /** 'notion' (crmResult) | 'resend' (sendResult). */
  provider: IntegrationResult['provider']
  /** The run whose output carried this outcome. */
  runId: string
  workflowId: string
  /** The run's own lifecycle status — can be 'succeeded' even if the outcome failed (D3). */
  runStatus: RunRow['status']
  /** The integration outcome status — the fail-soft signal the operator must catch. */
  status: IntegrationResult['status']
  ref?: string
  url?: string
  error?: string
  at?: string
}

export interface Overview {
  runs: RunView[]
  approvals: ApprovalView[]
  graph: DerivedGraph
  outcomes: {
    crm: OutcomeView[] // Notion rows created
    emails: OutcomeView[] // Resend messages sent
    /** Outcomes whose integration failed (status:'failed') — needs operator retry. */
    failures: OutcomeView[]
  }
  counts: {
    runs: number
    runsByStatus: Record<string, number>
    pendingApprovals: number
    crmCreated: number
    emailsSent: number
    failedOutcomes: number
  }
}

function iso(v: unknown): string | null {
  if (!v) return null
  try {
    return new Date(v as string | Date).toISOString()
  } catch {
    return String(v)
  }
}

function toRunView(r: RunRow): RunView {
  return {
    runId: r.runId,
    workflowId: r.workflowId,
    status: r.status,
    consumerId: r.consumerId,
    parentRunId: r.parentRunId ?? null,
    traceId: r.traceId,
    createdAt: iso(r.createdAt),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
  }
}

function toApprovalView(a: ApprovalRow): ApprovalView {
  return {
    approvalId: a.approvalId,
    workflowId: a.workflowId,
    state: a.state,
    approver: a.approver,
    decidedBy: a.decidedBy ?? null,
    sourceRunId: a.sourceRunId,
    dispatchedRunId: a.dispatchedRunId ?? null,
    createdAt: iso(a.createdAt),
  }
}

function policyDetail(p: WorkflowManifest['policy'][number]): { kind: string; detail: string } {
  if (p.kind === 'quota') return { kind: 'quota', detail: `${p.perDay}/day · ${p.scope} · ${p.tier}` }
  if (p.kind === 'approval') return { kind: 'approval', detail: `${p.approver} → ${p.onApprove}` }
  return { kind: (p as { kind: string }).kind, detail: '' }
}

/**
 * Derive the workflow node graph from manifests + policy[] + the run chains.
 * The static STEP_INTEGRATIONS map annotates which integration each step uses
 * (D5). Gates are inserted between a step and its onApprove target.
 */
export function deriveGraph(manifests: WorkflowManifest[], runs: RunRow[]): DerivedGraph {
  const byId = new Map(manifests.map((m) => [m.id, m]))
  // Only graph the Vino pipeline steps (the demo's real workflows), in order.
  const pipelineIds = PIPELINE_ORDER.filter((id) => byId.has(id))

  const elements: GraphElement[] = []
  for (const id of pipelineIds) {
    const m = byId.get(id)
    if (!m) continue
    elements.push({
      id,
      kind: 'step',
      runtime: m.runtime,
      integration: STEP_INTEGRATIONS[id] ?? null,
      policies: m.policy.map(policyDetail),
    })
    // Insert a gate after this step for each approval policy it declares.
    for (const p of m.policy) {
      if (p.kind === 'approval') {
        elements.push({
          id: p.onApprove,
          kind: 'gate',
          approver: p.approver,
          guards: p.onApprove,
        })
      }
    }
  }

  const chains = runs
    .filter((r) => r.parentRunId)
    .map((r) => ({
      parentRunId: r.parentRunId as string,
      childRunId: r.runId,
      childWorkflowId: r.workflowId,
    }))

  return { elements, chains }
}

/** Narrow unknown run output into an IntegrationResult if it looks like one. */
function asIntegrationResult(v: unknown): IntegrationResult | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (
    (o.provider === 'notion' || o.provider === 'resend') &&
    (o.status === 'ok' || o.status === 'failed')
  ) {
    return o as unknown as IntegrationResult
  }
  return null
}

/**
 * Scan engine_runs.output for crmResult (Notion) and sendResult (Resend),
 * building the outcome registry (D1: no dedicated table). Mid-flight runs with
 * no result yet are simply skipped — never crash. A failed outcome on a
 * succeeded run lands in `failures` so the operator can catch + retry (D3).
 */
export function buildOutcomes(runs: RunRow[]): Overview['outcomes'] {
  const crm: OutcomeView[] = []
  const emails: OutcomeView[] = []
  const failures: OutcomeView[] = []

  for (const r of runs) {
    const out = r.output as Record<string, unknown> | null | undefined
    if (!out || typeof out !== 'object') continue

    const candidates: Array<[string, unknown]> = [
      ['crmResult', out.crmResult],
      ['sendResult', out.sendResult],
    ]
    for (const [, raw] of candidates) {
      const ir = asIntegrationResult(raw)
      if (!ir) continue
      const view: OutcomeView = {
        provider: ir.provider,
        runId: r.runId,
        workflowId: r.workflowId,
        runStatus: r.status,
        status: ir.status,
        ref: ir.ref,
        url: ir.url,
        error: ir.error,
        at: ir.at,
      }
      if (ir.provider === 'notion') crm.push(view)
      else emails.push(view)
      if (ir.status === 'failed') failures.push(view)
    }
  }

  return { crm, emails, failures }
}

/** Pure assembler — all four views in the dashboard's wire shape. Hermetic. */
export function buildOverview(
  runs: RunRow[],
  approvals: ApprovalRow[],
  manifests: WorkflowManifest[],
): Overview {
  const runsByStatus: Record<string, number> = {}
  for (const r of runs) runsByStatus[r.status] = (runsByStatus[r.status] ?? 0) + 1

  const outcomes = buildOutcomes(runs)

  return {
    runs: runs.map(toRunView),
    approvals: approvals.map(toApprovalView),
    graph: deriveGraph(manifests, runs),
    outcomes,
    counts: {
      runs: runs.length,
      runsByStatus,
      pendingApprovals: approvals.filter((a) => a.state === 'pending').length,
      crmCreated: outcomes.crm.filter((o) => o.status === 'ok').length,
      emailsSent: outcomes.emails.filter((o) => o.status === 'ok').length,
      failedOutcomes: outcomes.failures.length,
    },
  }
}

/** Fetch the dashboard's data from the engine's own Postgres (read-only). */
async function fetchOverview(): Promise<Overview> {
  const runs = await db
    .select()
    .from(schema.engineRuns)
    .orderBy(desc(schema.engineRuns.createdAt))
    .limit(100)
  const approvals = await db
    .select()
    .from(schema.engineApprovals)
    .orderBy(desc(schema.engineApprovals.createdAt))
    .limit(100)
  return buildOverview(runs, approvals, listManifests())
}

export function mountDashboard(app: Hono): void {
  // The operator console (HTML shell + client-side polling of the JSON API).
  app.get('/dashboard', (c) => c.html(dashboardPage()))

  // Read-only JSON: the assembled overview (runs + approvals + graph + outcomes).
  app.get('/dashboard/api/overview', async (c) => {
    const overview = await fetchOverview()
    return c.json(overview)
  })
}
