/**
 * The `engine_workflow_state` write seam for the pricing workflows (D5/D7).
 *
 * `pricing-draft.run()` is otherwise PURE: every external read goes through
 * `ctx.integration(...)`. Its ONE durable side effect is upserting the per-SKU
 * "desired" rows into `engine_workflow_state` (status=pending, desiredPrice,
 * desiredHash, priorShopify). To keep `run()` testable WITHOUT a live database,
 * that write is performed through this narrow `WorkflowStateStore` interface
 * rather than importing `@pokta-engine/db` at the top of the workflow.
 *
 *   - In production the worker-invoked `run()` lazily builds the DB-backed store
 *     ({@link createDbWorkflowStateStore}) — a dynamic import so merely importing
 *     the workflow (e.g. from a test) never requires `DATABASE_URL`.
 *   - In tests, a fake store is injected via `input.__stateStore`, so the test
 *     can assert exactly which desired rows were upserted with zero DB.
 *
 * The logical `workflowId` written here is the family name `'pricing'` (NOT the
 * concrete `pricing-draft` id), so the draft and both apply children share the
 * same per-SKU row keyed by (consumerId, 'pricing', sku) — the plan's D5 key.
 */

import { createHash } from 'node:crypto'

/** Logical workflow family used as the `engine_workflow_state.workflow_id` key. */
export const PRICING_WORKFLOW_ID = 'pricing'

/** One per-SKU desired row to upsert (status forced to 'pending' by the store). */
export interface DesiredRow {
  consumerId: string
  sku: string
  /** Target price computed this run (null when the SKU is held / has no target). */
  desiredPrice: number | null
  /** Hash of the pricing inputs — lets a later run detect a stale desired. */
  desiredHash: string
  /** Shopify price observed before any write (rollback / audit). */
  priorShopify: number
  /** The run that produced this desired (engine_workflow_state.source_run_id). */
  sourceRunId: string
}

/** Narrow write seam over `engine_workflow_state` (D5). */
export interface WorkflowStateStore {
  /**
   * Upsert the desired rows for this run, each as status='pending'. Keyed by
   * (consumerId, 'pricing', sku); a re-run overwrites the same row. Idempotent.
   */
  upsertDesired(rows: DesiredRow[]): Promise<void>
}

/**
 * Canonical hash of the inputs that determined a SKU's desired price. Two runs
 * that see the same current/cost/competitor/margin produce the same hash, so a
 * later apply can tell whether the desired it holds is still current (D5).
 */
export function desiredHash(input: {
  sku: string
  currentPriceMxn: number
  costMxn: number | null
  competitorMinMxn: number | null
  marginFloorPct: number
}): string {
  const canonical = JSON.stringify([
    input.sku,
    input.currentPriceMxn,
    input.costMxn,
    input.competitorMinMxn,
    input.marginFloorPct,
  ])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * Build the production DB-backed store. Imported lazily (dynamic import) so the
 * workflow module can be imported in tests without `DATABASE_URL`. Upserts via
 * the (consumerId, workflowId, sku) primary key.
 */
export async function createDbWorkflowStateStore(): Promise<WorkflowStateStore> {
  const { db, schema } = await import('@pokta-engine/db')
  return {
    async upsertDesired(rows) {
      if (rows.length === 0) return
      for (const row of rows) {
        await db
          .insert(schema.engineWorkflowState)
          .values({
            consumerId: row.consumerId,
            workflowId: PRICING_WORKFLOW_ID,
            sku: row.sku,
            desiredPrice: row.desiredPrice == null ? null : String(row.desiredPrice),
            desiredHash: row.desiredHash,
            priorShopify: String(row.priorShopify),
            status: 'pending',
            failureReason: null,
            sourceRunId: row.sourceRunId,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              schema.engineWorkflowState.consumerId,
              schema.engineWorkflowState.workflowId,
              schema.engineWorkflowState.sku,
            ],
            set: {
              desiredPrice: row.desiredPrice == null ? null : String(row.desiredPrice),
              desiredHash: row.desiredHash,
              priorShopify: String(row.priorShopify),
              status: 'pending',
              failureReason: null,
              sourceRunId: row.sourceRunId,
              updatedAt: new Date(),
            },
          })
      }
    },
  }
}
