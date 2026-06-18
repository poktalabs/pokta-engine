import type { ErrorEnvelope, RunDetail } from '@pokta-engine/contract'

/**
 * Run-detail fixtures (M2 P3-B — the RUN DETAIL surface).
 *
 * The daily-pricing run produces an OPAQUE per-workflow `output` (the contract
 * types `RunDetail.output` as `unknown` and discriminates on `workflowId`). This
 * module derives a renderer-owned shape — `PricingRunOutput` — for the Mi Pase
 * `mipase.daily-pricing` run and embeds it as the run's `output`. It is NOT baked
 * into the contract; the RunDetail page narrows on `workflowId`.
 *
 * The surface answers one operator question: "what did the 6 AM run do, and what
 * still needs me?" → four stat tiles (analyzed / auto-applied / needs-review /
 * no-change), the amber "N prices need review" callout with the real flag-reason
 * copy, the collapsed confident set ("248 applied automatically · View all"),
 * and the no-change line. Served only behind `VITE_USE_MOCKS`.
 */

/** Why the agent held a price at the gate (matches the batch flag reasons). */
export type RunFlagReason = 'below-floor' | 'cost-unknown'

/** One flagged item summarized for the run-detail review callout. */
export interface RunFlaggedItem {
  /** Maps to the batch approval row id, so "Review" can deep-link. */
  rowId: string
  product: string
  reason: RunFlagReason
  /** Plain-language, operator-facing flag copy. */
  reasonDetail: string
}

/** One confident (auto-applied) item shown when the collapsed set expands. */
export interface RunAppliedItem {
  rowId: string
  product: string
  sku: string
  /** Old shelf price in tenant currency (MXN). */
  previousPrice: number
  /** New applied price (MXN). */
  appliedPrice: number
  /** Signed percent delta, applied vs previous. */
  deltaPct: number
}

/**
 * Renderer-owned daily-pricing run output. Embedded as `RunDetail.output` for the
 * `mipase.daily-pricing` workflow; the page narrows on `workflowId` to read it.
 */
export interface PricingRunOutput {
  kind: 'mipase.daily-pricing'
  /** Where the run wrote (drives the gate / target copy). */
  target: { channel: 'shopify'; store: string; testStore: boolean }
  /** Total catalog products the run analyzed. */
  analyzedCount: number
  /** Confident set: applied automatically without review. */
  autoAppliedCount: number
  /** Flagged: held at the gate, awaiting a human decision. */
  needsReviewCount: number
  /** Already-optimal: the agent suggested no change. */
  noChangeCount: number
  /** The approval the gate is holding (links the "Re-run" / review path). */
  pendingApprovalId: string
  /** A representative slice of the flagged items (full set lives in Approvals). */
  flagged: RunFlaggedItem[]
  /** A representative slice of the confident set (full set behind "View all"). */
  applied: RunAppliedItem[]
}

const flagged: RunFlaggedItem[] = [
  {
    rowId: 'row-bide-nuur',
    product: 'Bidé Nuur Eléctrico con Control Remoto',
    reason: 'cost-unknown',
    reasonDetail:
      'Supplier cost missing for this SKU — margin can’t be verified. Hold unless you confirm cost.',
  },
  {
    rowId: 'row-moto-italika',
    product: 'Motocicleta Italika FT150 Negra 2025',
    reason: 'below-floor',
    reasonDetail:
      'Matching Coppel’s price would drop margin to 12% — under the 15% floor.',
  },
  {
    rowId: 'row-perfume-carolina',
    product: 'Perfume Carolina Herrera Good Girl EDP 80ml',
    reason: 'below-floor',
    reasonDetail:
      'Price match lands margin exactly at the 15% floor — confirm before applying.',
  },
  {
    rowId: 'row-iphone-se',
    product: 'Apple iPhone SE 2022 128GB Medianoche',
    reason: 'below-floor',
    reasonDetail:
      'Matching the live Mercado Libre floor would push margin to 13% — under the 15% floor.',
  },
]

const applied: RunAppliedItem[] = [
  {
    rowId: 'row-iphone-15-pro',
    product: 'Apple iPhone 15 Pro 256GB Titanio Natural',
    sku: 'MP-APL-IP15P-256-TN',
    previousPrice: 25999,
    appliedPrice: 24499,
    deltaPct: -5.8,
  },
  {
    rowId: 'row-moto-vento',
    product: 'Motocicleta Vento Nitrox 250 Roja',
    sku: 'MP-VNT-NITROX250-RD',
    previousPrice: 32990,
    appliedPrice: 30990,
    deltaPct: -6.1,
  },
  {
    rowId: 'row-colchon-king',
    product: 'Colchón Matrimonial Memory Foam King Size 200x200',
    sku: 'MP-COL-MEMF-KING',
    previousPrice: 8990,
    appliedPrice: 12490,
    deltaPct: 38.9,
  },
  {
    rowId: 'row-perfume-dior',
    product: 'Perfume Dior Sauvage EDT 100ml',
    sku: 'MP-DIOR-SVG-EDT100',
    previousPrice: 3290,
    appliedPrice: 3590,
    deltaPct: 9.1,
  },
  {
    rowId: 'row-perfume-paco',
    product: 'Perfume Paco Rabanne 1 Million EDT 100ml',
    sku: 'MP-PR-1M-EDT100',
    previousPrice: 2190,
    appliedPrice: 2090,
    deltaPct: -4.6,
  },
]

