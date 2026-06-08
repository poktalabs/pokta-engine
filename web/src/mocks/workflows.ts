import type { RunListItem, RunStatus } from '@godin-engine/contract'

/**
 * Workflows surface fixtures (M2 P3-A).
 *
 * Drives the WORKFLOWS list (one row per workflow) and the Daily Pricing detail
 * (today's status, run-now, ScheduleEditor, pipeline flow, run history). These
 * are VIEW models the workflow components own — distinct from the contract's
 * `WorkflowManifest` (authoring shape) and reconciled against the read routes the
 * dashboard actually calls (`GET /v1/workflows`, `GET /v1/workflows/:id/runs`).
 *
 * The Mi Pase daily-pricing workflow id, schedule ("Daily 6AM"), and the
 * draft → [approval gate] → apply pipeline are derived from the real workflow in
 * `workflows/pricing/` (`pricing-draft` manifest: an approval policy on
 * `role:owner` → `pricing-apply-flagged`, plus an ungated `onComplete:
 * pricing-apply-confident`). The flagged subset is what the human gates; the
 * confident subset auto-applies. Run-history rows reuse the contract
 * `RunListItem`/`RunStatus` where the shape matches the real run row, with the
 * surface-specific outcome breakdown layered on top.
 *
 * Served only behind `VITE_USE_MOCKS`; nothing here touches the network.
 */

/** A workflow's last-run outcome, for the list-row pill + detail header. */
export type WorkflowLastRunOutcome =
  | 'applied' // last run finished & applied changes (status ok)
  | 'held' // last run is parked at the approval gate (status warn)
  | 'running' // a run is in flight now
  | 'failed' // last run errored (status fail)
  | 'no-change' // last run found nothing to do (status idle)
  | 'never' // never run yet (empty)

/** Detail-page lifecycle state for a single workflow (the 5-state matrix). */
export type WorkflowDetailState =
  | 'idle' // last summary + next scheduled
  | 'empty' // never run — first-run CTA
  | 'running' // a run is in flight
  | 'held' // parked at the approval gate, pending decision
  | 'failed' // last run errored — plain-language + retry

/** How a workflow is triggered (drives the row's trigger label). */
export interface WorkflowTrigger {
  /** Machine kind — schedule, event, or manual-only. */
  kind: 'schedule' | 'event' | 'manual'
  /** Plain-language label, e.g. "Daily · 6:00 AM" or "On new lead". */
  label: string
}

/** One row in the WORKFLOWS list. */
export interface WorkflowListItem {
  id: string
  /** Display name, e.g. "Daily Pricing". */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  trigger: WorkflowTrigger
  /** Last-run outcome — drives the row's status pill. */
  lastRunOutcome: WorkflowLastRunOutcome
  /** Plain-language relative time of the last run, e.g. "Today, 6:02 AM". */
  lastRunAt?: string
  /** Pending approvals waiting on this workflow (drives the count chip). */
  pendingCount: number
  /** Whether the detail route is implemented (Daily Pricing is the worked one). */
  hasDetail: boolean
}

/**
 * A schedule representation for the ScheduleEditor.
 *
 * Carries BOTH a friendly daily-time view (for the time picker) and the raw cron
 * expression (for the power-user field). M2 ships editing DISABLED — the editor
 * renders read-only with an "editing coming soon" state until Schedules CRUD
 * (P5a) lands; this view is the single source for both controls so they never
 * diverge.
 */
export interface WorkflowSchedule {
  /** Owning workflow id. */
  workflowId: string
  /** True when the schedule is active (vs paused). */
  enabled: boolean
  /** Friendly local time-of-day, 24h `HH:mm`, for the daily-time picker. */
  dailyTime: string
  /** IANA timezone the schedule runs in. */
  timezone: string
  /** Raw cron expression (power-user field). */
  cron: string
  /** Plain-language summary, e.g. "Every day at 6:00 AM (America/Mexico_City)". */
  summary: string
  /** Plain-language next fire time, e.g. "Tomorrow, 6:00 AM". */
  nextRunAt?: string
}

/**
 * One node of the pipeline-flow graphic. The middle `approval-gate` node is the
 * amber gate — the only place a human decision sits in the run.
 */
export interface PipelineNode {
  id: string
  label: string
  /** `approval-gate` is the amber gate; others are auto stages. */
  kind: 'stage' | 'approval-gate'
  /** Sub-label, e.g. "Agent drafts prices" / "248 auto-applied". */
  detail?: string
}

/** The outcome breakdown a daily-pricing run produces (run-history columns). */
export interface RunOutcomeBreakdown {
  /** Total products analyzed this run. */
  analyzed: number
  /** Confident set auto-applied without review. */
  autoApplied: number
  /** Flagged rows a human approved. */
  approved: number
  /** Flagged rows a human rejected. */
  rejected: number
  /** Rows where no change was suggested. */
  noChange: number
}

