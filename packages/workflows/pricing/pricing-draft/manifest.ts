import { z } from 'zod'
import type { WorkflowManifest } from '@pokta-engine/contract'

/**
 * Mi Pase daily pricing — DRAFT step (agent runtime, M1 plan T7/T9).
 *
 * Reads the Shopify catalog + paces a Mercado Libre competitor lookup per SKU,
 * runs the validated pure pricing brain (match → 8-branch price → classify),
 * upserts each SKU's desired row into `engine_workflow_state` (status=pending),
 * and emits a COMPACT output split into `confident[]` and `flagged[]` subsets.
 *
 * On success two children fire INDEPENDENTLY (plan D1 + gate semantics):
 *   - `onComplete: pricing-apply-confident` — auto, NO gate; carries the
 *     CONFIDENT subset (high-confidence matches → apply straight through).
 *   - approval policy `onApprove: pricing-apply-flagged` — gated on role:owner;
 *     the gate artifact carries the FLAGGED subset (human reviews before apply).
 *
 * `timeoutMs` is generous (~20min) for one batch over ~316 SKUs with paced ML
 * lookups (plan D8 / T11); the reaper fails a run stranded past this.
 */
export const PRICING_DRAFT_TIMEOUT_MS = 1_200_000

export const pricingDraftInputSchema = z
  .object({
    /** Tenant whose catalog + integrations this run prices. From the run record. */
    consumerId: z.string().optional(),
    /** Optional category/vendor scope filter (substring match, M1 coarse). */
    scope: z.string().optional(),
    /** Optional cap on how many SKUs to price this run (smoke/partial runs). */
    limit: z.number().int().positive().optional(),
  })
  .passthrough()

export type PricingDraftInput = z.infer<typeof pricingDraftInputSchema>

const manifest: WorkflowManifest<PricingDraftInput> = {
  id: 'pricing-draft',
  version: '0.1.0',
  runtime: 'agent',
  timeoutMs: PRICING_DRAFT_TIMEOUT_MS,
  policy: [{ kind: 'approval', approver: 'role:owner', onApprove: 'pricing-apply-flagged' }],
  onComplete: 'pricing-apply-confident',
  input: pricingDraftInputSchema,
}

export default manifest