const pricingOutput: PricingRunOutput = {
  kind: 'mipase.daily-pricing',
  target: { channel: 'shopify', store: 'mi-pase-test', testStore: true },
  analyzedCount: 1284,
  autoAppliedCount: 248,
  needsReviewCount: 6,
  noChangeCount: 1030,
  pendingApprovalId: 'apr_mipase_pricing_batch_001',
  flagged,
  applied,
}

/**
 * DEFAULT state — a completed run holding prices at the gate.
 *
 * The run itself `succeeded` (the agent finished), but its output holds N prices
 * for human review, so the surface shows the HELD-AT-GATE pill + Re-run. Analyzed
 * = auto-applied + needs-review + no-change (248 + 6 + 1030 = 1284).
 */
export const MOCK_RUN_DETAIL: RunDetail = {
  runId: 'run_pricing_draft_9001',
  workflowId: 'mipase.daily-pricing',
  status: 'succeeded',
  consumerId: 'consumer_mipase',
  input: { schedule: 'daily-0600', channel: 'shopify' },
  output: pricingOutput,
  error: null,
  traceId: 'trace_pricing_9001',
  idempotencyKey: 'mipase-pricing-2026-06-08',
  parentRunId: null,
  createdAt: '2026-06-08T12:00:04.000Z',
  startedAt: '2026-06-08T12:00:05.000Z',
  finishedAt: '2026-06-08T12:01:48.000Z',
}

/** Read the renderer-owned pricing output off a daily-pricing run (typed narrow). */
export function getPricingOutput(run: RunDetail): PricingRunOutput | null {
  if (run.workflowId !== 'mipase.daily-pricing') return null
  return (run.output ?? null) as PricingRunOutput | null
}

/**
 * PARTIAL-FAILURE state — the same run, but applying the confident set hit a
 * provider error on a subset of items. The run `failed`; `error` carries the
 * envelope; the output still reports what landed before the failure (fewer
 * auto-applied, the failed items moved back into the held set). The surface
 * shows the failure banner + the failed items + a Retry path.
 */
export const PARTIAL_FAILURE_ERROR: ErrorEnvelope = {
  code: 'SKILL_EXEC_ERROR',
  message:
    'Shopify rejected 3 price updates (test store rate limit). The other prices applied; the 3 are queued to retry.',
  retryable: true,
}

const partialFailureOutput: PricingRunOutput = {
  ...pricingOutput,
  autoAppliedCount: 245,
  needsReviewCount: 9,
  flagged: [
    {
      rowId: 'row-iphone-15-pro',
      product: 'Apple iPhone 15 Pro 256GB Titanio Natural',
      reason: 'below-floor',
      reasonDetail:
        'Shopify rejected this update (rate limit). Price unchanged — retry to apply.',
    },
    {
      rowId: 'row-moto-vento',
      product: 'Motocicleta Vento Nitrox 250 Roja',
      reason: 'below-floor',
      reasonDetail:
        'Shopify rejected this update (rate limit). Price unchanged — retry to apply.',
    },
    {
      rowId: 'row-perfume-dior',
      product: 'Perfume Dior Sauvage EDT 100ml',
      reason: 'below-floor',
      reasonDetail:
        'Shopify rejected this update (rate limit). Price unchanged — retry to apply.',
    },
    ...flagged,
  ],
}

export const MOCK_RUN_DETAIL_PARTIAL_FAILURE: RunDetail = {
  ...MOCK_RUN_DETAIL,
  runId: 'run_pricing_draft_9002',
  status: 'failed',
  output: partialFailureOutput,
  error: PARTIAL_FAILURE_ERROR,
  traceId: 'trace_pricing_9002',
  finishedAt: '2026-06-08T12:02:11.000Z',
}

/** The rowIds that failed to apply (drives the "Retry failed" affordance). */
export const PARTIAL_FAILURE_FAILED_ROW_IDS: string[] = [
  'row-iphone-15-pro',
  'row-moto-vento',
  'row-perfume-dior',
]
