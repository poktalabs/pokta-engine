import { registerMock } from './registry'

/**
 * Reports fixtures (M2 P4-B).
 *
 * The dashboard's Reports surface is an index of engine-produced reports per
 * tenant plus one opened report (summary + a simple table/chart). There is NO
 * `Report` contract type today — P5a is scheduled to add it to
 * `packages/contract` when `GET /v1/reports*` lands. Until then these mock shapes
 * are LOCAL to the web package (the same pattern the approvals mocks use for
 * their renderer-owned artifact shapes), kept deliberately close to the planned
 * envelope so the P5a contract type can absorb them with minimal churn:
 *
 *   GET /v1/reports        → { reports: ReportSummary[] }   (the index)
 *   GET /v1/reports/:id    → ReportDetail                    (one opened report)
 *
 * Served only behind `VITE_USE_MOCKS` (see `lib/api.ts`). The two tenants:
 *   - Mi Pase  → Daily pricing impact, Competitor metadata research
 *   - Vino     → CEO execution brief, Lead pipeline health, Stale leads
 *
 * Money/percent values are pre-formatted display strings in the mock so the table
 * stays currency-correct without a formatter dependency here; numeric series feed
 * the simple bar chart. P7 swaps the display strings for `getFormattedPrice`.
 */

/** Which engine surface produced the report — drives the index icon + grouping. */
export type ReportKind =
  | 'pricing-impact'
  | 'competitor-metadata'
  | 'ceo-brief'
  | 'pipeline-health'
  | 'stale-leads'

/** A headline stat shown both in the index card and the detail stat tiles. */
export interface ReportMetric {
  label: string
  /** Pre-formatted display value (e.g. "32", "-4.9%", "-$56,260.04 MXN"). */
  value: string
  /** Optional status accent for the metric (maps to the status pill scale). */
  tone?: 'ok' | 'warn' | 'fail' | 'idle'
}

/** A column descriptor for the detail table. */
export interface ReportColumn {
  key: string
  label: string
  /** Right-align numeric columns; default left. */
  align?: 'left' | 'right'
}

/** A simple categorical bar-chart series rendered inline in the detail view. */
export interface ReportChart {
  title: string
  /** Y-axis unit label, e.g. "products" or "leads". */
  unit?: string
  bars: { label: string; value: number; tone?: 'ok' | 'warn' | 'fail' | 'idle' }[]
}

/** One row in the Reports index (lightweight — no table/chart payload). */
export interface ReportSummary {
  id: string
  tenantId: 'mipase' | 'vino'
  kind: ReportKind
  title: string
  /** One-line plain-language description for the index card. */
  description: string
  /** ISO 8601 — when the engine produced this report. */
  generatedAt: string
  /** The run that produced it (links back to Run detail in a later phase). */
  sourceRunId: string
  /** Up to three headline metrics shown on the index card. */
  headline: ReportMetric[]
}

/** A fully opened report — summary + an optional table and/or chart. */
export interface ReportDetail extends ReportSummary {
  /** Prose summary paragraphs (plain language, operator-readable). */
  summary: string[]
  /** Full metric set for the detail stat tiles. */
  metrics: ReportMetric[]
  /** Optional table block (columns + string-cell rows). */
  table?: {
    title: string
    columns: ReportColumn[]
    rows: Record<string, string>[]
  }
  /** Optional simple bar chart. */
  chart?: ReportChart
}

/* ─── Mi Pase · Daily pricing impact ──────────────────────────────────────── */

