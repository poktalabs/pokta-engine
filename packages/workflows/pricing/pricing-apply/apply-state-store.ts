/**
 * The `engine_workflow_state` read/checkpoint seam for `pricing-apply` (D5/D7).
 *
 * The draft's `state-store.ts` only ever *upserts desired* rows (status=pending).
 * Apply needs more: it must READ each SKU's current row (to know whether it is
 * already `applied` — resumability — and what the last applied price was — the
 * 1% anti-thrash baseline), and it must CHECKPOINT the status transition BEFORE
 * and AFTER each Shopify write (attempting → applied|failed|skipped).
 *
 * As with the draft store, `run()` stays testable without a live database: the
 * production store is built lazily via a dynamic import of `@pokta-engine/db`,
 * and tests inject a fake via `input.__applyStore`. Both share the logical
 * `'pricing'` workflow_id so apply reads exactly the rows the draft wrote.
 */

/** Logical workflow family used as the `engine_workflow_state.workflow_id` key. */
export const PRICING_WORKFLOW_ID = 'pricing'

/** Per-SKU status mirror of the `workflow_state_status` enum. */
export type ApplyStatus = 'pending' | 'attempting' | 'applied' | 'failed' | 'skipped'

/** The slice of a state row apply needs to make its decision. */
export interface ApplyStateRow {
  sku: string
  status: ApplyStatus
  /** Target price the draft computed (numeric → number; null = hold). */
  desiredPrice: number | null
  /** Price observed before any write (anti-thrash baseline fallback). */
  priorShopify: number | null
  /** The price we last attempted/applied (anti-thrash baseline when applied). */
  attemptedPrice: number | null
}

/** A checkpoint write — the status transition for one SKU. */
export interface ApplyCheckpoint {
  consumerId: string
  sku: string
  status: ApplyStatus
  /** The price we are attempting / applied (set on attempting + applied). */
  attemptedPrice?: number | null
  /** Reason text when status='failed' (cleared otherwise). */
  failureReason?: string | null
  /** The run that performed this transition. */
  sourceRunId: string
}

/** Narrow read+checkpoint seam over `engine_workflow_state` for apply (D7). */
export interface ApplyStateStore {
  /** Read the current rows for these SKUs (consumerId, 'pricing', sku). */
  readRows(consumerId: string, skus: string[]): Promise<Map<string, ApplyStateRow>>
  /** Persist one SKU's status transition (the before/after checkpoint). */
  checkpoint(cp: ApplyCheckpoint): Promise<void>
}

/** Parse a Drizzle numeric (string | null) to number | null. */
function num(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Build the production DB-backed apply store. Imported lazily so the workflow
 * module can be imported in tests without `DATABASE_URL`.
 */
export async function createDbApplyStateStore(): Promise<ApplyStateStore> {
  const { db, schema } = await import('@pokta-engine/db')
  const { and, eq, inArray } = await import('drizzle-orm')

  return {
    async readRows(consumerId, skus) {
      const out = new Map<string, ApplyStateRow>()
      if (skus.length === 0) return out
      const rows = await db
        .select()
        .from(schema.engineWorkflowState)
        .where(
          and(
            eq(schema.engineWorkflowState.consumerId, consumerId),
            eq(schema.engineWorkflowState.workflowId, PRICING_WORKFLOW_ID),
            inArray(schema.engineWorkflowState.sku, skus),
          ),
        )
      for (const r of rows) {
        out.set(r.sku, {
          sku: r.sku,
          status: r.status as ApplyStatus,
          desiredPrice: num(r.desiredPrice),
          priorShopify: num(r.priorShopify),
          attemptedPrice: num(r.attemptedPrice),
        })
      }
      return out
    },

    async checkpoint(cp) {
      // The desired row already exists (draft upserted it); apply only updates
      // the status / attempted / failure columns. Upsert defensively so an apply
      // that races ahead of a desired row still records its outcome.
      const set = {
        status: cp.status,
        attemptedPrice: cp.attemptedPrice == null ? null : String(cp.attemptedPrice),
        failureReason: cp.failureReason ?? null,
        sourceRunId: cp.sourceRunId,
        updatedAt: new Date(),
      }
      await db
        .insert(schema.engineWorkflowState)
        .values({
          consumerId: cp.consumerId,
          workflowId: PRICING_WORKFLOW_ID,
          sku: cp.sku,
          status: cp.status,
          attemptedPrice: set.attemptedPrice,
          failureReason: set.failureReason,
          sourceRunId: cp.sourceRunId,
          updatedAt: set.updatedAt,
        })
        .onConflictDoUpdate({
          target: [
            schema.engineWorkflowState.consumerId,
            schema.engineWorkflowState.workflowId,
            schema.engineWorkflowState.sku,
          ],
          set,
        })
    },
  }
}