/** One row of the run-history table — a contract `RunListItem` + the breakdown. */
export interface WorkflowRunHistoryRow {
  run: RunListItem
  /** Plain-language run date, e.g. "Jun 8, 2026 · 6:02 AM". */
  ranAt: string
  outcome: RunOutcomeBreakdown
}

/**
 * The Daily Pricing detail view model — everything the detail page needs in one
 * object so the page can switch on `state` and render the right surface.
 */
export interface WorkflowDetail {
  id: string
  name: string
  description: string
  trigger: WorkflowTrigger
  /** Which of the 5 states the worked example currently sits in. */
  state: WorkflowDetailState
  /** Today's status line, e.g. "316 analyzed · 248 auto-applied · 10 to review". */
  todayStatus: string
  /** Pending approvals waiting on this workflow (drives the held banner). */
  pendingCount: number
  schedule: WorkflowSchedule
  pipeline: PipelineNode[]
  /** The pipeline node currently active (highlighted in the graphic). */
  activeNodeId?: string
  history: WorkflowRunHistoryRow[]
}

const CONSUMER_ID = 'mipase'
const PRICING_WORKFLOW_ID = 'mipase.daily-pricing'

/** Build a contract `RunListItem` for a daily-pricing run-history row. */
function pricingRun(
  runId: string,
  status: RunStatus,
  createdAt: string,
  opts: { startedAt?: string; finishedAt?: string; parentRunId?: string | null } = {},
): RunListItem {
  return {
    runId,
    workflowId: PRICING_WORKFLOW_ID,
    status,
    consumerId: CONSUMER_ID,
    input: { scope: undefined, limit: undefined },
    output: status === 'succeeded' ? { applied: true } : null,
    error: null,
    traceId: `trace_${runId}`,
    idempotencyKey: null,
    parentRunId: opts.parentRunId ?? null,
    createdAt,
    startedAt: opts.startedAt ?? null,
    finishedAt: opts.finishedAt ?? null,
  }
}

/** The Daily Pricing pipeline — draft → [amber approval gate] → apply. */
const PRICING_PIPELINE: PipelineNode[] = [
  {
    id: 'draft',
    label: 'Draft',
    kind: 'stage',
    detail: 'Agent prices the catalog vs live competitors',
  },
  {
    id: 'approval-gate',
    label: 'Approval gate',
    kind: 'approval-gate',
    detail: 'You review flagged price changes',
  },
  {
    id: 'apply',
    label: 'Apply',
    kind: 'stage',
    detail: 'Approved prices write to Shopify (test store)',
  },
]

/** The Mi Pase daily-pricing schedule — "Daily 6AM", editing disabled in M2. */
const PRICING_SCHEDULE: WorkflowSchedule = {
  workflowId: PRICING_WORKFLOW_ID,
  enabled: true,
  dailyTime: '06:00',
  timezone: 'America/Mexico_City',
  cron: '0 6 * * *',
  summary: 'Every day at 6:00 AM (America/Mexico_City)',
  nextRunAt: 'Tomorrow, 6:00 AM',
}

/** Daily-pricing run history (most-recent first), typed against the contract. */
const PRICING_HISTORY: WorkflowRunHistoryRow[] = [
  {
    run: pricingRun('run_pricing_draft_9001', 'succeeded', '2026-06-08T12:02:00.000Z', {
      startedAt: '2026-06-08T12:02:04.000Z',
      finishedAt: '2026-06-08T12:18:41.000Z',
    }),
    ranAt: 'Jun 8, 2026 · 6:02 AM',
    outcome: { analyzed: 1284, autoApplied: 248, approved: 8, rejected: 2, noChange: 1026 },
  },
  {
    run: pricingRun('run_pricing_draft_8842', 'succeeded', '2026-06-07T12:01:00.000Z', {
      startedAt: '2026-06-07T12:01:05.000Z',
      finishedAt: '2026-06-07T12:16:22.000Z',
    }),
    ranAt: 'Jun 7, 2026 · 6:01 AM',
    outcome: { analyzed: 1281, autoApplied: 231, approved: 6, rejected: 1, noChange: 1043 },
  },
  {
    run: pricingRun('run_pricing_draft_8790', 'failed', '2026-06-06T12:00:00.000Z', {
      startedAt: '2026-06-06T12:00:06.000Z',
      finishedAt: '2026-06-06T12:04:12.000Z',
    }),
    ranAt: 'Jun 6, 2026 · 6:00 AM',
    outcome: { analyzed: 412, autoApplied: 0, approved: 0, rejected: 0, noChange: 0 },
  },
  {
    run: pricingRun('run_pricing_draft_8731', 'succeeded', '2026-06-05T12:02:00.000Z', {
      startedAt: '2026-06-05T12:02:03.000Z',
      finishedAt: '2026-06-05T12:15:58.000Z',
    }),
    ranAt: 'Jun 5, 2026 · 6:02 AM',
    outcome: { analyzed: 1277, autoApplied: 244, approved: 5, rejected: 0, noChange: 1028 },
  },
  {
    run: pricingRun('run_pricing_draft_8688', 'succeeded', '2026-06-04T12:01:00.000Z', {
      startedAt: '2026-06-04T12:01:07.000Z',
      finishedAt: '2026-06-04T12:14:30.000Z',
    }),
    ranAt: 'Jun 4, 2026 · 6:01 AM',
    outcome: { analyzed: 1274, autoApplied: 0, approved: 0, rejected: 0, noChange: 1274 },
  },
]

