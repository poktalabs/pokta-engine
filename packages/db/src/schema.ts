import { pgTable, pgEnum, text, jsonb, integer, numeric, timestamp, uniqueIndex, index, primaryKey } from 'drizzle-orm/pg-core'

export const runStatus = pgEnum('run_status', ['queued', 'running', 'succeeded', 'failed'])
export const approvalState = pgEnum('approval_state', ['pending', 'approved', 'rejected'])
export const workflowStateStatus = pgEnum('workflow_state_status', [
  'pending',
  'attempting',
  'applied',
  'failed',
  'skipped',
])

/**
 * System-of-record (§4). The worker is the ONLY writer of post-enqueue status.
 * `parentRunId` links a chained run 2 (send/commit) back to its draft run 1 (D-8).
 */
export const engineRuns = pgTable(
  'engine_runs',
  {
    runId: text('run_id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    status: runStatus('status').notNull().default('queued'),
    consumerId: text('consumer_id').notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    error: jsonb('error'),
    traceId: text('trace_id').notNull(),
    idempotencyKey: text('idempotency_key'),
    parentRunId: text('parent_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('runs_status_idx').on(t.status),
    index('runs_consumer_idx').on(t.consumerId),
  ],
)

/**
 * Quota policy state (D-7). One row per (consumer, workflow, UTC day); a new day
 * is a new key, so the free quota "resets" with no cron. Locked FOR UPDATE in the
 * pre-dispatch transaction (D-5).
 */
export const engineQuotaLedger = pgTable(
  'engine_quota_ledger',
  {
    id: text('id').primaryKey(), // `${consumerId}:${workflowId}:${day}`
    consumerId: text('consumer_id').notNull(),
    workflowId: text('workflow_id').notNull(),
    day: text('day').notNull(), // UTC YYYY-MM-DD
    count: integer('count').notNull().default(0),
  },
  (t) => [uniqueIndex('quota_consumer_workflow_day').on(t.consumerId, t.workflowId, t.day)],
)

/**
 * Approval policy state — the first-class gate object (D-8). Opened by the worker
 * when an approval-policy workflow succeeds; flipped + dispatched by the control
 * plane's /v1/approvals/:id/approve route.
 */
export const engineApprovals = pgTable(
  'engine_approvals',
  {
    approvalId: text('approval_id').primaryKey(),
    sourceRunId: text('source_run_id').notNull(), // the draft run
    workflowId: text('workflow_id').notNull(), // onApprove target
    artifact: jsonb('artifact').notNull(), // the draft run's output, fed to run 2
    state: approvalState('state').notNull().default('pending'),
    approver: text('approver').notNull(), // who MAY approve (e.g. role:medic)
    decidedBy: text('decided_by'), // who DID (recorded, not authenticated by engine)
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    dispatchedRunId: text('dispatched_run_id'), // run 2, created on approval
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('approvals_state_idx').on(t.state)],
)

/**
 * Per-SKU desired/applied state for the pricing pipeline (D5/D7). The durable,
 * resumable record of what each SKU's target price is and how far its apply got.
 * Keyed by (consumer, workflow, sku) so a re-run upserts the same row and retries
 * only what `failed`. This is the 1% anti-thrash + resumability ledger; the run's
 * `output` stays a compact summary, the rich per-SKU truth lives here (D6).
 */
export const engineWorkflowState = pgTable(
  'engine_workflow_state',
  {
    consumerId: text('consumer_id').notNull(),
    workflowId: text('workflow_id').notNull(), // logical, e.g. 'pricing'
    sku: text('sku').notNull(),
    desiredPrice: numeric('desired_price'), // last computed target
    desiredHash: text('desired_hash'), // hash(inputs) — detect a stale desired
    priorShopify: numeric('prior_shopify'), // value before our write (rollback/audit)
    attemptedPrice: numeric('attempted_price'),
    status: workflowStateStatus('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    sourceRunId: text('source_run_id').notNull(), // which run last set this
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.consumerId, t.workflowId, t.sku] }),
    index('workflow_state_status_idx').on(t.status),
  ],
)
