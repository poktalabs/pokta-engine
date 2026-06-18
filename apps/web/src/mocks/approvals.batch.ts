import type { ApprovalView } from '@pokta-engine/contract'

/**
 * Mi Pase BATCH approval fixtures (M2 P2-B — the hero).
 *
 * High-mix Mexican catalog price-review rows for the `BatchApprovalRenderer`.
 * Typed against the contract `ApprovalView`; the batch `artifact` is the OPAQUE
 * per-workflow draft the daily-pricing run produced. The row shape is derived
 * from the daily-pricing workflow's input domain (product / sku / category /
 * current / suggested / Δ / competitor ref / margin / floor / why-flagged) — it
 * is NOT a fixed table baked into the contract; the renderer owns it.
 *
 * The set is intentionally high-mix (iPhone, bidé Nuur, motos, colchones,
 * perfumes, despensa, hogar) and exercises every renderer treatment:
 *   - cost-unknown anomaly (margin can't be computed → BELOW FLOOR caution)
 *   - below-15%-floor anomaly (margin lands at/under the floor)
 *   - >30% Δ raise, deep cut, no-change row
 *   - a 40+ char product name (truncation + title tooltip)
 *   - rows with / without a competitor reference (Mercado Libre LIVE badge)
 *
 * Currency is MXN (Mi Pase tenant). Served only behind `VITE_USE_MOCKS`.
 */

/** The two flag reasons the daily-pricing agent emits (per the wireframe). */
export type FlagReason = 'below-floor' | 'cost-unknown'

/** One row of the Mi Pase daily-pricing batch artifact (renderer-owned shape). */
export interface BatchPricingRow {
  id: string
  /** Display name (may exceed 40 chars → renderer truncates + adds a title). */
  product: string
  sku: string
  category: string
  /** Current shelf price in tenant currency (MXN). */
  currentPrice: number
  /** Agent-suggested price (MXN). */
  suggestedPrice: number
  /** Percent delta, suggested vs current (signed). */
  deltaPct: number
  /** Lowest tracked competitor price (MXN), when a live reference exists. */
  competitorRef?: number
  /** Competitor source label — only Mercado Libre is a LIVE feed today. */
  competitorSource?: 'Mercado Libre' | 'Coppel' | 'Liverpool' | 'Amazon MX'
  /** True when `competitorSource` is a real-time feed (drives the LIVE badge). */
  competitorLive?: boolean
  /**
   * Resulting gross margin fraction (0–1) at the suggested price, or `null` when
   * cost is unknown and margin can't be computed (the cost-unknown anomaly).
   */
  margin: number | null
  /** True when margin lands at/under the 15% floor — needs the FLOOR treatment. */
  belowFloor: boolean
  /** Why the agent flagged this row for human review. */
  reason: FlagReason
  /** Plain-language elaboration shown in the Why-flagged column. */
  reasonDetail: string
}

/** The Mi Pase batch artifact — what the daily-pricing draft run produced. */
export interface BatchPricingArtifact {
  kind: 'mipase.daily-pricing'
  /** Where applying these writes (the confirm-dialog target). */
  target: { channel: 'shopify'; store: string; testStore: boolean }
  /** Total products the run analyzed (the flagged rows are a subset). */
  analyzedCount: number
  /** Products auto-applied without review (confident set — shown as context). */
  autoAppliedCount: number
  /** The flagged rows that need a human decision. */
  rows: BatchPricingRow[]
}

/** The 15% gross-margin floor the agent enforces (shared with the renderer). */
export const MARGIN_FLOOR = 0.15

