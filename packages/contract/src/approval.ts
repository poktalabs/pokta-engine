import { z } from 'zod'

/**
 * The approval gate's lifecycle states — mirrors the DB `approval_state` enum
 * (`packages/db` `engine_approvals.state`). Kept in the contract so the SPA and
 * mocks share one source of truth.
 */
export const approvalStateSchema = z.enum(['pending', 'approved', 'rejected'])
export type ApprovalState = z.infer<typeof approvalStateSchema>

/**
 * The shape of each element in `GET /v1/approvals`'s `{ approvals: ApprovalView[] }`
 * envelope (engine-api/src/index.ts → `c.json({ approvals: rows })`, the raw
 * `engine_approvals` row serialized to JSON).
 *
 * `artifact` is **opaque per-workflow Zod input** — it is the draft run's output,
 * validated at approve-time against the onApprove target's `manifest.input`. The
 * dashboard MUST NOT bake a fixed shape (e.g. a 316-row pricing table) into the
 * contract; it discriminates on `workflowId` and the renderer owns the shape.
 *
 * Nullable columns (`decidedBy`, `decidedAt`, `dispatchedRunId`) are optional +
 * nullable to match Drizzle's JSON serialization of an un-decided pending row.
 *
 * NOTE: the route currently selects `approver` (who MAY approve, e.g. `role:medic`)
 * but the spec's reconciled view names it `approver?`. `decidedBy` is who DID
 * decide (recorded, not authenticated by the engine in M1; P5a-auth supplies the
 * real human identity from the Privy JWT).
 */
export interface ApprovalView {
  approvalId: string
  /** The draft run that opened this gate. */
  sourceRunId: string
  /** The onApprove target workflow — the renderer-selection discriminator. */
  workflowId: string
  /** Opaque per-workflow draft output; validated against the target manifest input. */
  artifact: unknown
  state: ApprovalState
  /** Who MAY approve (e.g. `role:medic`). */
  approver?: string
  /** Who DID decide — recorded (P5a-auth resolves the real human from the JWT). */
  decidedBy?: string | null
  /** ISO 8601; null while pending. */
  decidedAt?: string | null
  /** The child run created on approval; null until approved. */
  dispatchedRunId?: string | null
  /** ISO 8601. */
  createdAt: string
}

/** Response envelope for `GET /v1/approvals`. */
export interface ApprovalListResponse {
  approvals: ApprovalView[]
}

/**
 * Response of `POST /v1/approvals/:id/approve` — flips the gate and dispatches
 * the onApprove child run. May 409 with `APPROVAL_DENIED` if already decided.
 */
export interface ApproveResponse {
  approvalId: string
  state: 'approved'
  /** The dispatched child run id. */
  runId: string
}

/** Response of `POST /v1/approvals/:id/reject`. */
export interface RejectResponse {
  approvalId: string
  state: 'rejected'
}
