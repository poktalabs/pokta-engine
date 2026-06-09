import type { ApprovalListResponse, ApprovalView } from '@godin-engine/contract'
import { registerMock } from './registry'

/**
 * Approvals fixtures (M2 P2). Typed against the contract `ApprovalView` so the
 * mock layer and the real `GET /v1/approvals` envelope (`{ approvals }`) stay in
 * lockstep. `artifact` is OPAQUE per-workflow input — the renderer owns its
 * shape. These mocks model two tenants' artifact kinds:
 *
 *   - `mipase.daily-pricing` → a batch artifact (rows of price suggestions) for
 *     the BatchApprovalRenderer (P2-B). The row shape is derived from the
 *     daily-pricing workflow input, NOT a fixed 316-row table baked into the
 *     contract. We ship a representative slice including the specced edge cases.
 *   - `vino.*` → single-action artifacts (email send / CRM move / estimate
 *     commit) for the SingleActionRenderer (P2-C).
 *
 * Served only behind `VITE_USE_MOCKS` (see `lib/api.ts`).
 */

/** One row of the Mi Pase daily-pricing batch artifact (renderer-owned shape). */
export interface PricingRowDraft {
  id: string
  product: string
  sku: string
  category: string
  /** Current shelf price in tenant currency (MXN). */
  currentPrice: number
  /** Agent-suggested price. */
  suggestedPrice: number
  /** Percent delta, suggested vs current (may be negative). */
  deltaPct: number
  /** Lowest tracked competitor price, when available. */
  competitorRef?: number
  /** Resulting margin fraction (0–1) at the suggested price. */
  margin: number
  /** True when margin lands at/under the 15% floor — needs a floor treatment. */
  atFloor: boolean
  /** Plain-language reason the row was flagged for review. */
  whyFlagged: string
}

/** The Mi Pase batch artifact — what the daily-pricing draft run produced. */
export interface PricingBatchArtifact {
  kind: 'mipase.daily-pricing'
  /** Where applying these writes (the confirm-dialog target). */
  target: { channel: 'shopify'; store: string; testStore: boolean }
  rows: PricingRowDraft[]
}

const pricingRows: PricingRowDraft[] = [
  {
    id: 'row-1',
    product: 'Café de Olla Molido Tradicional Premium 1kg', // 40+ char name → tooltip
    sku: 'MP-CAFE-1KG',
    category: 'Despensa',
    currentPrice: 189,
    suggestedPrice: 169,
    deltaPct: -10.6,
    competitorRef: 165,
    margin: 0.28,
    atFloor: false,
    whyFlagged: 'Three competitors dropped below your price this week.',
  },
  {
    id: 'row-2',
    product: 'Miel de Agave Orgánica 500ml',
    sku: 'MP-AGAVE-500',
    category: 'Despensa',
    currentPrice: 95,
    suggestedPrice: 132,
    deltaPct: 38.9, // >30% Δ edge case
    competitorRef: 139,
    margin: 0.41,
    atFloor: false,
    whyFlagged: 'Underpriced vs market by more than 30% — room to raise.',
  },
  {
    id: 'row-3',
    product: 'Jabón Artesanal Lavanda',
    sku: 'MP-JABON-LAV',
    category: 'Cuidado personal', // mixed category
    currentPrice: 49,
    suggestedPrice: 45,
    deltaPct: -8.2,
    competitorRef: 44,
    margin: 0.15, // at-floor margin edge case
    atFloor: true,
    whyFlagged: 'Margin would land at the 15% floor — review before applying.',
  },
  {
    id: 'row-4',
    product: 'Chocolate de Mesa Abuelita 540g',
    sku: 'MP-CHOC-540',
    category: 'Despensa',
    currentPrice: 78,
    suggestedPrice: 78,
    deltaPct: 0,
    margin: 0.33,
    atFloor: false,
    whyFlagged: 'No change suggested — already aligned with the market.',
  },
  {
    id: 'row-5',
    product: 'Set de Toallas de Algodón',
    sku: 'MP-TOALLA-SET',
    category: 'Hogar', // mixed category
    currentPrice: 320,
    suggestedPrice: 289,
    deltaPct: -9.7,
    competitorRef: 279,
    margin: 0.22,
    atFloor: false,
    whyFlagged: 'Competitor flash sale detected; small cut keeps you competitive.',
  },
]