const rows: BatchPricingRow[] = [
  {
    id: 'row-iphone-15-pro',
    product: 'Apple iPhone 15 Pro 256GB Titanio Natural (Liberado)', // 40+ chars → tooltip
    sku: 'MP-APL-IP15P-256-TN',
    category: 'Electrónica',
    currentPrice: 25999,
    suggestedPrice: 24499,
    deltaPct: -5.8,
    competitorRef: 24190,
    competitorSource: 'Mercado Libre',
    competitorLive: true,
    margin: 0.19,
    belowFloor: false,
    reason: 'below-floor',
    reasonDetail:
      'Three sellers undercut you on Mercado Libre this week; cut keeps margin above floor.',
  },
  {
    id: 'row-bide-nuur',
    product: 'Bidé Nuur Eléctrico con Control Remoto',
    sku: 'MP-NUUR-BIDE-RC',
    category: 'Hogar',
    currentPrice: 4299,
    suggestedPrice: 4299,
    deltaPct: 0,
    competitorRef: undefined,
    margin: null, // cost-unknown anomaly → margin can't be computed
    belowFloor: true, // surfaced as a caution because margin is unknowable
    reason: 'cost-unknown',
    reasonDetail:
      'Supplier cost missing for this SKU — margin can’t be verified. Hold unless you confirm cost.',
  },
  {
    id: 'row-moto-italika',
    product: 'Motocicleta Italika FT150 Negra 2025',
    sku: 'MP-ITK-FT150-BK',
    category: 'Vehículos',
    currentPrice: 24990,
    suggestedPrice: 23490,
    deltaPct: -6.0,
    competitorRef: 23299,
    competitorSource: 'Coppel',
    competitorLive: false, // Coppel is a periodic scrape, not a live feed
    margin: 0.12, // below the 15% floor
    belowFloor: true,
    reason: 'below-floor',
    reasonDetail:
      'Matching Coppel’s price would drop margin to 12% — under the 15% floor. Review before applying.',
  },
  {
    id: 'row-colchon-king',
    product: 'Colchón Matrimonial Memory Foam Ortopédico King Size 200x200', // 40+ chars → tooltip
    sku: 'MP-COL-MEMF-KING',
    category: 'Hogar',
    currentPrice: 8990,
    suggestedPrice: 12490,
    deltaPct: 38.9, // >30% Δ raise
    competitorRef: 13200,
    competitorSource: 'Liverpool',
    competitorLive: false,
    margin: 0.44,
    belowFloor: false,
    reason: 'below-floor',
    reasonDetail:
      'Underpriced vs market by >30% — room to raise while staying below Liverpool.',
  },
  {
    id: 'row-perfume-carolina',
    product: 'Perfume Carolina Herrera Good Girl EDP 80ml',
    sku: 'MP-CH-GG-EDP80',
    category: 'Belleza',
    currentPrice: 2890,
    suggestedPrice: 2590,
    deltaPct: -10.4,
    competitorRef: 2549,
    competitorSource: 'Mercado Libre',
    competitorLive: true,
    margin: 0.15, // sits exactly at the floor (edge case)
    belowFloor: true,
    reason: 'below-floor',
    reasonDetail:
      'Price match lands margin exactly at the 15% floor — confirm before applying.',
  },
  {
    id: 'row-perfume-paco',
    product: 'Perfume Paco Rabanne 1 Million EDT 100ml',
    sku: 'MP-PR-1M-EDT100',
    category: 'Belleza',
    currentPrice: 2190,
    suggestedPrice: 2190,
    deltaPct: 0,
    competitorRef: 2199,
    competitorSource: 'Amazon MX',
    competitorLive: false,
    margin: 0.31,
    belowFloor: false,
    reason: 'cost-unknown',
    reasonDetail:
      'No change suggested, but a recent restock has unconfirmed landed cost — flagged for awareness.',
  },
  {
    id: 'row-moto-vento',
    product: 'Motocicleta Vento Nitrox 250 Roja',
    sku: 'MP-VNT-NITROX250-RD',
    category: 'Vehículos',
    currentPrice: 32990,
    suggestedPrice: 30990,
    deltaPct: -6.1,
    competitorRef: 30490,
    competitorSource: 'Mercado Libre',
    competitorLive: true,
    margin: 0.21,
    belowFloor: false,
    reason: 'below-floor',
    reasonDetail:
      'Live Mercado Libre listings dropped; trim keeps you competitive with healthy margin.',
  },
  {
    id: 'row-colchon-indiv',
    product: 'Colchón Individual Resortado',
    sku: 'MP-COL-RES-IND',
    category: 'Hogar',
    currentPrice: 2490,
    suggestedPrice: 2790,
    deltaPct: 12.0,
    competitorRef: undefined,
    margin: 0.27,
    belowFloor: false,
    reason: 'cost-unknown',
    reasonDetail:
      'No competitor reference available — suggestion is demand-based; verify before raising.',
  },
  {
    id: 'row-iphone-se',
    product: 'Apple iPhone SE 2022 128GB Medianoche',
    sku: 'MP-APL-IPSE-128',
    category: 'Electrónica',
    currentPrice: 9999,
    suggestedPrice: 9499,
    deltaPct: -5.0,
    competitorRef: 9350,
    competitorSource: 'Mercado Libre',
    competitorLive: true,
    margin: 0.13, // below floor
    belowFloor: true,
    reason: 'below-floor',
    reasonDetail:
      'Matching the live floor on Mercado Libre would push margin to 13% — under the 15% floor.',
  },
  {
    id: 'row-perfume-dior',
    product: 'Perfume Dior Sauvage EDT 100ml',
    sku: 'MP-DIOR-SVG-EDT100',
    category: 'Belleza',
    currentPrice: 3290,
    suggestedPrice: 3590,
    deltaPct: 9.1,
    competitorRef: 3690,
    competitorSource: 'Liverpool',
    competitorLive: false,
    margin: 0.38,
    belowFloor: false,
    reason: 'below-floor',
    reasonDetail:
      'Below Liverpool by a wide gap — modest raise captures margin without losing the box.',
  },
]

/** The single batch approval (one queue, many rows) for Mi Pase. */
export const MOCK_BATCH_APPROVAL: ApprovalView = {
  approvalId: 'apr_mipase_pricing_batch_001',
  sourceRunId: 'run_pricing_draft_9001',
  workflowId: 'mipase.daily-pricing',
  artifact: {
    kind: 'mipase.daily-pricing',
    target: { channel: 'shopify', store: 'mi-pase-test', testStore: true },
    analyzedCount: 1284,
    autoAppliedCount: 248,
    rows,
  } satisfies BatchPricingArtifact,
  state: 'pending',
  approver: 'role:owner',
  decidedBy: null,
  decidedAt: null,
  dispatchedRunId: null,
  createdAt: '2026-06-08T12:00:00.000Z',
}

/**
 * Flatten the batch artifact into one `ApprovalView` PER ROW.
 *
 * The frame governs selection at the `ApprovalView.approvalId` granularity, so
 * each flagged product becomes its own pending view sharing the source run +
 * apply target. This is what the `BatchApprovalRenderer` consumes via `items`,
 * and what the frame uses for the action bar's per-row exclude + count.
 */
export const MOCK_BATCH_ROWS: ApprovalView[] = rows.map((row) => ({
  approvalId: `apr_mipase_pricing_${row.id}`,
  sourceRunId: MOCK_BATCH_APPROVAL.sourceRunId,
  workflowId: 'mipase.daily-pricing',
  artifact: row,
  state: 'pending',
  approver: 'role:owner',
  decidedBy: null,
  decidedAt: null,
  dispatchedRunId: null,
  createdAt: MOCK_BATCH_APPROVAL.createdAt,
}))

/** The apply target — drives the confirm-dialog copy in the renderer. */
export const BATCH_APPLY_TARGET = (MOCK_BATCH_APPROVAL.artifact as BatchPricingArtifact)
  .target
