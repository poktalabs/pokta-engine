import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { EngineError } from '@godin-engine/contract'
import type { WorkflowCard } from '@godin-engine/contract'
import { db as defaultDb, schema } from '@godin-engine/db'
import type { Consumer } from './auth'
import { findTenantByMember, getTenant, isActive, type TenantRow } from './tenants'

/**
 * forConsumer(db, consumerId) — the ONLY data path the /v1 routes use for
 * engine_runs / engine_approvals / engine_workflow_state (M1.5 / T2).
 *
 * Every accessor injects `consumer_id = <consumerId>` (or, for approvals, resolves
 * the tenant through the source run, since engine_approvals has NO consumer_id
 * column). A route can never read a raw, unscoped table here — the scoped object
 * exposes no raw `select`/`query`, so cross-tenant reads are structurally
 * unreachable. Cross-tenant resource ids resolve to `undefined`, which the route
 * maps to 404 (never 403 — we don't confirm existence to the wrong tenant).
 *
 * `db` is injected so tests can pass a mocked client; prod passes the real one.
 */

type DbLike = typeof defaultDb

export interface ScopedDb {
  readonly consumerId: string

  /** List this tenant's runs (optional status filter). */
  listRuns(opts?: { status?: string; limit?: number }): Promise<Array<typeof schema.engineRuns.$inferSelect>>
  /** Get one run by id, scoped — undefined if it belongs to another tenant. */
  getRun(runId: string): Promise<(typeof schema.engineRuns.$inferSelect) | undefined>
  /** Insert a run, FORCING this tenant's consumerId regardless of the values passed. */
  insertRun(values: Omit<typeof schema.engineRuns.$inferInsert, 'consumerId'>): Promise<void>

  /** List this tenant's approvals (resolved via source run; optional state/approver filters). */
  listApprovals(opts?: {
    state?: string
    approver?: string
    limit?: number
  }): Promise<Array<typeof schema.engineApprovals.$inferSelect>>
  /** Get one approval by id, scoped via its source run — undefined if cross-tenant. */
  getApproval(approvalId: string): Promise<(typeof schema.engineApprovals.$inferSelect) | undefined>

  /**
   * Dispatch a top-level run with quota enforcement, in one transaction (D-5).
   * Forces this tenant's consumerId on the ledger key AND the run row. Throws
   * EngineError('QUOTA_EXCEEDED') when over the daily limit.
   */
  dispatchRun(args: {
    workflowId: string
    input: unknown
    quotaPerDay?: number
  }): Promise<{ runId: string; traceId: string }>

  /**
   * Approve an approval (scoped): re-checks ownership + pending state under lock,
   * inserts the onApprove child run as THIS tenant, flips the gate. Binds
   * decidedBy to the caller's identity. Returns the child runId, or a typed
   * outcome for not-found / already-decided so the route can map status codes.
   */
  approve(args: {
    approvalId: string
    decidedBy: string
    childInput: unknown
  }): Promise<{ ok: true; runId: string } | { ok: false; reason: 'not-found' | string }>

  /** Reject an approval (scoped). Binds decidedBy. */
  reject(args: {
    approvalId: string
    decidedBy: string
  }): Promise<{ ok: true } | { ok: false; reason: 'not-found' }>

  /** This tenant's integration connection rows (P5b), scoped to consumerId. */
  listTenantIntegrations(): Promise<Array<typeof schema.engineTenantIntegrations.$inferSelect>>

  /**
   * This tenant's runs whose workflowId is in `workflowIds` (P5b workspace family
   * filter), newest first. Scoped to consumerId; an empty `workflowIds` → `[]`.
   */
  listRunsForWorkflows(
    workflowIds: string[],
    opts?: { limit?: number },
  ): Promise<Array<typeof schema.engineRuns.$inferSelect>>

  /**
   * Build the workspace workflow CARDS (P5b) for this tenant. Fetches the tenant's
   * recent runs ONCE and pending approvals ONCE (both scoped), then folds them in
   * memory per card — NO per-card query (no N+1). For each card: `lastRun` is the
   * newest run whose workflowId ∈ the card's family member ids (or null);
   * `pendingApprovals` is the count of pending approvals across the family.
   */
  workspaceWorkflowCards(
    cards: Array<{
      id: string
      displayName: string
      trigger: string
      memberWorkflowIds: string[]
      hasDetail: boolean
    }>,
  ): Promise<WorkflowCard[]>
}

