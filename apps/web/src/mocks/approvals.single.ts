import type { ApprovalListResponse, ApprovalView } from '@pokta-engine/contract'

/**
 * Vino SINGLE-ACTION approval fixtures (M2 P2-C).
 *
 * The companion to `approvals.ts`'s batch fixture: where Mi Pase ships a ~316-row
 * pricing table, Vino ships a handful of high-stakes, one-at-a-time decisions.
 * Each is typed against the contract `ApprovalView`, with an OPAQUE per-workflow
 * `artifact` whose shape the `SingleActionRenderer` (not the contract) owns.
 *
 * These mirror the three Vino artifact kinds the renderer presents:
 *   - `vino.email-send`     → a drafted follow-up email (editable preview)
 *   - `vino.crm-move`       → a CRM stage move (Qualified → next stage)
 *   - `vino.estimate-commit`→ a JobTread estimate commit ($48,500 USD)
 *
 * Mock-only: the Vino workflows aren't implemented in `workflows/` yet, so these
 * artifact shapes are illustrative (flagged per the plan's P2-A note). Served
 * only behind `VITE_USE_MOCKS`.
 *
 * Exported (not self-registered) so it does NOT collide with the base
 * `GET /v1/approvals` route in `approvals.ts`. A future Vino-tenant fixture (or a
 * Storybook/page harness) composes these into a queue via the helper below.
 */

/** The single-action artifact shape the SingleActionRenderer presents. */
export interface SingleActionArtifact {
  kind: 'vino.email-send' | 'vino.crm-move' | 'vino.estimate-commit'
  /** What the action does, in plain language. */
  what: string
  /** Where it lands (the integration target). */
  where: string
  /** Coarse risk tier — maps to the 3-tier risk scale (P1-C-risk, no new color). */
  risk: 'low' | 'medium' | 'high'
  /** Drafted content the operator reviews before approving. */
  preview: string
  /** Plain-language reason the agent drafted this action. */
  why?: string
}

/** The three Vino single-action approvals (one focused card each). */
export const MOCK_VINO_APPROVALS: ApprovalView[] = [
  {
    approvalId: 'apr_vino_email_900',
    sourceRunId: 'run_vino_emailtriage_512',
    workflowId: 'vino.email-send',
    artifact: {
      kind: 'vino.email-send',
      what: 'Send follow-up email to a warm lead',
      where: 'Gmail · sales@vinodesignbuild.com → dana.keller@example.com',
      risk: 'low',
      why: 'Lead went quiet 6 days after the site visit; a nudge keeps the deal warm.',
      preview:
        'Hi Dana,\n\nThanks again for walking us through the space last week — the corner pantry idea is going to make the whole kitchen feel twice as big.\n\nI’ve attached the scope summary we discussed. Whenever you have ten minutes, I’d love to walk you through the estimate and answer any questions.\n\nBest,\nMarco — Vino Design + Build',
    } satisfies SingleActionArtifact,
    state: 'pending',
    approver: 'role:owner',
    decidedBy: null,
    decidedAt: null,
    dispatchedRunId: null,
    createdAt: '2026-06-08T15:05:00.000Z',
  },
  {
    approvalId: 'apr_vino_crm_900',
    sourceRunId: 'run_vino_leadqual_488',
    workflowId: 'vino.crm-move',
    artifact: {
      kind: 'vino.crm-move',
      what: 'Move lead to "Qualified" stage',
      where: 'JobTread CRM · Pipeline / Residential',
      risk: 'medium',
      why: 'Budget confirmed ($40k–$55k), timeline is Q3, and decision-maker is identified — meets all Qualified criteria.',
      preview:
        'Lead "Riverside Kitchen Remodel" — moving New inquiry → Qualified. Budget $40k–$55k, timeline Q3 2026, contact: Dana Keller (homeowner, sole decision-maker).',
    } satisfies SingleActionArtifact,
    state: 'pending',
    approver: 'role:owner',
    decidedBy: null,
    decidedAt: null,
    dispatchedRunId: null,
    createdAt: '2026-06-08T15:20:00.000Z',
  },
  {
    approvalId: 'apr_vino_estimate_900',
    sourceRunId: 'run_vino_proposal_433',
    workflowId: 'vino.estimate-commit',
    artifact: {
      kind: 'vino.estimate-commit',
      what: 'Commit drafted estimate to the client record',
      where: 'JobTread · Job #4471 — Riverside Kitchen Remodel',
      risk: 'high',
      why: 'Committing locks the figure into the client-facing proposal — review the line totals before approving.',
      preview: [
        'Estimate total: $48,500 USD',
        '',
        '  Demolition & disposal            $4,200',
        '  Cabinetry (custom maple)        $18,900',
        '  Quartz countertops               $7,600',
        '  Plumbing & fixtures              $6,300',
        '  Electrical & lighting            $5,100',
        '  Tile, paint & finish work        $6,400',
        '',
        '  Subtotal                        $48,500',
      ].join('\n'),
    } satisfies SingleActionArtifact,
    state: 'pending',
    approver: 'role:owner',
    decidedBy: null,
    decidedAt: null,
    dispatchedRunId: null,
    createdAt: '2026-06-08T15:40:00.000Z',
  },
]

/** The `GET /v1/approvals` envelope scoped to Vino's single-action queue. */
export const mockVinoApprovalListResponse: ApprovalListResponse = {
  approvals: MOCK_VINO_APPROVALS,
}