/**
 * The WORKFLOWS list for Mi Pase. Daily Pricing is the worked example (has a
 * detail page); the rest are list-only placeholders to show the row treatment
 * across trigger kinds + outcomes.
 */
export const MOCK_WORKFLOWS: WorkflowListItem[] = [
  {
    id: PRICING_WORKFLOW_ID,
    name: 'Daily Pricing',
    description: 'Re-prices the catalog against live competitors and gates flagged changes.',
    trigger: { kind: 'schedule', label: 'Daily · 6:00 AM' },
    lastRunOutcome: 'held',
    lastRunAt: 'Today, 6:02 AM',
    pendingCount: 10,
    hasDetail: true,
  },
  {
    id: 'mipase.competitor-watch',
    name: 'Competitor Watch',
    description: 'Tracks competitor metadata and flags large moves for awareness.',
    trigger: { kind: 'schedule', label: 'Daily · 7:00 AM' },
    lastRunOutcome: 'applied',
    lastRunAt: 'Today, 7:00 AM',
    pendingCount: 0,
    hasDetail: false,
  },
  {
    id: 'mipase.stock-sync',
    name: 'Stock Sync',
    description: 'Reconciles inventory counts between Shopify and the marketplaces.',
    trigger: { kind: 'event', label: 'On inventory change' },
    lastRunOutcome: 'no-change',
    lastRunAt: 'Today, 5:41 AM',
    pendingCount: 0,
    hasDetail: false,
  },
  {
    id: 'mipase.order-triage',
    name: 'Order Triage',
    description: 'Routes flagged orders for manual review before fulfillment.',
    trigger: { kind: 'manual', label: 'Manual only' },
    lastRunOutcome: 'never',
    pendingCount: 0,
    hasDetail: false,
  },
]

/** Today's status line for the Daily Pricing detail header. */
const TODAY_STATUS = '316 analyzed · 248 auto-applied · 10 to review'

/**
 * The Daily Pricing detail view model. Defaults to the `held` state — a run
 * finished and 10 flagged rows are parked at the approval gate, awaiting the
 * owner. Swap `state` (and `activeNodeId`) to preview the other states; the
 * helpers below build the canonical shape for each.
 */
export const MOCK_DAILY_PRICING_DETAIL: WorkflowDetail = {
  id: PRICING_WORKFLOW_ID,
  name: 'Daily Pricing',
  description:
    'Every morning the agent re-prices your catalog against live competitor data, ' +
    'auto-applies the confident set, and holds anything risky for your review.',
  trigger: { kind: 'schedule', label: 'Daily · 6:00 AM' },
  state: 'held',
  todayStatus: TODAY_STATUS,
  pendingCount: 10,
  schedule: PRICING_SCHEDULE,
  pipeline: PRICING_PIPELINE,
  activeNodeId: 'approval-gate',
  history: PRICING_HISTORY,
}

/**
 * Per-state variants of the Daily Pricing detail, so the detail page can preview
 * every state (idle / empty / running / held / failed) off one fixture set.
 */
export const MOCK_DAILY_PRICING_BY_STATE: Record<WorkflowDetailState, WorkflowDetail> = {
  held: MOCK_DAILY_PRICING_DETAIL,
  idle: {
    ...MOCK_DAILY_PRICING_DETAIL,
    state: 'idle',
    todayStatus: '316 analyzed · 256 auto-applied · 0 to review',
    pendingCount: 0,
    activeNodeId: 'apply',
  },
  running: {
    ...MOCK_DAILY_PRICING_DETAIL,
    state: 'running',
    todayStatus: 'Analyzing catalog… 412 of 316 priced',
    pendingCount: 0,
    activeNodeId: 'draft',
  },
  empty: {
    ...MOCK_DAILY_PRICING_DETAIL,
    state: 'empty',
    todayStatus: 'Not run yet',
    pendingCount: 0,
    activeNodeId: undefined,
    history: [],
  },
  failed: {
    ...MOCK_DAILY_PRICING_DETAIL,
    state: 'failed',
    todayStatus: 'Last run failed at 6:04 AM',
    pendingCount: 0,
    activeNodeId: 'draft',
  },
}
