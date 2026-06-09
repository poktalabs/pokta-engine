import { z } from 'zod'

/**
 * The workspace WORKFLOW CARD (P5b) — the operator workspace's read model for a
 * dispatchable workflow FAMILY, NOT a raw manifest. A card is the engine-api-owned
 * catalog entry (id + display label + how it triggers) FOLDED with this tenant's
 * recent run/approval state:
 *
 *   - `id`               — the PARENT workflow id (e.g. `pricing-draft`). Gated
 *                          children (onComplete / onApprove targets) are FOLDED
 *                          into the parent card, never surfaced as standalone cards.
 *   - `displayName`      — human label from the engine-api card catalog (NOT a
 *                          manifest field — manifests carry no displayName/trigger).
 *   - `trigger`          — how the card is dispatched (e.g. `manual`).
 *   - `lastRun`          — the most-recent run across the family (any member id),
 *                          or `null` if the tenant has never run it.
 *   - `pendingApprovals` — count of pending gates across the family.
 *   - `hasDetail`        — whether the card has a drill-in detail surface.
 */
export const workflowCardSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  trigger: z.string(),
  lastRun: z
    .object({
      status: z.string(),
      at: z.string(),
    })
    .nullable(),
  pendingApprovals: z.number().int().nonnegative(),
  hasDetail: z.boolean(),
})
export type WorkflowCard = z.infer<typeof workflowCardSchema>

/** Response envelope for `GET /v1/workspace/workflows`. */
export const workspaceWorkflowsResponseSchema = z.object({
  workflows: z.array(workflowCardSchema),
})
export type WorkspaceWorkflowsResponse = z.infer<typeof workspaceWorkflowsResponseSchema>
