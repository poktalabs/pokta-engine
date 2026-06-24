/**
 * PURE pricing-report builders (plan §3.7).
 *
 * The COMPLETE pricing output IS `engine_runs.output` (the extended {@link
 * PricingDraftOutput} — durable source of truth). These builders render a
 * Markdown summary and a per-SKU CSV ON DEMAND from that output. They are pure
 * functions of the output (no I/O, no clock, no `ctx.artifactDir` write — that
 * dir is ephemeral `/tmp` and is never persisted/served, plan F1). A productized
 * download path (an `engine_reports` table + scoped GET) is a deferred step; v1
 * ships these builders unit-tested, mirroring `lib/non-usable-report.ts`.
 */

import type { PricingDraftOutput, PricingSkuResult } from '../pricing-draft/index.js'

/** Stable, sorted list of the sources that appear in the run's per-source yield. */
function sourcesOf(output: PricingDraftOutput): string[] {
  return Object.keys(output.summary.bySource).sort()
}

/** Every priced SKU, confident first then flagged (the full deliverable set). */
function allSkus(output: PricingDraftOutput): PricingSkuResult[] {
  return [...output.confident, ...output.flagged]
}

/** suggested − current when both are known, else null (no invented delta). */
function delta(row: PricingSkuResult): number | null {
  if (row.suggestedPriceMxn == null || row.currentPriceMxn == null) return null
  return Math.round((row.suggestedPriceMxn - row.currentPriceMxn) * 100) / 100
}

/** This SKU's quote from a given source, if that source returned one. */
function quoteFrom(row: PricingSkuResult, source: string) {
  return row.quotes.find((q) => q.source === source) ?? null
}

function mdCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
}

function money(value: number | null): string {
  if (value == null) return ''
  return `$${value.toFixed(2)}`
}

/** Render the complete pricing output as a client-facing Markdown report. */
export function buildPricingReportMarkdown(output: PricingDraftOutput): string {
  const { summary } = output
  const sources = sourcesOf(output)
  const rows = allSkus(output)

  const lines = [
    '# Reporte de precios sugeridos',
    '',
    `Cliente: ${summary.consumerId}`,
    '',
    '## Resumen',
    '',
    `- SKUs analizados: ${summary.totalSkus}`,
    `- Con precio sugerido (alta confianza): ${summary.confidentCount}`,
    `- Para revision manual: ${summary.flaggedCount}`,
    `- Sin competidor encontrado: ${summary.competitorMissCount}`,
    '',
    '## Cobertura por fuente',
    '',
    '| Fuente | Con precio | Aceptados |',
    '| --- | ---: | ---: |',
    ...sources.map(
      (s) => `| ${mdCell(s)} | ${summary.bySource[s]!.found} | ${summary.bySource[s]!.accepted} |`,
    ),
    '',
    '## Detalle por SKU',
    '',
    '| SKU | Producto | Actual | Fuente | Competidor | Sugerido | Delta | Decision | Motivo |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: | --- | --- |',
    ...rows.map((row) =>
      [
        row.sku,
        row.title,
        money(row.currentPriceMxn),
        row.chosenSource ?? '',
        money(row.competitorMinMxn),
        money(row.suggestedPriceMxn),
        money(delta(row)),
        row.decision,
        row.reason,
      ]
        .map(mdCell)
        .join(' | '),
    ).map((line) => `| ${line} |`),
    '',
  ]

  return lines.join('\n')
}

/** Leading chars a spreadsheet may interpret as a formula (CSV injection). */
const FORMULA_LEAD = /^[=+\-@\t\r]/

function csvCell(value: unknown): string {
  let s = String(value ?? '')
  // Neutralize spreadsheet formula injection in free-text cells (titles/reasons
  // can carry attacker/competitor-controlled text) — but DON'T mangle legitimate
  // numbers like a negative delta "-250" (those are program-generated, safe).
  if (FORMULA_LEAD.test(s) && !Number.isFinite(Number(s))) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** Render the complete pricing output as a per-SKU CSV (one row per SKU). */
export function buildPricingReportCsv(output: PricingDraftOutput): string {
  const sources = sourcesOf(output)
  const rows = allSkus(output)

  // Fixed columns + two per-source columns (price + match confidence) so the
  // full multi-source detail is auditable from the output alone.
  const header = [
    'sku',
    'title',
    'current_mxn',
    'chosen_source',
    'competitor_min_mxn',
    'suggested_mxn',
    'delta_mxn',
    'decision',
    'reason',
    'match_confidence',
    'match_decision',
    ...sources.flatMap((s) => [`${s}_price_mxn`, `${s}_match`]),
  ]

  const body = rows.map((row) => [
    row.sku,
    row.title,
    row.currentPriceMxn == null ? '' : String(row.currentPriceMxn),
    row.chosenSource ?? '',
    row.competitorMinMxn == null ? '' : String(row.competitorMinMxn),
    row.suggestedPriceMxn == null ? '' : String(row.suggestedPriceMxn),
    delta(row) == null ? '' : String(delta(row)),
    row.decision,
    row.reason,
    row.matchConfidence ?? '',
    row.matchDecision,
    ...sources.flatMap((s) => {
      const q = quoteFrom(row, s)
      return [q?.priceMxn == null ? '' : String(q.priceMxn), q?.matchConfidence ?? '']
    }),
  ])

  return [header, ...body].map((r) => r.map(csvCell).join(',')).join('\n')
}
