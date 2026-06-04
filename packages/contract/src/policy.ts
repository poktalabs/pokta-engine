import { z } from 'zod'

/**
 * Governance is a policy engine (D-7). A workflow declares zero or more policies
 * in its manifest; the control plane enforces them pre-dispatch. Quota and
 * Approval are the first two policy types. `run()` never sees these.
 */

export const quotaPolicySchema = z.object({
  kind: z.literal('quota'),
  perDay: z.number().int().positive(),
  scope: z.literal('consumer').default('consumer'),
  tier: z.string().default('free'),
})
export type QuotaPolicy = z.infer<typeof quotaPolicySchema>

export const approvalPolicySchema = z.object({
  kind: z.literal('approval'),
  /** Who may approve the gate, e.g. 'role:medic'. Recorded; identity binding is the consumer's job. */
  approver: z.string(),
  /** Workflow id dispatched when the gate is approved (D-8 chained run 2). */
  onApprove: z.string(),
})
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>

export const policySchema = z.discriminatedUnion('kind', [quotaPolicySchema, approvalPolicySchema])
export type Policy = z.infer<typeof policySchema>
