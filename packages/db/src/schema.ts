import { sql } from 'drizzle-orm'
import { pgTable, pgEnum, text, jsonb, integer, numeric, timestamp, uniqueIndex, index, primaryKey, check } from 'drizzle-orm/pg-core'

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
 *   - `branding` — typed against `TenantView.branding` in @pokta-engine/contract
 *     (`{ name: string; badge?: string }`); display-only, never authz.
 *   - `allowedWorkflows` — the per-tenant workflow allow-list. The control plane
 *     filters list surfaces by it and gates dispatch to it (a disallowed id is a
 *     404 SKILL_NOT_FOUND — anti-enumeration). Every id MUST exist in the workflow
 *     registry (validated on seed/save).
 *   - membership — the Privy DIDs allowed to act as this tenant live in the
 *     `engine_tenant_members` table (NOT a column here). A `mode==='privy'`
 *     principal resolves to the (unique) tenant whose membership row carries its DID
 *     (`UNIQUE(did)` makes that at most one); none → TENANT_UNKNOWN.
 *   - `secretPrefix` — ops-owned env-var prefix the worker uses to read this
 *     tenant's provider secrets (e.g. `MIPASE` → `MIPASE_SHOPIFY_*`). Charset
 *     `^[A-Z][A-Z0-9_]*$`, UNIQUE across tenants (validated on seed/save).
 *
 * `currency` / `locale` are ISO display hints only — never used for authz.
 */
export const tenantStatus = pgEnum('tenant_status', ['active', 'pending', 'disabled'])

/**
 * The per-user ROLE within a tenant (admin-roles Wave A / D1, D2). A platform
 * SUPERADMIN is a SEPARATE, cross-tenant grant (engine_superadmins) — NOT a value
 * here. Within a tenant a member is either an `admin` (manages the team: invites,
 * the 5-seat cap) or a plain `member`. An invite carries the role to GRANT on claim
 * (D2): claim binds the member with the invite's role.
 */
export const memberRole = pgEnum('member_role', ['admin', 'member'])

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
    secretPrefix: text('secret_prefix'), // ops-owned; ^[A-Z][A-Z0-9_]*$ + UNIQUE
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
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
 * Tenant membership (Wave 0 / D9) — the Privy DIDs allowed to act as a tenant.
 * Replaces the former `engine_tenants.members[]` array column with a real
 * `(tenant_id, did)` table so membership is queryable, auditable, and — crucially —
 * structurally constrained:
 *
 *   - `PK(tenant_id, did)` — a DID is listed at most once per tenant (idempotent add).
 *   - `UNIQUE(did)` (`tenant_members_did_unique`) — the GLOBAL DID-uniqueness guard:
 *     a DID belongs to AT MOST ONE tenant. This makes `findTenantByMember(did)`
 *     resolve to a single tenant structurally (no ambiguous >1 case is writable) and
 *     prevents a DID landing in two tenants (which would fail `resolveTenant` closed
 *     and lock a real user out).
 *   - `source` — provenance tag (e.g. 'seed') for ops/audit; not authz.
 *
 * FK → engine_tenants(tenant_id) ON DELETE CASCADE: dropping a tenant drops its
 * membership rows.
 */
export const engineTenantMembers = pgTable(
  'engine_tenant_members',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => engineTenants.tenantId, { onDelete: 'cascade' }),
    did: text('did').notNull(),
    source: text('source'),
    // The member's role WITHIN this tenant (admin-roles Wave A / D1). Defaults to
    // 'member' so every existing membership row backfills as a plain member; promote
    // to 'admin' is an explicit superadmin action (setMemberRole). NOT cross-tenant —
    // platform superadmin lives in engine_superadmins.
    role: memberRole('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.did] }),
    uniqueIndex('tenant_members_did_unique').on(t.did),
  ],
)

/**
 * Platform SUPERADMINS (admin-roles Wave A / D4) — the cross-tenant role dimension.
 * A DID with a row here is a platform superadmin: it passes requireTenantAdmin for
 * EVERY tenant and may grant the `admin` role on an invite, INDEPENDENT of any
 * tenant membership. ONE bootstrap DID is seeded once at deploy (insert-only, via the
 * migration); thereafter the operator break-glass path (OPERATOR_KEY) is the
 * documented recovery to add/fix a superadmin. Seats are NEVER read from this table
 * (Codex#11) — a platform-only superadmin with no member row consumes no tenant seat.
 */
export const engineSuperadmins = pgTable('engine_superadmins', {
  did: text('did').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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

/**
 * Tenant INVITES (Wave 1 / D1, D8) — the email-preauthorized first-login layer. An
 * operator seeds a tenant's verified-email allow-list here; on a Privy user's FIRST
 * login the engine matches their Privy-VERIFIED email against this table and binds
 * their DID into the tenant (`engine_tenant_members`), recording the claim. The
 * table — not env — is the source of truth (D7): env (`${secretPrefix}_INVITE_EMAILS`)
 * is a one-time INSERT-ONLY bootstrap; deprovisioning is a DB op (revoke), never an
 * env side effect.
 *
 *   - `PK(tenant_id, email)` — one invite row per (tenant, email).
 *   - `email CHECK (email = lower(email))` — emails are stored lowercased; ops SQL
 *     cannot insert a mixed-case/space variant that would dodge the match.
 *   - `status` — 'pending' (unclaimed) | 'claimed' (a DID bound it) | 'revoked'
 *     (deprovisioned; KEPT as an audit row, never deleted).
 *   - `claimed_by_did` / `claimed_at` — who claimed it and when (audit).
 *   - **partial unique index `tenant_invites_active_email` on (email) WHERE
 *     status != 'revoked'** (D8) — GLOBAL-unique ACTIVE email: a verified email maps
 *     to exactly ONE tenant, so the email alone determines the tenant (no hint, no
 *     confused-deputy). A revoked row frees the email to be re-invited elsewhere.
 *
 * FK → engine_tenants(tenant_id) ON DELETE CASCADE: dropping a tenant drops its
 * invites.
 */
export const inviteStatus = pgEnum('invite_status', ['pending', 'claimed', 'revoked'])

export const engineTenantInvites = pgTable(
  'engine_tenant_invites',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => engineTenants.tenantId, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    status: inviteStatus('status').notNull().default('pending'),
    // The role to grant the member on claim (D2). Defaults to 'member' so existing
    // rows backfill as plain members; only a superadmin may seed an 'admin' invite.
    role: memberRole('role').notNull().default('member'),
    // Minimal audit (Codex#15): which DID created this invite. Nullable so env/seed
    // rows (no human actor) and pre-existing rows are valid.
    invitedByDid: text('invited_by_did'),
    claimedByDid: text('claimed_by_did'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.email] }),
    // GLOBAL-unique ACTIVE email (D8): partial unique index so an email maps to at
    // most ONE non-revoked tenant invite. The WHERE clause is LOAD-BEARING — without
    // it a revoked invite would still block re-inviting the email elsewhere.
    uniqueIndex('tenant_invites_active_email')
      .on(t.email)
      .where(sql`${t.status} != 'revoked'`),
    // Emails are stored lowercased (parseInviteEmails lowercases+trims); this CHECK
    // is the DB backstop so ops SQL cannot insert a mixed-case variant that dodges
    // the verified-email match.
    check('engine_tenant_invites_email_lower', sql`${t.email} = lower(${t.email})`),
  ],
)
