# Mi Pase pricing — data reconciliation (2026-06-23)

Cross-check of the cost CSV against the **live** Shopify store before any production
pricing run. Store: **Mi Pase** (`mipase.mx` / `3mj4gx-mj.myshopify.com`), read via the
deployed read-only Admin token. Engine logic = real `computeSuggestedPrice`, floor 15%.

## Headline: the real go-live set is ~47 SKUs, not 602

| Source | Count |
|---|---|
| CSV `Precios-y-Margenes-Mi-Pase-2` distinct SKUs | **602** |
| Shopify products / distinct SKUs | 466 / **459** |
| Shopify **active** (published) | **59** |
| Shopify draft | 407 |

## The join (CSV cost ↔ Shopify SKU)

Matched on SKU, barcode, and UPC, with leading-zero/whitespace normalization.

| Bucket | Count | Meaning |
|---|---|---|
| CSV ∩ Shopify (exact SKU) | **270** | all have cost |
| └ **active + cost** | **54** | priceable today |
| └ └ **with trustworthy cost** | **47** | clean ready set |
| └ draft + cost | 216 | activatable to expand the universe |
| CSV SKUs not in Shopify (any key) | 332 | cost for products not in the store |
| Shopify SKUs with no cost | 189 | can't price (incl. 5 active) |

Normalization recovered **0** extra matches — the 332 missing SKUs are genuinely absent
(the `0883001014056` vs `088300101405` pairs are different products, not format drift).

## Data-quality issues found

1. **Bogus cost placeholder.** `$11,600` is repeated across 7 unrelated active products
   (LG speaker `XG8T`, soundbar `SK1D`, earbuds `BUDS`, TVs). **7 of 54 active SKUs have
   `cost > current price`** — impossible. These produce false `manual_review` flags
   (current price "below floor"). Fix the cost source for: `XG8T, SK1D, BUDS, MS1596CIR,
   MS3032JAS, 34WR50QK-B, XG2TBK`.
2. **Stale CSV prices.** Live Shopify price differs from the CSV's `Variant Price` on
   **all 54** active SKUs (e.g. `55QNED82ASG` Shopify $11,899 vs CSV $14,899). The engine
   uses the **live** Shopify price — correct — so the CSV's own suggested prices are outdated.

## Engine recommendation over the 54 active+cost SKUs (live price · CSV cost · CSV competitor · 15% floor)

| Decision | Count |
|---|---|
| hold | 14 |
| lower_to_competitor | 11 |
| hold_above_floor | 10 |
| manual_review | 19 (← 7 inflated by the $11,600 placeholder) |
| skipped | 0 |

35 SKUs get a concrete suggested price; net change ≈ **−$65,086 MXN**. After fixing the 7
bad-cost SKUs, manual_review drops toward ~12 and the confident set rises to ~47.

## Engine bugs to fix before a live run (see Track B follow-up)

1. **`getCatalog()` is single-page, capped at 250, no pagination**
   (`integrations/src/shopify/index.ts:149`) → silently drops 216 of 466 products.
2. **No status filter** → mixes 407 drafts with 59 active. Decide: price active only?

## Decisions needed from Mi Pase

1. Confirm the pricing universe = the 59 active products (or activate more of the 216
   draft-with-cost SKUs).
2. Fix the 7 placeholder costs (and ideally a fresh cost export aligned to live SKUs).
3. Confirm SKU is the canonical join key (332 CSV rows have no store match).

## Artifacts
- `ready-to-price-active54.csv` — the 54 active+cost SKUs with engine decision + suggested price.
- `recommendations-floor15.csv` — full 602-row CSV-only preview (NOT representative; superseded by this).
- Harness: `code/godin-engine-v0.1/scripts/{mipase-pricing-preview,run-ready}.ts`.
