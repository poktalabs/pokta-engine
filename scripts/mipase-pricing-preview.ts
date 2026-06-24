/**
 * Mi Pase recommend-mode preview — runs the REAL engine pricing brain
 * (`computeSuggestedPrice`) over the cost/margin CSV, using each SKU's manual
 * competitor reference (`Precio Referencia`) as competitor_min. Read-only, no
 * Shopify/ML calls — a faithful offline dry-run of what a live `pricing-draft`
 * at marginFloorPct=15 would recommend. Input JSON is emitted from the CSV.
 *
 *   pnpm tsx scripts/mipase-pricing-preview.ts [marginFloorPct]
 */
import { readFileSync } from 'node:fs'
import { computeSuggestedPrice, type Decision } from '../packages/workflows/pricing/lib/pricing-logic.js'

const FLOOR = Number(process.argv[2] ?? 15)
type Row = {
  sku: string
  producto: string
  current_price_mxn: number | null
  cost_mxn: number | null
  competitor_min_mxn: number | null
  ref_store: string
  mp_price: number | null
  mp_margin: number | null
}
const rows: Row[] = JSON.parse(readFileSync('/tmp/mipase-pricing-input.json', 'utf-8'))

const counts: Record<Decision, number> = {
  hold: 0, lower_to_competitor: 0, hold_above_floor: 0, manual_review: 0, skipped: 0,
}
let priced = 0, deltaSum = 0, lowerCount = 0, lowerDelta = 0
const examples: string[] = []

for (const r of rows) {
  if (r.current_price_mxn == null) continue
  const res = computeSuggestedPrice({
    sku: r.sku,
    current_price_mxn: r.current_price_mxn,
    cost_mxn: r.cost_mxn,
    competitor_min_mxn: r.competitor_min_mxn,
    margin_floor_pct: FLOOR,
  })
  counts[res.decision]++
  if (res.suggested_price_mxn != null) {
    priced++
    const d = res.suggested_price_mxn - r.current_price_mxn
    deltaSum += d
    if (res.decision === 'lower_to_competitor') { lowerCount++; lowerDelta += d }
    if (res.decision === 'lower_to_competitor' && examples.length < 8) {
      examples.push(
        `  ${r.sku} ${r.producto.padEnd(40).slice(0, 40)} ` +
        `$${r.current_price_mxn.toFixed(0)} → $${res.suggested_price_mxn.toFixed(0)} ` +
        `(comp ${r.ref_store} $${r.competitor_min_mxn?.toFixed(0)})`,
      )
    }
  }
}

// Full per-SKU export (the artifact to review with Mi Pase).
import { writeFileSync } from 'node:fs'
const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`
const lines = ['sku,producto,current_price,cost_total_civa,competitor_ref,ref_store,decision,suggested_price,delta,reason']
for (const r of rows) {
  if (r.current_price_mxn == null) continue
  const res = computeSuggestedPrice({
    sku: r.sku, current_price_mxn: r.current_price_mxn, cost_mxn: r.cost_mxn,
    competitor_min_mxn: r.competitor_min_mxn, margin_floor_pct: FLOOR,
  })
  const sug = res.suggested_price_mxn
  const delta = sug != null ? (sug - r.current_price_mxn).toFixed(2) : ''
  lines.push([
    esc(r.sku), esc(r.producto), r.current_price_mxn, r.cost_mxn ?? '', r.competitor_min_mxn ?? '',
    esc(r.ref_store), res.decision, sug ?? '', delta, esc(res.reason),
  ].join(','))
}
writeFileSync(`/tmp/mipase-recommendations-floor${FLOOR}.csv`, lines.join('\n'))

const n = rows.filter((r) => r.current_price_mxn != null).length
console.log(`\n=== Mi Pase recommend-mode preview — margin floor ${FLOOR}% — ${n} SKUs ===\n`)
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}  (${((100 * v) / n).toFixed(1)}%)`)
}
console.log(`\n  SKUs with a concrete suggested price: ${priced}`)
console.log(`  Net price change across priced SKUs:  $${deltaSum.toFixed(0)} MXN`)
console.log(`  "lower_to_competitor" moves: ${lowerCount}  (net $${lowerDelta.toFixed(0)} MXN)`)
console.log(`\n  Sample lower_to_competitor recommendations:`)
console.log(examples.join('\n'))
console.log()
