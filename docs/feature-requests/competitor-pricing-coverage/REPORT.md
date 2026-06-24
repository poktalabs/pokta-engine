# Competitor Pricing Coverage — Findings & Feature Hand-off

**Date:** 2026-06-24 · **Author:** investigation w/ Mel (mel@innvertir.com) · **Tenant:** mi-pase
**Branch:** `feat/ml-match-recall` · **Related:** `docs/feature-requests/workflow-legibility/DESIGN.md` (glass-box), `~/.claude/plans/cuddly-drifting-nygaard.md` (glass-box plan)

---

## 1. TL;DR

Mi Pase's first demo couldn't show real app output. Chasing that surfaced a chain of issues; the **decisive finding** is a hard ceiling on competitor coverage:

> **Of the 59 active Shopify products, only ~14 (24%) have a trustworthy, priced Mercado Libre competitor — and that is *with* the full matching recipe built.** The current engine finds ~8. The bottleneck is **Mercado Libre's marketplace inventory, not our matching code.**

Two consequences drive everything below:
1. **Competitor-driven pricing via ML alone can only ever cover ~¼ of the active catalog.** For the other ~75%, the engine correctly holds (no competitor) — honest, but not a "reprice your whole store" story.
2. **Broad coverage requires additional competitor sources** (Amazon / Walmart / Coppel MX), which is a new feature (§6), much bigger than the ML recall tweak.

---

## 2. What we measured (evidence)

All numbers from read-only probes running the **real engine code path** (active catalog → `buildProductIdentityFromShopify` → `ml.search` → `scoreProductMatch`). Probes in `scripts/` (§8).

| Metric | Value |
|---|---|
| Shopify active products | **59** (466 total; 407 draft) |
| Active with cost (from CSV) | 54 |
| Live ML raw hit (any price) | 32/54 (59%) — **wrong-match contaminated** |
| **Confident after scoring** (current engine) | 12/54 (~8 with a real competitor price) |
| **Trustworthy + priced, with full recipe** | **14/59 (24%)** · 11/54 with cost |

The match-scorer **already rejects garbage** (a washer matched to a $135 accessory, an 86″ TV to $8,640 → both dropped). The engine is **honest but thin**, not dangerous.

### Why the other 45 active products fail

| Bucket | ~count | Reason | Addressable by us? |
|---|---|---|---|
| **Found** (high + priced) | 14 | clean ML match, live price | ✅ recipe |
| High match, no active price | ~7 | in ML catalog, **no priced offer** (65QNED82, 86UA7500, BEFP42, A17, A56…) | ❌ ML has nothing to compare |
| No ML match | ~13 | not on ML by GTIN — washers, fridges, big appliances | ❌ not sold on ML |
| Phones (medium) | ~16 | no MPN metadata + ML generation ambiguity (S25≠S23, Edge 60≠50) | ⚠️ partial (phone model extraction) |
| Weak/wrong (low) | ~8 | correctly rejected | ⚠️ marginal |

Realistic ceiling even with phone-model extraction ≈ **⅓** of the active catalog.

---

## 3. Suggestions