const mipasePricingImpact: ReportDetail = {
  id: 'rpt_mipase_pricing_impact_20260608',
  tenantId: 'mipase',
  kind: 'pricing-impact',
  title: 'Daily pricing impact',
  description:
    '35 products analyzed, 32 prices lowered — average cut 4.9%, total revenue exposure -$56,260.04 MXN.',
  generatedAt: '2026-06-08T06:12:00.000Z',
  sourceRunId: 'run_pricing_apply_9042',
  headline: [
    { label: 'Analyzed', value: '35' },
    { label: 'Lowered', value: '32', tone: 'ok' },
    { label: 'Total Δ', value: '-$56,260.04 MXN', tone: 'warn' },
  ],
  summary: [
    'The daily pricing run analyzed 35 products and lowered 32 of them after your approval. ' +
      'The average reduction was 4.9%, keeping every change above the 15% margin floor.',
    'The total price movement across the catalog is -$56,260.04 MXN. Two products were held ' +
      'because their supplier cost is unknown, and one was left unchanged because it was already ' +
      'aligned with the market.',
  ],
  metrics: [
    { label: 'Products analyzed', value: '35' },
    { label: 'Prices lowered', value: '32', tone: 'ok' },
    { label: 'Average change', value: '-4.9%', tone: 'warn' },
    { label: 'Total price Δ (MXN)', value: '-$56,260.04', tone: 'warn' },
  ],
  table: {
    title: 'Lowered products (top movers)',
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'category', label: 'Category' },
      { key: 'before', label: 'Before (MXN)', align: 'right' },
      { key: 'after', label: 'After (MXN)', align: 'right' },
      { key: 'delta', label: 'Δ', align: 'right' },
    ],
    rows: [
      {
        product: 'Apple iPhone 15 Pro 256GB Titanio Natural',
        category: 'Electrónica',
        before: '$25,999.00',
        after: '$24,499.00',
        delta: '-5.8%',
      },
      {
        product: 'Motocicleta Vento Nitrox 250 Roja',
        category: 'Vehículos',
        before: '$32,990.00',
        after: '$30,990.00',
        delta: '-6.1%',
      },
      {
        product: 'Perfume Carolina Herrera Good Girl EDP 80ml',
        category: 'Belleza',
        before: '$2,890.00',
        after: '$2,590.00',
        delta: '-10.4%',
      },
      {
        product: 'Café de Olla Molido Tradicional 1kg',
        category: 'Despensa',
        before: '$189.00',
        after: '$169.00',
        delta: '-10.6%',
      },
      {
        product: 'Set de Toallas de Algodón',
        category: 'Hogar',
        before: '$320.00',
        after: '$289.00',
        delta: '-9.7%',
      },
    ],
  },
  chart: {
    title: 'Outcome breakdown',
    unit: 'products',
    bars: [
      { label: 'Lowered', value: 32, tone: 'ok' },
      { label: 'Held (cost unknown)', value: 2, tone: 'warn' },
      { label: 'Unchanged', value: 1, tone: 'idle' },
    ],
  },
}

/* ─── Mi Pase · Competitor metadata research ──────────────────────────────── */

const mipaseCompetitorMetadata: ReportDetail = {
  id: 'rpt_mipase_competitor_metadata_20260607',
  tenantId: 'mipase',
  kind: 'competitor-metadata',
  title: 'Competitor metadata research',
  description:
    'Catalog and pricing metadata gathered across Mercado Libre, Coppel, Liverpool and Amazon MX.',
  generatedAt: '2026-06-07T22:48:00.000Z',
  sourceRunId: 'run_competitor_scan_4471',
  headline: [
    { label: 'Sources', value: '4' },
    { label: 'SKUs matched', value: '618', tone: 'ok' },
    { label: 'Stale listings', value: '41', tone: 'warn' },
  ],
  summary: [
    'The competitor research run pulled live catalog and pricing metadata from four marketplaces ' +
      'and matched 618 of your SKUs to at least one competitor listing.',
    'Mercado Libre is the only real-time source; Coppel, Liverpool and Amazon MX are periodic ' +
      'scrapes. 41 matched listings are older than 48 hours and were flagged as stale references.',
  ],
  metrics: [
    { label: 'Sources scanned', value: '4' },
    { label: 'SKUs matched', value: '618', tone: 'ok' },
    { label: 'Live feeds', value: '1' },
    { label: 'Stale listings', value: '41', tone: 'warn' },
  ],
  table: {
    title: 'Coverage by source',
    columns: [
      { key: 'source', label: 'Source' },
      { key: 'type', label: 'Type' },
      { key: 'matched', label: 'SKUs matched', align: 'right' },
      { key: 'fresh', label: 'Fresh', align: 'right' },
    ],
    rows: [
      { source: 'Mercado Libre', type: 'Live feed', matched: '402', fresh: '100%' },
      { source: 'Coppel', type: 'Scrape', matched: '96', fresh: '78%' },
      { source: 'Liverpool', type: 'Scrape', matched: '74', fresh: '81%' },
      { source: 'Amazon MX', type: 'Scrape', matched: '46', fresh: '63%' },
    ],
  },
  chart: {
    title: 'SKUs matched by source',
    unit: 'SKUs',
    bars: [
      { label: 'Mercado Libre', value: 402, tone: 'ok' },
      { label: 'Coppel', value: 96, tone: 'idle' },
      { label: 'Liverpool', value: 74, tone: 'idle' },
      { label: 'Amazon MX', value: 46, tone: 'idle' },
    ],
  },
}

/* ─── Vino · CEO execution brief ──────────────────────────────────────────── */

