import type { ReactNode } from 'react'
import type { ApprovalView, ErrorEnvelope } from '@pokta-engine/contract'

/**
 * The Approvals renderer CONTRACT (M2 P2-A).
 *
 * The plan's central thesis: between tenants the ONLY thing that changes is the
 * `renderer` prop on `ApprovalQueueFrame`. Everything else — the 6-state machine,
 * the async approve/reject lifecycle, the batch action bar, focus management and
 * live-region announcements, the audit surface — lives in the frame.
 *
 * The frame owns the 6 lifecycle STATES; the renderer owns artifact PRESENTATION
 * + per-row selection. Mi Pase ships a `BatchApprovalRenderer` (the ~316-row
 * virtualized pricing table); Vino ships a `SingleActionRenderer` (focused card).
 * Both consume this one interface.
 */

/** The six lifecycle states the frame drives. The renderer never owns these. */
export type ApprovalQueueState =
  /** Idle queue with pending items shown; the operator is reviewing. */
  | 'default'
  /** No pending items — nothing to approve. */
  | 'empty'
  /** An approve/reject decision is in flight; the renderer is disabled. */
  | 'submitting'
  /** The whole batch (or single action) succeeded. */
  | 'success'
  /** Some items failed — `failedItemIds` lists exactly which. */
  | 'partial-failure'
  /** The operator rejected the batch (or single action). */
  | 'rejected'

/**
 * A decision the frame POSTs on behalf of the renderer. `artifactKind` mirrors
 * the workflow domain so the hook (P5b) can dispatch to the right endpoint;
 * `artifact` is the opaque per-workflow Zod input validated server-side at
 * approve-time (never a fixed dashboard shape).
 */
export interface DecisionRequest {
  /** The approvals included in this decision (one id for single-action). */
  approvalIds: string[]
  /** Renderer-selection discriminator (== workflow domain). */
  artifactKind: string
  /** Opaque per-workflow draft output(s); validated against the target manifest. */
  artifact: unknown
}

/**
 * Partial-failure payload. Uniform for batch (many ids) and single-action (one
 * id): the frame renders "Retry failed" against `failedItemIds`.
 */
export interface PartialFailure {
  failedItemIds: string[]
  errors: ErrorEnvelope[]
}

/**
 * Props the frame passes DOWN to every renderer. This is the swap seam: the
 * frame is renderer-agnostic and only ever talks through these props.
 */
export interface ApprovalRendererProps {
  /**
   * The pending approval items this renderer must present. For a batch renderer
   * these are the rows of one queue; for single-action, typically a single item
   * surfaced as a focused card.
   */
  items: ApprovalView[]
  /** Current lifecycle state — drives empty/success/rejected presentation hints. */
  state: ApprovalQueueState
  /** Per-row selection set (approval ids). Single-action keeps a one-item set. */
  selection: Set<string>
  /** Toggle a single item's selection. The frame re-renders with the new set. */
  onToggle(approvalId: string): void
  /** Approve the current selection (batch "Approve all & apply" / single Approve). */
  onApproveAll(): void
  /** Reject the current selection (batch reject / single Reject). */
  onReject(approvalId?: string): void
  /**
   * When the last decision partially failed, the ids that failed — so the
   * renderer can flag those exact rows. Empty otherwise.
   */
  failedItemIds: string[]
  /** True while a decision is in flight — the renderer disables its controls. */
  disabled: boolean
}

/**
 * A pluggable Approvals renderer. The frame selects one by `artifactKind`
 * (== the `ApprovalView.workflowId` domain) and hands it `ApprovalRendererProps`.
 */
export interface ApprovalRenderer {
  /** Selection discriminator — matched against the items' workflow domain. */
  artifactKind: string
  /**
   * When true, the renderer emits its OWN decision affordances (e.g. the batch
   * renderer's sticky apply bar + confirm dialog, or the single-action per-card
   * Approve/Reject). The frame then suppresses its generic action bar so the two
   * never duplicate. Defaults to false → the frame owns the action bar.
   */
  ownsActionBar?: boolean
  /** Render the artifact + selection UI for the given items. */
  render(props: ApprovalRendererProps): ReactNode
  /**
   * Build the decision payload the frame POSTs for the current selection.
   * `artifactKind` flows through so the hook can route to the right endpoint.
   */
  toDecisionPayload(selection: Set<string>, items: ApprovalView[]): DecisionRequest
}

/**
 * The async decision handler the frame invokes. Returns nothing on full success;
 * throws on full failure; resolves a `PartialFailure` when some items failed.
 * P2 ships a mock implementation; P5b swaps in the real `apiFetch` hook.
 */
export type DecisionHandler = (
  request: DecisionRequest,
  kind: 'approve' | 'reject',
) => Promise<PartialFailure | void>
