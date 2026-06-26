/**
 * LOCAL real `pricing-draft` run — the full workflow on your machine.
 *
 * Live Shopify catalog → ML + Amazon MX competitor lookups → the SAME
 * min-accepted aggregation the worker runs → complete output + report. It is
 * READ-ONLY: the draft only READS the catalog, and we inject a fake state store
 * so NO `engine_workflow_state` rows are written and NO Shopify price is changed
 * (the apply step is separate and is NOT run here). This is the offline twin of
 * clicking "Run now" in the web app, with Amazon enabled.
 *
 *   # easiest — source the worker's local env, then run:
 *   set -a; . apps/worker/.env.local; set +a
 *   pnpm tsx scripts/local-pricing-run.ts [limit]
 *
 *   Shopify base/token come from SB/ST or fall back to MIPASE_SHOPIFY_*.
 *   - ML access token from MIPASE_ML_ACCESS_TOKEN / ML_ACCESS_TOKEN, else from
 *     /tmp/ml-tokens.json ({ "access_token": "..." }). Access-token ONLY (no
 *     refresh/oauth) so it can never rotate your refresh token (the known ML
 *     token-persistence bug). Safe + read-only. If ML shows all misses, the
 *     token likely expired (~6h) — re-source a fresh MIPASE_ML_ACCESS_TOKEN.
 *   - Optional per-SKU cost map at /tmp/mipase-cost.json ({ "<sku>": 123.45 });
 *     without cost a known-competitor SKU conservatively flags (manual_review).
 *   - AMZ_PROXY=<origin> to front Amazon through a proxy (else direct → likely
 *     CAPTCHA-blocked from a datacenter IP; from your home IP it usually works).
 *   - [limit] caps how many active SKUs to price (default 10) so it stays quick.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

import {
  createShopifyClient,
  createMercadoLibreClient,
  mercadoLibreSource,
  createAmazonMxSource,
  type CompetitorSource,
} from '../integrations/src/index.js'
import { run } from '../packages/workflows/pricing/pricing-draft/index.js'
import {
  buildPricingReportMarkdown,
  buildPricingReportCsv,
} from '../packages/workflows/pricing/lib/pricing-report.js'

const env = (k: string) => process.env[k] || ''
const LIMIT = Number(process.argv[2] ?? 10)

// ── creds (read-only) ────────────────────────────────────────────────────────
const SB = env('SB') || env('MIPASE_SHOPIFY_BASE_URL')
const ST = env('ST') || env('MIPASE_SHOPIFY_ACCESS_TOKEN')
if (!SB || !ST) {
  console.error(
    '✗ No Shopify creds. Run: `set -a; . apps/worker/.env.local; set +a` first, or set SB + ST.',
  )
  process.exit(1)
}
const accessToken =
  env('MIPASE_ML_ACCESS_TOKEN') ||
  env('ML_ACCESS_TOKEN') ||
  (existsSync('/tmp/ml-tokens.json')
    ? JSON.parse(readFileSync('/tmp/ml-tokens.json', 'utf-8')).access_token
    : '')
if (!accessToken) {
  console.error('✗ No ML access token (MIPASE_ML_ACCESS_TOKEN / ML_ACCESS_TOKEN / /tmp/ml-tokens.json).')
  process.exit(1)
}

const shopify = createShopifyClient({ baseUrl: SB, accessToken: ST })
const ml = createMercadoLibreClient({ accessToken }) // access-token only → won't rotate refresh
const firecrawlKey = env('FIRECRAWL_API_KEY') || undefined
const sources: CompetitorSource[] = [
  mercadoLibreSource(ml),
  createAmazonMxSource({
    enabled: true,
    proxyUrl: env('AMZ_PROXY') || undefined,
    firecrawlKey, // when set, fetch via Firecrawl (its proxies bypass the block)
    // Throttle only matters for direct fetch; Firecrawl distributes across proxies.
    minIntervalMs: env('AMZ_MIN_INTERVAL_MS')
      ? Number(env('AMZ_MIN_INTERVAL_MS'))
      : firecrawlKey
        ? 0
        : 2500,
    jitterMs: env('AMZ_JITTER_MS') ? Number(env('AMZ_JITTER_MS')) : firecrawlKey ? 0 : 1500,
  }),
]
if (firecrawlKey) console.error('  (amazon-mx via Firecrawl)')
const costBySku = existsSync('/tmp/mipase-cost.json')
  ? (JSON.parse(readFileSync('/tmp/mipase-cost.json', 'utf-8')) as Record<string, number>)
  : undefined

// Curated per-SKU match hints (the client's palabras_prohibidas / requeridas),
// from the CSV-meta cache. The generic accessory blocklist is built into the
// engine; this adds the client's specific exclusions (competing brands, "usado").
const csvMeta = existsSync('/tmp/csv-meta.json')
  ? (JSON.parse(readFileSync('/tmp/csv-meta.json', 'utf-8')) as Record<string, { forb?: string; req?: string }>)
  : {}
const splitTerms = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const matchHintsBySku = Object.fromEntries(
  Object.entries(csvMeta).map(([sku, m]) => [sku, { forbidden: splitTerms(m.forb), required: splitTerms(m.req) }]),
)

// Read-only ctx: only 'shopify' is requested (the competitor sources are injected
// via __sources, so ctx.integration('mercado-libre'/'amazon-mx') is never called).
const ctx = {
  runId: `local-${Date.now()}`,
  traceId: 'local',
  logger: { info: (m: string) => console.error('  ·', m), error: (m: string) => console.error('  ✗', m) },
  artifactDir: '/tmp/local-pricing-run',
  integration: (name: string) => {
    if (name === 'shopify') return shopify
    throw new Error(`integration('${name}') not stubbed in the local harness`)
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

// Fake state store → capture desired rows in memory, persist NOTHING.
const desired: unknown[] = []
const __stateStore = { upsertDesired: async (rows: unknown[]) => void desired.push(...rows) }

console.error(`\nRunning local pricing-draft (limit=${LIMIT}, sources=${sources.map((s) => s.id).join('+')})…\n`)
const out = await run(
  {
    consumerId: 'mi-pase',
    limit: LIMIT,
    costBySku,
    matchHintsBySku,
    __sources: sources,
    __stateStore,
    __now: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  ctx,
)

// ── report to stdout + files ─────────────────────────────────────────────────
const s = out.summary
console.log(`\n=== RESULT — ${s.totalSkus} SKUs priced (READ-ONLY, nothing written) ===`)
console.log(`  confident ${s.confidentCount} · flagged ${s.flaggedCount} · competitor-miss ${s.competitorMissCount}`)
console.log(`  per-source yield (found / accepted):`)
for (const [src, y] of Object.entries(s.bySource)) {
  console.log(`    ${src.padEnd(14)} found ${(y as { found: number }).found} · accepted ${(y as { accepted: number }).accepted}`)
}

console.log(`\n  per-SKU (first 15 — chosenSource · competitor · suggested · [decision] · {quotes}):`)
for (const r of [...out.confident, ...out.flagged].slice(0, 15)) {
  const quotes = r.quotes
    .map((q) => `${q.source}${q.priceMxn != null ? `$${q.priceMxn}` : '—'}`)
    .join(' ')
  console.log(
    `    ${r.sku.padEnd(12)} ${(r.chosenSource ?? '(none)').padEnd(14)} comp ${r.competitorMinMxn ?? '—'} → sug ${r.suggestedPriceMxn ?? '—'} [${r.decision}] {${quotes}}`,
  )
}

writeFileSync('/tmp/local-pricing-report.md', buildPricingReportMarkdown(out))
writeFileSync('/tmp/local-pricing-report.csv', buildPricingReportCsv(out))
console.log(
  `\n  report → /tmp/local-pricing-report.{md,csv}` +
    `\n  desired rows that WOULD persist on the worker: ${desired.length} (none written here)\n`,
)