const vinoCeoBrief: ReportDetail = {
  id: 'rpt_vino_ceo_brief_20260608',
  tenantId: 'vino',
  kind: 'ceo-brief',
  title: 'CEO execution brief',
  description:
    'A weekly rollup of pipeline movement, drafted actions awaiting approval and team focus.',
  generatedAt: '2026-06-08T07:00:00.000Z',
  sourceRunId: 'run_vino_ceobrief_120',
  headline: [
    { label: 'New leads', value: '9', tone: 'ok' },
    { label: 'Awaiting you', value: '4', tone: 'warn' },
    { label: 'Pipeline (USD)', value: '$312,400' },
  ],
  summary: [
    'Nine new leads entered the pipeline this week and four drafted actions are waiting for your ' +
      'approval. Open pipeline value sits at $312,400 across the residential and commercial lines.',
    'The agent recommends prioritizing the Riverside Kitchen Remodel estimate commit and two ' +
      'follow-up emails to warm leads that have gone quiet for more than five days.',
  ],
  metrics: [
    { label: 'New leads', value: '9', tone: 'ok' },
    { label: 'Actions awaiting approval', value: '4', tone: 'warn' },
    { label: 'Open pipeline (USD)', value: '$312,400' },
    { label: 'Win rate (30d)', value: '34%' },
  ],
  table: {
    title: 'Recommended next actions',
    columns: [
      { key: 'action', label: 'Action' },
      { key: 'lead', label: 'Lead' },
      { key: 'value', label: 'Value', align: 'right' },
      { key: 'priority', label: 'Priority' },
    ],
    rows: [
      {
        action: 'Commit estimate',
        lead: 'Riverside Kitchen Remodel',
        value: '$48,500',
        priority: 'High',
      },
      {
        action: 'Send follow-up email',
        lead: 'Dana Keller',
        value: '$52,000',
        priority: 'Medium',
      },
      {
        action: 'Send follow-up email',
        lead: 'Brookline Bath Renovation',
        value: '$31,800',
        priority: 'Medium',
      },
      {
        action: 'Move to Qualified',
        lead: 'Maple St. Addition',
        value: '$96,000',
        priority: 'Low',
      },
    ],
  },
  chart: {
    title: 'Pipeline by stage',
    unit: 'leads',
    bars: [
      { label: 'New', value: 9, tone: 'ok' },
      { label: 'Qualified', value: 6, tone: 'idle' },
      { label: 'Proposal', value: 4, tone: 'warn' },
      { label: 'Won', value: 2, tone: 'ok' },
    ],
  },
}

/* ─── Vino · Lead pipeline health ─────────────────────────────────────────── */