const mipaseBatch: ApprovalView = {
  approvalId: 'apr_mipase_pricing_001',
  sourceRunId: 'run_pricing_draft_8842',
  workflowId: 'mipase.daily-pricing',
  artifact: {
    kind: 'mipase.daily-pricing',
    target: { channel: 'shopify', store: 'mi-pase-test', testStore: true },
    rows: pricingRows,
  } satisfies PricingBatchArtifact,
  state: 'pending',
  approver: 'role:owner',
  decidedBy: null,
  decidedAt: null,
  dispatchedRunId: null,
  createdAt: '2026-06-08T12:00:00.000Z',
}

/** A single-action artifact (Vino) — drafted content awaiting one decision. */
export interface SingleActionArtifact {
  kind: 'vino.email-send' | 'vino.crm-move' | 'vino.estimate-commit'
  /** What the action does, in plain language. */
  what: string
  /** Where it lands (the integration target). */
  where: string
  /** Coarse risk tier — maps to the 3-tier RiskBadge scale (P1-C-risk). */
  risk: 'low' | 'medium' | 'high'
  /** Drafted content preview the operator reviews before approving. */
  preview: string
}

const vinoApprovals: ApprovalView[] = [
  {
    approvalId: 'apr_vino_email_001',
    sourceRunId: 'run_vino_emailtriage_311',
    workflowId: 'vino.email-send',
    artifact: {
      kind: 'vino.email-send',
      what: 'Send follow-up email to a warm lead',
      where: 'Gmail · sales@vinodesignbuild.com',
      risk: 'low',
      preview:
        'Hi Dana — thanks for the call. Attached is the scope summary we discussed; happy to walk through the estimate whenever works for you.',
    } satisfies SingleActionArtifact,
    state: 'pending',
    approver: 'role:owner',
    decidedBy: null,
    decidedAt: null,
    dispatchedRunId: null,
    createdAt: '2026-06-08T13:15:00.000Z',
  },
  {
    approvalId: 'apr_vino_crm_001',
    sourceRunId: 'run_vino_leadqual_287',
    workflowId: 'vino.crm-move',
    artifact: {
      kind: 'vino.crm-move',
      what: 'Move lead to "Proposal sent" stage',
      where: 'GoHighLevel · Pipeline / Residential',
      risk: 'medium',
      preview:
        'Lead "Riverside Kitchen Remodel" qualifies (budget confirmed, timeline Q3). Moving from Qualified → Proposal sent.',
    } satisfies SingleActionArtifact,
    state: 'pending',
    approver: 'role:owner',
    decidedBy: null,
    decidedAt: null,
    dispatchedRunId: null,
    createdAt: '2026-06-08T13:40:00.000Z',
  },
  {
    approvalId: 'apr_vino_estimate_001',
    sourceRunId: 'run_vino_proposal_209',
    workflowId: 'vino.estimate-commit',
    artifact: {
      kind: 'vino.estimate-commit',
      what: 'Commit drafted estimate to the client record',
      where: 'JobTread · Job #4471',
      risk: 'high',
      preview:
        'Estimate total $84,200 across 6 line items. Committing locks the figure into the client-facing proposal.',
    } satisfies SingleActionArtifact,
    state: 'pending',
    approver: 'role:owner',
    decidedBy: null,
    decidedAt: null,
    dispatchedRunId: null,
    createdAt: '2026-06-08T14:05:00.000Z',
  },
]

/** All pending approvals across the demo tenants. */
export const MOCK_APPROVALS: ApprovalView[] = [mipaseBatch, ...vinoApprovals]

registerMock('GET', '/v1/approvals', (): ApprovalListResponse => ({
  approvals: MOCK_APPROVALS,
}))
