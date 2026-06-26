# Decision — Amazon scraping egress (how the Amazon source actually reaches amazon.com.mx)

**Status:** measured, decided for v1 · **Date:** 2026-06-25 · **Branch:** feat/competitor-pricing-amazon (PR #40)
**Related:** `competitor-pricing-sources.md` (the feature plan) · the Amazon source `integrations/src/amazon-mx/`

---

## 1. The problem
The Amazon MX competitor source scrapes `amazon.com.mx/s?k=…` and parses with cheerio. A **direct fetch from a datacenter IP (Railway / CI sandbox) is blocked** — Amazon gates on IP reputation + request fingerprint, not request rate.

**Measured (this branch, mi-pase live catalog):**
- Direct fetch, datacenter IP: **~0/54 Amazon yield**. A *single* cold request can succeed (Echo Show → $3,899), but a sweep is blocked from request ~2.
- **Pacing did NOT help:** at ~2.5–4 s between requests, still **1/20** got through → the block is **IP/fingerprint, not rate**. (We kept a politeness throttle anyway — it's correct hygiene, off by default, polite-default in the worker.)

## 2. What unblocks it (what a scraping service provides that we don't)
The hard part is **not** the scraping code (we have a pure parser). It's the egress:
1. **Rotating residential/mobile proxy IPs** — the dominant signal; datacenter IPs are blocked, residential pools look like shoppers.
2. **Browser-engine TLS/HTTP fingerprint** — Node `fetch` has a bot-obvious fingerprint; a real browser doesn't.
3. **JS-challenge / CAPTCHA handling**, geo-IPs (MX), cookie/session realism, and ongoing maintenance of the arms race.

## 3. Firecrawl result (the option we tested)
Routing the fetch through **Firecrawl** (`/v1/scrape`, MX location, `proxy: stealth`) — parser unchanged:
- **Amazon found 53/54 (98%)** — block fully solved.
- **Combined ML∪Amazon coverage: 17 → 23 SKUs (+35%)**; **competitor-miss 0**.
- **Actionable competitor outcomes: 7 → 13**; clean `lower_to_competitor` drops **2 → 6**; **confident 18/54**.
- Amazon fills ML's blind spots (e.g. ECHO-SHOW-11: ML found nothing, Amazon $3,899).
- **Match tuning kept Amazon honest** — accessory blocklist + curated per-SKU terms rejected the noise (e.g. SANWI5: Amazon's $157.61 accessory was rejected, ML's real $1,404 chosen). Amazon `accepted` = 14/53 (precision over recall — correct).

**Cost:** `stealth` = **5 credits/scrape** → **~270 credits per full 54-SKU run**. `basic` = **1 credit** and is NOT blocked (HTTP 200), BUT lower yield — some queries return `no_result` on basic (Echo Show parsed null on basic, $3,899 on stealth); `auto` does not escalate on a 200-with-no-results, so it stayed cheap-but-thin. **basic is cheaper, not free recall.**

### Credit math (Firecrawl free tier = 1,000/month)
| Strategy (daily runs) | Credits/month |
|---|---|
| Naive: stealth, every SKU, every run | ~8,100 ❌ |
| Weekly cache + stealth (all 54) | ~1,160 (just over) |
| **Weekly cache + stealth, ML-first (~37 ML-misses)** | **~795 ✓** |
| Weekly cache + ML-first + basic-first/stealth-on-miss | ~270 ✓✓ |
→ The lever that makes it fit is **caching + ML-first targeting**, not the proxy mode.

## 4. The full egress menu (build ↔ buy)
The fetch is an **injectable strategy** behind the `CompetitorSource` seam and the parser is a **pure function**, so the egress vendor is a **one-function swap, not a foundation** — we are not locked in.

| Option | What it is | Cost | Reliability | Effort | Notes |
|---|---|---|---|---|---|
| **Firecrawl (chosen v1)** | Managed unlocker, returns HTML | 1–5 cr/req; free 1k/mo | High (stealth) | None (wired) | Zero infra; swappable |
| Bright Data / Zyte unlocker | Managed unlocker, returns HTML | per-req, cheaper at volume | High | Low (same seam) | Bigger pools; paid |
| **Rainforest / SerpApi (Amazon)** | Structured Amazon JSON (no parse) | per-req | High | Med (replace parser w/ field map) | Kills accessory-noise; most reliable |
| Amazon PA-API | Official affiliate API | gated | n/a | — | Needs Associate + sales; ToS-restricted → **not viable** for competitor pricing |
| Amazon SP-API | Seller API (own listings) | — | — | — | **Not applicable** (not competitor data) |
| **Tailscale exit-node / home proxy** | Route egress through a residential box on your tailnet (Pi/VPS) | **$0** (Tailscale personal + a ~$35 Pi) | Low-med | Med (always-on box + scoped proxy) | Cleaner than ngrok (egress, private). **Single static IP, no rotation** → fine at our low weekly volume, fragile at scale |
| Self-host Firecrawl | OSS, run ourselves | still rent proxies | High | High | Saves the credit fee, not the proxy cost |
| ngrok + home fetch service | Inbound tunnel to a residential fetch service | $0–low | Low | Med | ngrok is inbound-only; needs a custom fetch service; single IP |

**Note on Tailscale/ngrok/DIY:** these route through **one** residential IP — no rotation. The *robust* version of "our own residential egress" is a rotating residential-proxy **pool** (Bright Data/Oxylabs/Smartproxy/IPRoyal, per-GB). One static IP is acceptable only at low weekly volume.

## 5. Decision (v1)
- **Ship the Amazon source with the Firecrawl backend behind the injectable seam** (`firecrawlKey` config; worker reads `FIRECRAWL_API_KEY` / `${PREFIX}_FIRECRAWL_API_KEY`; absent → direct fetch). Opt-in per tenant, fail-soft throughout. ✅ in this PR.
- **Run on the Firecrawl free tier**, made to fit by the deferred **caching + ML-first** work (below).
- **Stay vendor-agnostic** — the seam means Bright Data / a structured Amazon API / a Tailscale exit node can replace the fetch later with no rework.

## 6. Deferred (the follow-up that makes a daily pipeline viable)
1. **Competitor-price cache + TTL** — `engine_competitor_quotes` (sku · source · price · fetchedAt); the daily run reads cache, only (re)scrapes stale/missing (weekly Amazon refresh). The single biggest credit lever; also makes the report's `fetchedAt` meaningful.
2. **ML-first targeting** — only scrape Amazon for SKUs ML can't cover (~37/54) or high-value SKUs.
3. **basic-first / stealth-on-miss** — try `basic` (1 cr); escalate that SKU to `stealth` (5 cr) only when the parse misses. ~30% extra trim.
4. **Re-evaluate vendor at volume** — structured Amazon API (Rainforest/SerpApi) for reliability, or Bright Data / a rotating residential pool (or a Tailscale exit node for a $0 low-volume self-host) — all swap behind the existing seam.