export function forConsumer(db: DbLike, consumerId: string): ScopedDb {
  const R = schema.engineRuns
  const A = schema.engineApprovals
  const I = schema.engineTenantIntegrations

  async function getRun(runId: string) {
    return db.query.engineRuns.findFirst({
      where: and(eq(R.runId, runId), eq(R.consumerId, consumerId)),
    })
  }

  async function getApproval(approvalId: string) {
    const approval = await db.query.engineApprovals.findFirst({
      where: eq(A.approvalId, approvalId),
    })
    if (!approval) return undefined
    // engine_approvals has NO consumer_id — resolve the tenant via the source run.
    const sourceRun = await getRun(approval.sourceRunId)
    if (!sourceRun) return undefined // source run belongs to another tenant (or gone)
    return approval
  }

  return {
    consumerId,

    async listRuns(opts = {}) {
      const conds = [
        eq(R.consumerId, consumerId),
        opts.status ? eq(R.status, opts.status as 'queued') : undefined,
      ].filter(Boolean)
      return db
        .select()
        .from(R)
        .where(and(...(conds as [ReturnType<typeof eq>])))
        .orderBy(desc(R.createdAt))
        .limit(opts.limit ?? 100)
    },

    getRun,

    async insertRun(values) {
      await db.insert(R).values({ ...values, consumerId })
    },

    async listApprovals(opts = {}) {
      // Scope approvals to this tenant by joining through the source run's consumer_id.
      const conds = [
        eq(R.consumerId, consumerId),
        opts.state ? eq(A.state, opts.state as 'pending') : undefined,
        opts.approver ? eq(A.approver, opts.approver) : undefined,
      ].filter(Boolean)
      const rows = await db
        .select({ approval: A })
        .from(A)
        .innerJoin(R, eq(A.sourceRunId, R.runId))
        .where(and(...(conds as [ReturnType<typeof eq>])))
        .orderBy(desc(A.createdAt))
        .limit(opts.limit ?? 100)
      return rows.map((r) => r.approval)
    },

    getApproval,

    async dispatchRun({ workflowId, input, quotaPerDay }) {
      return db.transaction(async (tx) => {
        if (quotaPerDay != null) {
          const day = new Date().toISOString().slice(0, 10) // UTC day
          const ledgerId = `${consumerId}:${workflowId}:${day}`
          await tx.execute(sql`
            insert into engine_quota_ledger (id, consumer_id, workflow_id, day, count)
            values (${ledgerId}, ${consumerId}, ${workflowId}, ${day}, 0)
            on conflict (id) do nothing
          `)
          const locked = await tx.execute(
            sql`select count from engine_quota_ledger where id = ${ledgerId} for update`,
          )
          const current = Number((locked as unknown as Array<{ count: number }>)[0]?.count ?? 0)
          if (current >= quotaPerDay) {
            throw new EngineError('QUOTA_EXCEEDED', `daily limit of ${quotaPerDay} reached for '${workflowId}'`)
          }
          await tx.execute(sql`update engine_quota_ledger set count = count + 1 where id = ${ledgerId}`)
        }

        const runId = randomUUID()
        const traceId = randomUUID()
        await tx.insert(R).values({
          runId,
          workflowId,
          consumerId,
          input,
          traceId,
          status: 'queued',
        })
        return { runId, traceId }
      })
    },

    async approve({ approvalId, decidedBy, childInput }) {
      const approval = await getApproval(approvalId)
      if (!approval) return { ok: false, reason: 'not-found' }
      if (approval.state !== 'pending') return { ok: false, reason: `already ${approval.state}` }

      try {
        const child = await db.transaction(async (tx) => {
          const locked = await tx.execute(
            sql`select state from engine_approvals where approval_id = ${approvalId} for update`,
          )
          const state = (locked as unknown as Array<{ state: string }>)[0]?.state
          if (state !== 'pending') throw new EngineError('APPROVAL_DENIED', `already ${state}`)

          const childRunId = randomUUID()
          await tx.insert(R).values({
            runId: childRunId,
            workflowId: approval.workflowId,
            consumerId, // force THIS tenant on the dispatched child
            input: childInput,
            traceId: randomUUID(),
            parentRunId: approval.sourceRunId,
            status: 'queued',
          })
          await tx
            .update(A)
            .set({ state: 'approved', decidedBy, decidedAt: new Date(), dispatchedRunId: childRunId })
            .where(eq(A.approvalId, approvalId))
          return childRunId
        })
        return { ok: true, runId: child }
      } catch (e) {
        if (e instanceof EngineError) return { ok: false, reason: e.message }
        throw e
      }
    },

    async reject({ approvalId, decidedBy }) {
      // Ownership gate first: cross-tenant id is not visible -> not-found.
      const approval = await getApproval(approvalId)
      if (!approval) return { ok: false, reason: 'not-found' }
      const updated = await db
        .update(A)
        .set({ state: 'rejected', decidedBy, decidedAt: new Date() })
        .where(and(eq(A.approvalId, approvalId), eq(A.state, 'pending')))
        .returning({ approvalId: A.approvalId })
      if (updated.length === 0) return { ok: false, reason: 'not-found' }
      return { ok: true }
    },

    async listTenantIntegrations() {
      return db.select().from(I).where(eq(I.tenantId, consumerId))
    },

    async listRunsForWorkflows(workflowIds, opts = {}) {
      if (workflowIds.length === 0) return []
      return db
        .select()
        .from(R)
        .where(and(eq(R.consumerId, consumerId), inArray(R.workflowId, workflowIds)))
        .orderBy(desc(R.createdAt))
        .limit(opts.limit ?? 200)
    },

    async workspaceWorkflowCards(cards) {
      // ONE scoped runs read + ONE scoped pending-approvals read, folded in memory
      // (no per-card query → no N+1, Codex#10).
      const runs = await db
        .select()
        .from(R)
        .where(eq(R.consumerId, consumerId))
        .orderBy(desc(R.createdAt))
        .limit(200)
      const approvalRows = await db
        .select({ approval: A })
        .from(A)
        .innerJoin(R, eq(A.sourceRunId, R.runId))
        .where(and(eq(R.consumerId, consumerId), eq(A.state, 'pending')))
        .limit(200)
      const pendingApprovals = approvalRows.map((r) => r.approval)

      return cards.map((card) => {
        const members = new Set(card.memberWorkflowIds)
        // runs are already newest-first → the first match is the most recent.
        const last = runs.find((run) => members.has(run.workflowId))
        const pending = pendingApprovals.filter((a) => members.has(a.workflowId)).length
        return {
          id: card.id,
          displayName: card.displayName,
          trigger: card.trigger,
          lastRun: last
            ? {
                status: last.status,
                at: (last.createdAt instanceof Date ? last.createdAt.toISOString() : String(last.createdAt)),
              }
            : null,
          pendingApprovals: pending,
          hasDetail: card.hasDetail,
        }
      })
    },
  }
}

