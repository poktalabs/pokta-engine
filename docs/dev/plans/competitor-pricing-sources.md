# Implementation Plan — Competitor Pricing Source (multi-source competitor matching + complete pricing output)

**Status:** APPROVED, ready to build · **Date:** 2026-06-24 · **Tenant driver:** mi-pase
**Related:** `docs/feature-requests/competitor-pricing-coverage/REPORT.md` (the coverage finding that motivated this) · `docs/feature-requests/workflow-legibility/DESIGN.md` (glass-box, parked/parallel)

---

## 1. Context & goal

Mercado Libre alone covers only **~14/59 active products (24%)** for trustworthy competitor pricing; the bottleneck is ML's marketplace inventory, not our matching code (see REPORT.md). To lift coverage and produce a client-grade deliverable, the engine must:

1. Query **multiple competitor sources** per SKU (ML + Amazon MX), not just ML.
2. Aggregate all sources into **one "complete pricing output"** per run — the structured run output (per-source quotes + suggestions + findings) **plus a downloadable report artifact**.

**Non-goals (this build):** residential-proxy infra; a productized `engine_reports` table + GET endpoint (deferred, ties to the glass-box); server-side cost store; the glass-box UI itself.

### Locked decisions
- Build the **source seam + a real Amazon MX source now** (not a scaffold).
- Amazon data via **scraping `amazon.com.mx`** (product owner's call). ⚠️ ToS/legal gray; datacenter-IP blocking means **low real yield from the Railway worker without residential proxies** — the design must **fail-soft to ML** so Amazon never breaks a run.
- Complete output = **extend** the run output (additively) **+ emit** a report artifact.
- Default aggregation policy: `competitor_min` = **min across ACCEPTED (high-confidence) quotes** from any source. Pluggable later.

---

## 2. Current state (verified)

- `pricing-draft/index.ts` → `gatherCompetitors(identities, ml, ctx)` returns `Map<sku, MLSearchResult | null>`; the main loop scores each via `scoreProductMatch`, gates on `matchDecision === 'accept'` (`trustedCompetitor`), runs `computeSuggestedPrice`, and splits into `confident[]` / `flagged[]`.
- Output `PricingDraftOutput = { consumerId, summary{ totalSkus, confidentCount, flaggedCount, competitorMissCount, aggregates }, confident: PricingSkuResult[], flagged: PricingSkuResult[] }`, stored whole in `engine_runs.output` (jsonb).
- `pricing-apply` reads only `ApplySku { sku, shopifyVariantId, suggestedPriceMxn, currentPriceMxn? }` from `confident[]`/`flagged[]` (`selectSkus` by manifest id). **Keep those fields exactly.**
- Integrations: module + descriptor + factory registered via `registerProvider` (`integrations/src/resolver.ts`), discovered via `registry`/`getIntegration`/`listIntegrations` (`integrations/src/index.ts`); per-tenant client resolution `ctx.integration(name)` (`makeIntegrationResolver`). Per-tenant enablement in `engine_tenant_integrations` (`tenantId, integrationId, status`). ML is already an integration module.
- **No engine report mechanism exists** (shipped reports were hand-bundled). `RunContext.artifactDir` exists. `lib/non-usable-report.ts` has unused pure builders (`buildNonUsableReportMarkdown/Csv`) to mirror.
- `scoreProductMatch(MatchInput, matchedTitle)` is title-based and generic — reusable per-source unchanged.

---

## 3. Architecture

### 3.1 CompetitorSource seam — `integrations/src/competitor/types.ts` (NEW)
```ts
/** A normalized competitor quote, source-agnostic (generalized from MLSearchResult). */
export interface CompetitorQuote {
  source: string                 // 'mercado-libre' | 'amazon-mx' | ...
  title: string | null
  priceMxn: number | null
  permalink: string | null
  productId: string | null
  categoryId: string | null
  candidatesChecked: number
  failureReason: string | null   // source-specific reason when no usable quote
  fetchedAt: string              // ISO 8601 (freshness; passed in via args/ctx, NOT Date.now in workflow scripts)
}

/** A competitor price source. ML wraps its client; Amazon scrapes. */
export interface CompetitorSource {
  readonly id: string
  /** Look up ONE product. MUST fail-soft: return null (never throw) on block/error/no-match. */
  lookup(query: string, opts?: { signal?: AbortSignal }): Promise<CompetitorQuote | null>
}
```

### 3.2 ML adapter — `integrations/src/mercado-libre/competitor-source.ts` (NEW)
Wrap the existing `MercadoLibreClient` (unchanged) into a `CompetitorSource`:
```ts
export function mercadoLibreSource(client: MercadoLibreClient): CompetitorSource {
  return {
    id: 'mercado-libre',
    async lookup(query, opts) {
      try {
        const r = await client.search(query, opts)
        return {
          source: 'mercado-libre', title: r.title, priceMxn: r.price_mxn,
          permalink: r.permalink, productId: r.catalog_product_id, categoryId: r.category_id,
          candidatesChecked: r.candidates_checked, failureReason: r.failure_reason,
          fetchedAt: '',  // stamped by the caller
        }
      } catch { return null }   // fail-soft
    },
  }
}
```

### 3.3 Amazon MX source — `integrations/src/amazon-mx/{index,module}.ts` (NEW)
```ts
export interface AmazonMxConfig { enabled: boolean; proxyUrl?: string; userAgent?: string }
export function createAmazonMxSource(config: AmazonMxConfig): CompetitorSource
```
- `lookup`: GET `https://www.amazon.com.mx/s?k=<query>` (UPC → MPN → title fallback), parse result cards with **cheerio** (new dep), pick the best card by title-token overlap + has-price, return a `CompetitorQuote`.
- **Config-gated:** `enabled === false` → the factory throws "not configured" (matches Notion/Resend/Shopify pattern) → source omitted.
- **Fail-soft:** any non-200 / CAPTCHA page / parse miss → `lookup` returns `null` with `failureReason` (`blocked` | `no_result` | `parse_error`). Never throws.
- **Polite:** realistic UA, single attempt, AbortSignal, paced by the caller (no internal retry storms). Optional `proxyUrl` for later residential-proxy use.
- Register as integration module (`descriptor.category: 'competitor'`) in `integrations/src/index.ts` + `IntegrationClients` merge; factory in `apps/worker/src/provider-config.ts` reading `${PREFIX}_AMAZON_MX_*` env.

### 3.4 Source selection — the WORKFLOW composes from env-config (eng-review decision)
> ⚠️ **Eng-review correction:** provider factories resolve **synchronously** (`integrations/src/resolver.ts:72` — the worker pre-loads secrets via `loadTenantSecrets` *before* the run so factories never do async work). So a factory **cannot** read `engine_tenant_integrations` (async DB) to decide enabled sources. DB-driven per-tenant selection would need a pre-run async `loadTenantCompetitorSources` (mirroring `loadTenantSecrets`) — **deferred (fast-follow)**.

**v1 (decided): the workflow composes its own source list**, each via try/catch so an unconfigured/failing source is simply omitted (fail-soft):
```ts
// in pricing-draft run(), build the active sources
const sources: CompetitorSource[] = []
try { sources.push(mercadoLibreSource(ctx.integration('mercado-libre'))) } catch { /* ML unconfigured → skip */ }
try { sources.push(ctx.integration('amazon-mx')) } catch { /* Amazon disabled/unconfigured → skip */ }
```
- `amazon-mx` factory (`apps/worker/src/provider-config.ts`) reads `${PREFIX}_AMAZON_MX_*` env and **throws when disabled/unconfigured** (the canonical resolver pattern) → omitted. No `engine_tenant_integrations` read in v1, no `competitor-sources` pseudo-integration.
- This keeps selection explicit, sync-safe, and easy to test. Per-tenant DB-driven enablement is the fast-follow.

### 3.5 Multi-source gather — `packages/workflows/pricing/pricing-draft/index.ts`
Replace `gatherCompetitors(identities, ml, ctx)`:
```ts
async function gatherCompetitors(
  identities: ProductIdentity[], sources: CompetitorSource[], ctx: RunContext,
): Promise<Map<string, CompetitorQuote[]>>
```
- The workflow builds `sources[]` (see §3.4) and passes it in.
- **Per SKU, query sources CONCURRENTLY** (`Promise.all(sources.map(s => s.lookup(q)))`) — sources are independent; sequential per-source would multiply wall-clock by source count (⚠️ **perf, eng-review**: 59 SKUs × 2 sources × ~250ms paced **sequentially** ≈ doubles toward the 20-min `PRICING_DRAFT_TIMEOUT_MS`). Keep the existing **per-SKU** pacing (`ML_PACE_MS` between SKUs) to stay polite to each source; parallelize only the within-SKU source fan-out.
- Collect non-null quotes (stamp `fetchedAt` from a run-start timestamp passed via input/ctx — NOT `Date.now()` inside workflow code if it must stay deterministic for tests; inject a clock). Fail-soft per source per SKU.
- Main loop, per SKU: score EACH quote with `scoreProductMatch` (unchanged) → keep `accept` quotes → `competitorMinMxn = min(accepted.priceMxn)` (default policy) and `chosenSource = source of the min`. Carry ALL quotes.

### 3.6 Complete pricing output (extend, don't break)
`PricingSkuResult` gains (additive):
```ts
quotes: CompetitorQuote[]          // every source's quote (+ per-quote matchConfidence)
chosenSource: string | null        // source that won the chosen competitor_min
```
Keep `competitorMinMxn` (now = min accepted), `suggestedPriceMxn`, `currentPriceMxn`, `shopifyVariantId`, `decision`, `reason`, `matchConfidence`, `matchDecision`. `PricingDraftOutput.summary` gains:
```ts
bySource: Record<string, { found: number; accepted: number }>
```

### 3.7 Report artifact — `packages/workflows/pricing/lib/pricing-report.ts` (NEW)
Pure builders mirroring `lib/non-usable-report.ts`:
```ts
buildPricingReportMarkdown(output: PricingDraftOutput): string
buildPricingReportCsv(output: PricingDraftOutput): string   // per-SKU: sku,title,current,cost?,chosenSource,competitorMin,suggested,delta,decision,reason + per-source quote cols
```
> ⚠️ **Eng-review correction (do NOT write to `artifactDir`):** `RunContext.artifactDir` = `/tmp/godin-engine/${runId}` (`apps/worker/src/index.ts:147`) — ephemeral, not persisted, not served. Writing report files there is a no-op for the user.

**Decided:** the **complete pricing output IS `engine_runs.output`** (extended per §3.6 — durable source of truth). The builders are **pure functions** that render md/csv on demand from that output. v1 ships the builders (unit-tested) but does **not** wire a download path — a productized download (a new `engine_reports` table + scoped `GET /v1/runs/:id/report`, or SPA-side render of `output`) is a **separate deferred step** (ties to the deferred Reports backend + glass-box). No `artifactDir` write.

---

## 4. Phased build & file map

### Phase 1 — Source seam + ML refactor (no external behavior change)
- NEW `integrations/src/competitor/types.ts`; `integrations/src/mercado-libre/competitor-source.ts`.
- MODIFY `integrations/src/index.ts` (export the competitor types + ML adapter).
- MODIFY `packages/workflows/pricing/pricing-draft/index.ts` (workflow composes `sources[]` via §3.4 — ML only in P1; `gatherCompetitors` → sources[], concurrent per-SKU fan-out, per-quote scoring, `competitorMinMxn` from min-accepted). Output shape **unchanged externally** in P1 (collapse to the single chosen competitor) to isolate the refactor.
- (No `provider-config.ts` change in P1 — ML is already registered; the workflow composes the list.)
- Tests: ML adapter maps `MLSearchResult` → `CompetitorQuote`; single-ML gather reproduces current results (golden); full pricing suite green.

### Phase 2 — Complete output + report (pure builders, no download path)
- MODIFY `pricing-draft/index.ts` + `PricingSkuResult`/`PricingDraftOutput` types (add `quotes`, `chosenSource`, `summary.bySource`). The extended `engine_runs.output` IS the complete pricing output.
- NEW `packages/workflows/pricing/lib/pricing-report.ts` — **pure** `buildPricingReportMarkdown/Csv(output)`. **No `ctx.artifactDir` write** (ephemeral). Download path deferred.
- Tests: report builder (md + csv snapshot), output additive fields present, **draft→apply chain compat** (apply children still read `ApplySku`), `computeAggregates` unchanged.

### Phase 3 — Amazon MX scraper source (separate PR)
- NEW `integrations/src/amazon-mx/{index,module}.ts` + cheerio dep (`package.json`).
- MODIFY `integrations/src/index.ts` (register module + `IntegrationClients` merge), `apps/worker/src/provider-config.ts` (amazon-mx factory reading `${PREFIX}_AMAZON_MX_*`, throws when disabled). The workflow's §3.4 `try { ctx.integration('amazon-mx') }` picks it up automatically — no per-tenant DB row needed in v1.
- Tests: amazon-mx parser against saved fixture HTML (success / blocked-CAPTCHA / no-result → null); factory throws when disabled → source omitted.
- Measure: extend `scripts/coverage-probe.ts` to query ML + Amazon → per-source + combined coverage of the 59 active (expect low Amazon yield from the datacenter IP — that's the point of measuring).

---

## 5. Apply-chain compatibility (critical)
`pricing-apply` (`selectSkus`) consumes `confident[]`/`flagged[]` as `ApplySku { sku, shopifyVariantId, suggestedPriceMxn, currentPriceMxn? }`. All new fields (`quotes`, `chosenSource`, `summary.bySource`) are **additive** — never rename/remove the consumed fields. A driven draft→apply integration test (multi-source output) is required before merge.

---

## 6. Tests
- `integrations`: ML→CompetitorQuote adapter; amazon-mx parser (fixture: success / blocked / no-result); amazon source disabled → omitted/fail-soft.
- `pricing`: multi-source gather + min-accepted aggregation; per-quote scoring picks the right `chosenSource`; report builder md/csv; draft→apply chain compat; `computeAggregates` unaffected.
- `scripts/check-no-mock-render.sh` unaffected (backend-only changes).
- Run: `pnpm test`, per-package `tsc --noEmit` (integrations, workflows/pricing, worker, contract), `vite build` if web touched (it isn't in this feature).

## 7. Verification (end-to-end)
1. Unit + typecheck + build green.
2. Live (read-only): extend & run `scripts/coverage-probe.ts` for ML + Amazon → per-source + combined coverage of the 59 active. Record the Amazon yield (likely low from datacenter IP → validates the fail-soft design).
3. A real `pricing-draft` run for mi-pase → `engine_runs.output` carries `quotes`/`chosenSource`/`summary.bySource`; `buildPricingReportMarkdown/Csv(output)` produce a valid report from that output (asserted in unit tests, since there's no live download path yet).

## 8. Risks & open flags
- **Amazon yield from datacenter IP likely low** (CAPTCHA/blocks) → residential-proxy infra is a separate decision; until then Amazon mostly fail-softs to ML. Surface per-source success in `summary.bySource` so yield is visible.
- **ToS/legal:** scraping is a product-owner decision; keep it polite (UA, rate-limit, single attempt, no aggressive crawling).
- **Report download** has NO live path in v1 (artifactDir is ephemeral). The output carries everything; builders render on demand. Productized `engine_reports` table + authed GET endpoint deferred (ties to the glass-box).
- **Perf:** query sources concurrently per SKU (not sequentially) or wall-clock approaches `PRICING_DRAFT_TIMEOUT_MS` (20 min) as sources are added.
- **Determinism:** stamp `fetchedAt` from an injected clock/run-start time, not `Date.now()` inside the workflow, so tests stay deterministic.
- **cheerio** dependency added to the integrations package.
- **ML token persistence** (separate latent bug, see REPORT.md §7) — ML rotates the refresh token on use and the worker doesn't persist it; unrelated to this feature but blocks scheduled runs ~6h post-deploy.

## 9. Branching
Branch `feat/competitor-pricing-sources` off latest `origin/main`. **PR 1 = Phase 1 + 2** (seam + complete output + report, ML-only — safe, no ToS surface). **PR 2 = Phase 3** (Amazon scraper) so the ToS-sensitive scraper is reviewable in isolation.

## 10. Ultracode execution notes
Sequential phases with clean file boundaries → safe to run in one working tree (no worktree isolation needed): **P1 (seam + ML refactor)** → **P2 (output + report builders)** → **P3 (Amazon source)**, each gated by `pnpm test` + per-package `tsc`. P1 and P2 are the ML-only PR; P3 is the scraper PR. Adversarial-verify focus areas for a workflow's verify phase: (a) apply-chain compat (confident/flagged `ApplySku` fields intact); (b) golden test that single-ML gather reproduces today's output exactly; (c) Amazon fail-soft never throws into the run; (d) min-accepted aggregation + `chosenSource` correctness when ≥2 sources match. STOP at PRs (no auto-merge); no live scraping in CI (fixture HTML only).

## GSTACK REVIEW REPORT
**Skill:** /plan-eng-review · **Target:** `docs/dev/plans/competitor-pricing-sources.md` (reviewed vs. real code) · **Branch:** main

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| F1 | Plan emitted the report to `ctx.artifactDir`, which is ephemeral `/tmp/godin-engine/<runId>` (worker:147) — not persisted/served → no-op | 🔴 correctness | Report = extended `engine_runs.output` (durable) + pure builders; **no artifactDir write**; download path deferred. (user: output+builders) |
| F2 | Plan had the worker pick enabled sources from `engine_tenant_integrations`, but provider factories resolve **synchronously** (resolver:72) → can't async-read the DB | 🔴 feasibility | v1 = workflow composes sources from **env-config** via try/catch; DB-driven per-tenant selection deferred (needs a `loadTenantCompetitorSources` pre-load). (user: env-compose) |
| F3 | `competitor-sources` pseudo-integration returning an array was ambiguous (throw vs empty) | 🟡 design | Workflow composes the list explicitly (`ml` + try/catch `amazon-mx`); no magic accessor. |
| F4 | Multi-source lookups paced sequentially would push wall-clock toward the 20-min timeout | 🟡 perf | Query sources **concurrently per SKU** (`Promise.all`); keep per-SKU pacing. |
| F5 | `fetchedAt` via `Date.now()` would make tests non-deterministic | 🟢 quality | Inject a clock / run-start timestamp. |
| F6 | Complexity check: ~8 files across 3 packages + a scraper | 🟢 scope | Confirmed not overbuilt; reduced by F1/F2 (dropped DB-selection + artifactDir + pseudo-integration). Two PRs (ML-only, then scraper). |

**Apply-chain safety:** verified — `pricing-apply.selectSkus` reads only `ApplySku {sku, shopifyVariantId, suggestedPriceMxn, currentPriceMxn?}`; all new output fields are additive. Chain-compat test required before merge.

**Outside voice (Codex/cross-model):** not run (focused plan-doc review against verified code paths).

**VERDICT:** APPROVED for ultracode after the F1–F5 edits (folded into the doc above). Ship as two PRs (Phase 1+2 ML-only, then Phase 3 Amazon scraper).

NO UNRESOLVED DECISIONS
