import { randomUUID } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { EngineError } from '@godin-engine/contract'
import { db as defaultDb, schema } from '@godin-engine/db'

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
}

export function forConsumer(db: DbLike, consumerId: string): ScopedDb {
  const R = schema.engineRuns
  const A = schema.engineApprovals

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
  }
}

/**
 * resolveTenant(consumerId) seam (T2). For PR1 it ACCEPTS the existing mi-pase
 * tenant and any consumer present in SERVICE_KEYS. PR2 swaps the body for the
 * engine_tenants registry and rejects unknowns with TENANT_UNKNOWN. An empty
 * consumerId (a Privy principal that mapped to no tenant) is always unknown.
 */
export function resolveTenant(
  consumerId: string,
  knownConsumers: Set<string> = new Set(),
): { ok: true } | { ok: false } {
  if (!consumerId) return { ok: false }
  if (consumerId === 'mi-pase' || knownConsumers.has(consumerId)) return { ok: true }
  return { ok: false }
}