1. **Accept ML's ~¼ ceiling and split the value story.** For the ~14 ML-covered SKUs, show real competitor repricing. For the rest, lead with the **cost + 15% margin-floor governance** (validated, real) — not competitor matching. Frame this honestly with Mi Pase.
2. **Decide the recall-recipe ROI deliberately.** Building the metaBySku/GTIN recipe (§5) lifts ~8 → ~14 (+6 SKUs). Real but modest. Worth it if you want max value from ML; not a coverage unlock.
3. **Pursue multi-source competitor data as the real coverage lever** (§6) — this is the only path past ~⅓.
4. **Push two data-quality items to Mi Pase:** fix the 7 placeholder costs (`$11,600` on unrelated SKUs → false `manual_review`); confirm SKU vs UPC as the canonical key (332 of the 602 CSV SKUs aren't in the store at all).
5. **Fix the latent ML token-persistence bug** (§7) before any scheduled run — ML breaks ~6h after a deploy today.

---

## 4. What shipped this investigation

- **`fix(pricing): match required/forbidden terms on token boundaries`** (commit `ffb74aa`) — forbidden `led` was matching inside `oled` (substring on the separator-stripped title), rejecting the correct premium TV. Now token-boundary matched. 21+1 tests; full pricing suite green (196). **Prerequisite** for §5 (feeding CSV forbidden terms safely).
- Measurement probes (`scripts/`, §8) — reusable to re-measure coverage anytime.
- ML token re-synced to Railway worker + redeployed (token hygiene, see §7).

---

## 5. Hand-off — Glass-box run view (designed, HELD)

**Status:** fully designed, **not built**, intentionally held until competitor coverage is decided. A glass-box around a thin run shows a sparse picture.

- **Design:** `docs/feature-requests/workflow-legibility/DESIGN.md` (+ `preview.html`) on branch `docs/workflow-legibility` (local, unmerged). Anatomy §3, component map §5, run states §6, build plan §8.
- **Implementation plan:** `~/.claude/plans/cuddly-drifting-nygaard.md` — the v1 build (output adapter for the REAL `PricingDraftOutput` shape, `PipelineFlow` spine from the `parentRunId` chain, `RunStageDrawer`, `GET /v1/runs/:id/workflow-state`, `rulesMeta`, recommend-mode "suggested not applied", `--font-mono`).
- **Critical prerequisites the plan already documents:**
  - **Output shape mismatch** — `RunDetail.tsx` renders an invented mock shape; the real worker emits `{summary, confident, flagged}`. The adapter is the must-fix.
  - A **real run must exist** — trigger via `app.pokta.xyz/mi-pase/workflows/pricing-draft`, but that button currently dispatches **empty input** (no `costBySku`/floor) → bundle the cost map and wire the dispatch (plan §A).
- **Re-frame from this report:** the glass-box should make the recommend-mode + thin-coverage reality *legible and honest* (most stages "held / no competitor"), and its "integrations called" drawer is the natural surface for **multiple competitor sources** (§6) + freshness. Build glass-box AFTER the competitor-source decision so it renders the real, multi-source picture.

---

## 6. New feature — Competitor Pricing Source (multi-source, parallel track)

**Goal:** generalize competitor pricing from "Mercado Libre only" to a **selectable, pluggable set of competitor price sources**, so a tenant can complement ML with other marketplaces and lift coverage past the ~¼ ceiling.

### Problem it solves
ML covers ~14/59 of Mi Pase's catalog. The misses are products ML doesn't carry/price (appliances, fridges, exact phone gens). Other MX marketplaces (Amazon, Walmart, Coppel, Sears) carry many of them. The engine needs a way to pull, match, and combine competitor prices from more than one source.

### Design (mirror the existing integration-resolver seam)
```
                         ┌── mercado-libre (exists)
ProductIdentity ──> CompetitorSourceRegistry ──┼── amazon-mx        each: lookup(identity) ->
   (per tenant config)                         ├── walmart-mx        { price_mxn, confidence,
                                               └── coppel-mx          freshness, url, source }
                                                      │
                                          aggregate(results[]) -> competitor_min_mxn (policy)
                                                      │
                                              computeSuggestedPrice(...)
```
- **`CompetitorSource` interface** (one per provider): `lookup(identity) -> CompetitorQuote | null` with `{ price_mxn, matchConfidence, freshnessTs, url, sourceId }`. ML's current client + `scoreProductMatch` become the reference implementation, refactored out of `pricing-draft`'s inline loop into a source.
- **Per-tenant source selection** — which sources are enabled + their trust/priority. Extends the existing `engine_tenant_integrations` (non-secret connection config) + `engine_tenants` allow-list pattern. Surfaces in the SPA Integrations page.
- **Aggregation policy** — when multiple sources return a quote, how to derive `competitor_min_mxn`: `min-across-trusted` (default), `median`, or `primary-with-fallback`. Per-tenant, with the chosen quote + all quotes carried for transparency (feeds the glass-box drawer).
- **Per-source matching** — each source needs identity→listing matching (GTIN/MPN/title) like ML. `scoreProductMatch` generalizes; GTIN/MPN are the strongest cross-source keys (validated for ML).

### The hard part (flag early)
Data acquisition differs wildly per source:
- **Amazon MX** — SP-API / Product Advertising API (most API-friendly; start here).
- **Walmart MX, Coppel, Sears** — limited/no public price APIs → licensed data feeds or scraping. Scraping is fragile + ToS/legal risk; needs explicit sign-off. A **licensed price-intelligence feed** (e.g. a MX retail-price data vendor) may beat per-site integration.
- **Manual/CSV upload source** — possible interim, but Mi Pase confirmed their reference CSV competitor data is **unreliable**, so a manual source is low-trust; not a substitute.

### Phasing
- **P1 — Source seam:** refactor competitor lookup into `CompetitorSourceRegistry` with ML as the sole reference source. No behavior change; pure architecture. Unblocks everything else.
- **P2 — First new source:** add Amazon MX (most API-tractable). Measure the coverage lift with `scripts/coverage-probe.ts` (extend to multi-source).
- **P3 — Selection + aggregation + transparency:** per-tenant source config, aggregation policy, freshness/confidence per quote surfaced in the glass-box "integrations called" drawer.

### Open questions (for product/Mi Pase)
- Which source(s) first, and via API vs licensed feed vs scrape (legal/ToS + cost)?
- Aggregation policy — lowest trusted, or weighted by source reliability?
- Is ~⅓ coverage (ML + Amazon) enough to justify the build, or is a price-intelligence feed the better buy?

### Relationship to glass-box (parallel, complementary)
Independent build tracks. The competitor-source feature **feeds** more/better competitor data; the glass-box **renders** it (its per-stage "integrations called" drawer is designed to show multiple integrations + latency/freshness). Build the source seam (P1) and glass-box adapter in parallel; converge when both land.

---

## 7. Fast-follows & data-quality items

- **⚠️ ML token persistence (latent prod bug):** ML rotates the refresh token on every use; the worker does NOT persist the rotated token → ML breaks ~6h after any deploy once a run refreshes. Needs token persistence (DB/secret store). Tokens re-synced to Railway worker on 2026-06-24, but the underlying bug remains.
- **7 placeholder costs** (`XG8T, SK1D, BUDS, MS1596CIR, MS3032JAS, 34WR50QK-B, XG2TBK`) — `cost > price`, false `manual_review`. Mi Pase to fix.
- **Phone model extraction** — derive model from SKU/title for phones (CSV metadata empty) to lift the ~16 medium phones; ML may still lack exact-generation pricing.
- **Pricing universe** — confirm it's the 59 active (vs activating more of the 216 draft-with-cost).

---

## 8. Reproduce

`code/godin-engine-v0.1/scripts/` (read-only; env from Railway worker vars):
- `coverage-probe.ts` — the headline 14/59 number (recipe: GTIN-first + MPN-as-model + enriched terms).
- `confident-size-probe.ts` — confident/flagged split through the full draft logic.
- `ml-match-probe.ts` — raw ML hit rate + miss reasons.
- `recall-diagnostic.ts` — per-SKU query + ML candidates + per-candidate scores (the root-cause diagnostic).
- `enrich-validate.ts` — GTIN/MPN enrichment validation (one refresh; rotates the ML token — see §7).