/** Outcome of resolving a principal to its tenant (PR2). */
export type ResolveTenantResult = { ok: true; tenant: TenantRow } | { ok: false }

/**
 * resolveTenant(consumer) — the tenancy seam (PR2), now backed by the
 * `engine_tenants` registry. It maps an AUTHENTICATED principal to its tenant ROW
 * and fails closed (`{ ok: false }` → the route raises TENANT_UNKNOWN) on anything
 * unresolvable. Two principal modes (see auth.ts):
 *
 *   - `service` — `consumer.id` IS the tenant id directly → `getTenant(id)`.
 *   - `privy`   — find the (unique) tenant whose `members[]` contains the verified
 *                 DID (`consumer.identity`). NONE → not-ok; MORE THAN ONE → reject
 *                 as ambiguous (not-ok) rather than guess a tenant.
 *
 * BOTH paths then require the tenant to EXIST and be `status==='active'`
 * (pending/disabled tenants never resolve). Returns the resolved row so callers
 * (dispatch allow-list, GET /v1/tenants/me) can read `allowedWorkflows`/branding
 * without a second registry hit.
 *
 * `db` is injectable so tests can pass a mock client; prod uses the default.
 */
export async function resolveTenant(consumer: Consumer, db: DbLike = defaultDb): Promise<ResolveTenantResult> {
  let row: TenantRow | undefined
  if (consumer.mode === 'service') {
    if (!consumer.id) return { ok: false }
    row = await getTenant(consumer.id, db)
  } else {
    // privy — membership lookup by the verified DID.
    if (!consumer.identity) return { ok: false }
    const found = await findTenantByMember(consumer.identity, db)
    if (!found || 'ambiguous' in found) return { ok: false } // none OR >1 → fail closed
    row = found
  }
  if (!row) return { ok: false }
  if (!isActive(row)) return { ok: false } // pending / disabled → fail closed
  return { ok: true, tenant: row }
}