const vinoPipelineHealth: ReportDetail = {
  id: 'rpt_vino_pipeline_health_20260606',
  tenantId: 'vino',
  kind: 'pipeline-health',
  title: 'Lead pipeline health',
  description:
    'Stage distribution, average time-in-stage and conversion checkpoints across the pipeline.',
  generatedAt: '2026-06-06T16:30:00.000Z',
  sourceRunId: 'run_vino_pipelinehealth_088',
  headline: [
    { label: 'Open leads', value: '21' },
    { label: 'Avg days in stage', value: '11.4', tone: 'warn' },
    { label: 'At risk', value: '5', tone: 'fail' },
  ],
  summary: [
    'There are 21 open leads spread across four stages. Average time-in-stage is 11.4 days, ' +
      'slightly above the 10-day target, driven by the Proposal stage backing up.',
    'Five leads are flagged at risk: they have sat in the same stage for more than three weeks ' +
      'with no logged activity. Clearing the Proposal backlog is the highest-leverage move.',
  ],
  metrics: [
    { label: 'Open leads', value: '21' },
    { label: 'Avg days in stage', value: '11.4', tone: 'warn' },
    { label: 'Proposal backlog', value: '7', tone: 'warn' },
    { label: 'At-risk leads', value: '5', tone: 'fail' },
  ],
  table: {
    title: 'Time in stage',
    columns: [
      { key: 'stage', label: 'Stage' },
      { key: 'leads', label: 'Leads', align: 'right' },
      { key: 'avgDays', label: 'Avg days', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    rows: [
      { stage: 'New', leads: '6', avgDays: '2.1', status: 'Healthy' },
      { stage: 'Qualified', leads: '5', avgDays: '6.8', status: 'Healthy' },
      { stage: 'Proposal', leads: '7', avgDays: '19.3', status: 'Backing up' },
      { stage: 'Negotiation', leads: '3', avgDays: '14.5', status: 'Watch' },
    ],
  },
  chart: {
    title: 'Average days in stage',
    unit: 'days',
    bars: [
      { label: 'New', value: 2.1, tone: 'ok' },
      { label: 'Qualified', value: 6.8, tone: 'ok' },
      { label: 'Proposal', value: 19.3, tone: 'fail' },
      { label: 'Negotiation', value: 14.5, tone: 'warn' },
    ],
  },
}

/* ─── Vino · Stale leads ──────────────────────────────────────────────────── */

const vinoStaleLeads: ReportDetail = {
  id: 'rpt_vino_stale_leads_20260605',
  tenantId: 'vino',
  kind: 'stale-leads',
  title: 'Stale leads',
  description:
    'Leads with no logged activity for more than 14 days, ranked by value at risk.',
  generatedAt: '2026-06-05T09:15:00.000Z',
  sourceRunId: 'run_vino_staleleads_064',
  headline: [
    { label: 'Stale leads', value: '5', tone: 'fail' },
    { label: 'Value at risk', value: '$184,300', tone: 'warn' },
    { label: 'Oldest', value: '31 days', tone: 'fail' },
  ],
  summary: [
    'Five leads have had no logged activity for more than two weeks, putting $184,300 of pipeline ' +
      'value at risk. The oldest has been idle for 31 days.',
    'The agent has drafted re-engagement emails for the three highest-value leads; they are ' +
      'waiting in the Approvals queue.',
  ],
  metrics: [
    { label: 'Stale leads', value: '5', tone: 'fail' },
    { label: 'Value at risk (USD)', value: '$184,300', tone: 'warn' },
    { label: 'Drafts ready', value: '3', tone: 'ok' },
    { label: 'Oldest idle', value: '31 days', tone: 'fail' },
  ],
  table: {
    title: 'Idle leads by value at risk',
    columns: [
      { key: 'lead', label: 'Lead' },
      { key: 'stage', label: 'Stage' },
      { key: 'value', label: 'Value', align: 'right' },
      { key: 'idle', label: 'Idle', align: 'right' },
    ],
    rows: [
      { lead: 'Maple St. Addition', stage: 'Qualified', value: '$96,000', idle: '31 days' },
      { lead: 'Dana Keller', stage: 'Proposal', value: '$52,000', idle: '22 days' },
      { lead: 'Brookline Bath Renovation', stage: 'Proposal', value: '$31,800', idle: '18 days' },
      { lead: 'Cedar Grove Deck', stage: 'New', value: '$3,500', idle: '16 days' },
      { lead: 'Hillcrest Pergola', stage: 'New', value: '$1,000', idle: '15 days' },
    ],
  },
  chart: {
    title: 'Days idle (top leads)',
    unit: 'days',
    bars: [
      { label: 'Maple St.', value: 31, tone: 'fail' },
      { label: 'Dana Keller', value: 22, tone: 'fail' },
      { label: 'Brookline', value: 18, tone: 'warn' },
      { label: 'Cedar Grove', value: 16, tone: 'warn' },
      { label: 'Hillcrest', value: 15, tone: 'warn' },
    ],
  },
}

/** Every mock report, keyed by id for the detail lookup. */
export const MOCK_REPORTS: ReportDetail[] = [
  mipasePricingImpact,
  mipaseCompetitorMetadata,
  vinoCeoBrief,
  vinoPipelineHealth,
  vinoStaleLeads,
]

/** The index envelope shape — `GET /v1/reports` returns `{ reports }`. */
export interface ReportListResponse {
  reports: ReportSummary[]
}

/** Project a full report down to its index summary (drops table/chart payload). */
function toSummary(report: ReportDetail): ReportSummary {
  const { id, tenantId, kind, title, description, generatedAt, sourceRunId, headline } = report
  return { id, tenantId, kind, title, description, generatedAt, sourceRunId, headline }
}

/** All reports for a tenant, newest first. */
export function reportsForTenant(tenantId: 'mipase' | 'vino'): ReportSummary[] {
  return MOCK_REPORTS.filter((r) => r.tenantId === tenantId)
    .map(toSummary)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
}

/** Look up one full report by id. */
export function reportById(id: string): ReportDetail | undefined {
  return MOCK_REPORTS.find((r) => r.id === id)
}

// ─── Mock registry wiring (served only behind VITE_USE_MOCKS) ────────────────

registerMock('GET', '/v1/reports', (ctx): ReportListResponse => {
  // Optional `?tenant=` query scopes the index; default to all reports.
  const query = ctx.path.split('?')[1] ?? ''
  const tenant = new URLSearchParams(query).get('tenant')
  if (tenant === 'mipase' || tenant === 'vino') {
    return { reports: reportsForTenant(tenant) }
  }
  return { reports: MOCK_REPORTS.map(toSummary) }
})

registerMock('GET', /^\/v1\/reports\/([^/?]+)$/, (ctx): ReportDetail => {
  const id = ctx.params[0] ?? ''
  const report = reportById(id)
  if (!report) {
    // Loud, typed failure — the page maps this to its error state.
    throw new Error(`[mocks] report not found: ${id}`)
  }
  return report
})
