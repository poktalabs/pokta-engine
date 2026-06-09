import { sql } from 'drizzle-orm'
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

/**
 * The tenant registry (PR2) — the SINGLE source of truth for tenancy. Each row's
 * `tenantId` IS the `consumer_id` used everywhere else for row scoping (e.g.
 * `mi-pase`). The engine resolves who a principal is, which workflows it may
 * dispatch, and which env secret-prefix the worker reads, from THIS table:
 *
 *   - `status` — only `'active'` tenants may resolve/dispatch (pending/disabled
 *     fail closed at resolveTenant + GET /v1/tenants/me).
 *   - `branding` — typed against `TenantView.branding` in @godin-engine/contract
 *     (`{ name: string; badge?: string }`); display-only, never authz.
 *   - `allowedWorkflows` — the per-tenant workflow allow-list. The control plane
 *     filters list surfaces by it and gates dispatch to it (a disallowed id is a
 *     404 SKILL_NOT_FOUND — anti-enumeration). Every id MUST exist in the workflow
 *     registry (validated on seed/save).
 *   - `members` — the Privy DIDs allowed to act as this tenant. A `mode==='privy'`
 *     principal resolves to the (unique) tenant whose `members[]` contains its DID;
 *     none → TENANT_UNKNOWN, multiple → ambiguous → TENANT_UNKNOWN.
 *   - `secretPrefix` — ops-owned env-var prefix the worker uses to read this
 *     tenant's provider secrets (e.g. `MIPASE` → `MIPASE_SHOPIFY_*`). Charset
 *     `^[A-Z][A-Z0-9_]*$`, UNIQUE across tenants (validated on seed/save).
 *
 * `currency` / `locale` are ISO display hints only — never used for authz.
 */
export const tenantStatus = pgEnum('tenant_status', ['active', 'pending', 'disabled'])

export const engineTenants = pgTable(
  'engine_tenants',
  {
    tenantId: text('tenant_id').primaryKey(), // == consumer_id, e.g. 'mi-pase'
    name: text('name').notNull(),
    status: tenantStatus('status').notNull().default('active'),
    currency: text('currency').notNull(), // ISO 4217 — DISPLAY only
    locale: text('locale').notNull(), // es-MX | en — DISPLAY only
    branding: jsonb('branding').notNull(), // typed vs TenantView.branding
    allowedWorkflows: text('allowed_workflows').array().notNull().default(sql`'{}'`),
    members: text('members').array().notNull().default(sql`'{}'`), // allowed Privy DIDs
    secretPrefix: text('secret_prefix'), // ops-owned; ^[A-Z][A-Z0-9_]*$ + UNIQUE
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tenants_members_idx').on(t.members),
    // secret_prefix UNIQUE at the DB (plan §4 + the column comment). Uniqueness was
    // previously enforced ONLY in validateSeeds() over the in-memory seed array; an
    // out-of-band INSERT/UPDATE could create two ACTIVE tenants sharing a prefix and
    // thus read each other's provider env (e.g. both 'MIPASE' → both read
    // MIPASE_SHOPIFY_ACCESS_TOKEN). The DB constraint makes that un-writable.
    // Postgres treats multiple NULLs as distinct, so the nullable column is fine.
    uniqueIndex('tenants_secret_prefix_unique').on(t.secretPrefix),
  ],
)

/**
 * Per-tenant integration CONNECTION status (P5b). The desired/actual wiring state
 * of each provider for a tenant, keyed `(tenant_id, integration_id)`. This is the
 * source of truth for `GET /v1/integrations` — NOT secrets (P5b dropped the
 * `secret_ref` column; provider secrets stay worker-only env, never here).
 *
 *   - `status` — 'enabled' (connected/active) | 'pending' (desired, not yet
 *     connected) | 'disabled' (explicitly off; the row is KEPT as audit, never
 *     deleted).
 *   - `connected_at` — set ONCE when the integration first goes 'enabled', then
 *     preserved; null while pending/disabled-from-the-start.
 *
 * FK → engine_tenants(tenant_id) ON DELETE CASCADE (Codex#5): dropping a tenant
 * drops its integration rows.
 */
export const integrationConnectionStatus = pgEnum('integration_connection_status', [
  'enabled',
  'pending',
  'disabled',
])

export const engineTenantIntegrations = pgTable(
  'engine_tenant_integrations',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => engineTenants.tenantId, { onDelete: 'cascade' }),
    integrationId: text('integration_id').notNull(),
    status: integrationConnectionStatus('status').notNull().default('pending'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.integrationId] })],
)
