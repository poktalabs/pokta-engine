import { z } from 'zod'
import type { WorkflowManifest } from '@godin-engine/contract'

/**
 * Mi Pase daily pricing — APPLY step (agent runtime, M1 plan T8).
 *
 * ONE shared run() impl, registered under TWO ids (plan / gate semantics):
 *   - `pricing-apply-confident` — the draft's `onComplete` child (auto, NO gate);
 *     applies the high-confidence subset straight through.
 *   - `pricing-apply-flagged`  — the draft's approval `onApprove` child; applies
 *     the human-reviewed flagged subset.
 *
 * Both receive the parent's matching price subset as input and walk it per SKU:
 *   - skip if |new − lastApplied| < 1% (anti-thrash, via engine_workflow_state)
 *   - state=attempting → ctx.integration('shopify').updateVariantPrice()
 *     → state=applied(ok) | failed(reason)   [checkpoint BEFORE + AFTER each write]
 * A single-SKU failure NEVER throws — it is recorded and the batch continues;
 * the run succeeds with a partial-outcome summary. A re-run retries ONLY rows
 * not already `applied` (idempotent, resumable — plan D7).
 *
 * Writes target the DEV store (plan D9); the per-tenant Shopify config the
 * resolver supplies for `mi-pase` points at the dev store.
 *
 * `timeoutMs` is a generous ~15min (plan D8 / T11). Apply is lighter than the
 * draft's ~20min: it does NO per-SKU ML lookup (the draft's latency driver) —
 * only the same paced Shopify writes (`SHOPIFY_PACE_MS` = the reused mi-pase
 * ml-batch 250ms sequential pacing). 316 paced writes ≈ 79s of pacing + per-write
 * latency, so 15min leaves wide headroom for retries/backoff while still being
 * tighter than the draft. The reaper fails a run stranded past this (+ grace).
 */
export const PRICING_APPLY_TIMEOUT_MS = 900_000

/** A single SKU's apply instruction (a slice of the draft's PricingSkuResult). */
const applySkuSchema = z
  .object({
    sku: z.string(),
    /** Shopify variant to write. */
    shopifyVariantId: z.number(),
    /** Target price (MXN). A null target is treated as a hold → skipped. */
    suggestedPriceMxn: z.number().nullable(),
    /** Price before our write (audit / anti-thrash baseline fallback). */
    currentPriceMxn: z.number().optional(),
  })
  .passthrough()

export const pricingApplyInputSchema = z
  .object({
    /** Tenant whose Shopify store this run writes to. From the run record. */
    consumerId: z.string().optional(),
    /**
     * The price set to apply — the draft's `confident[]` (for the confident
     * child) or `flagged[]` (for the flagged child). Each parent run's output
     * carries both subsets; the worker feeds the whole output as input, so we
     * also accept `confident` / `flagged` and pick the right one by manifest id.
     */
    skus: z.array(applySkuSchema).optional(),
    confident: z.array(applySkuSchema).optional(),
    flagged: z.array(applySkuSchema).optional(),
  })
  .passthrough()

export type PricingApplyInput = z.infer<typeof pricingApplyInputSchema>
export type ApplySku = z.infer<typeof applySkuSchema>

/** Build a manifest for one apply variant id (DRY across confident/flagged). */
function applyManifest(id: 'pricing-apply-confident' | 'pricing-apply-flagged'): WorkflowManifest<PricingApplyInput> {
  return {
    id,
    version: '0.1.0',
    runtime: 'agent',
    timeoutMs: PRICING_APPLY_TIMEOUT_MS,
    policy: [],
    input: pricingApplyInputSchema,
  }
}

export const pricingApplyConfidentManifest = applyManifest('pricing-apply-confident')
export const pricingApplyFlaggedManifest = applyManifest('pricing-apply-flagged')

export default pricingApplyConfidentManifest
