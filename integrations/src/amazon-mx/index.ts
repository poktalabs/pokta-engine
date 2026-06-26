/**
 * Amazon MX as a {@link CompetitorSource} (plan §3.3, PR2).
 *
 * Amazon has no public price API for arbitrary search, so this source SCRAPES
 * `amazon.com.mx/s?k=<query>` and parses the result cards with cheerio. It is a
 * best-effort, ToS-gray source: from a datacenter IP (Railway) most requests are
 * CAPTCHA-blocked, so the design's first job is to FAIL SOFT — `lookup` resolves
 * to a quote ONLY on a clean parse, and to `null` on any block / no-result /
 * parse miss / network error. It NEVER throws into a run. (The gather loop in
 * pricing-draft also wraps every lookup in `.catch(→null)` as defense-in-depth.)
 *
 * Architecture: the HTML parsing is a PURE function ({@link parseAmazonSearchHtml})
 * so it is unit-tested against saved fixture HTML with no network; the fetch
 * shell ({@link createAmazonMxSource}) is the only impure part. The coverage
 * probe imports the pure parser to classify per-source yield offline.
 */

import { load } from 'cheerio'

import type { CompetitorSource, CompetitorQuote } from '../competitor/types.js'

export const AMAZON_MX_SOURCE_ID = 'amazon-mx'
const AMAZON_MX_ORIGIN = 'https://www.amazon.com.mx'
/** A realistic desktop UA — a blank/curl UA is blocked instantly. */
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** Config for the Amazon MX source. `enabled:false` ⇒ the factory omits it. */
export interface AmazonMxConfig {
  /** Master switch — must be true or {@link createAmazonMxSource} throws "not configured". */
  enabled: boolean
  /** Optional origin override for a residential-proxy front (defaults to amazon.com.mx). */
  proxyUrl?: string
  /** Optional UA override (defaults to a realistic desktop Chrome UA). */
  userAgent?: string
  /**
   * Minimum gap (ms) the source enforces between its OWN requests — a politeness
   * throttle so a multi-SKU sweep doesn't burst and trip Amazon's bot detection.
   * Default 0 (no throttle; tests stay instant). The worker sets a real value.
   */
  minIntervalMs?: number
  /**
   * Random extra 0..jitterMs added to each gap so requests don't fire on a fixed
   * cadence (a burst tell). Default 0. Only meaningful with {@link minIntervalMs}.
   */
  jitterMs?: number
  /**
   * When set, fetch the page THROUGH Firecrawl (api.firecrawl.dev) instead of a
   * direct request — Firecrawl owns the proxy + anti-bot layer that a datacenter
   * IP gets blocked on (measured). The parser is unchanged; only the fetch swaps.
   * Absent ⇒ direct fetch.
   */
  firecrawlKey?: string
  /** Firecrawl proxy mode for the scrape. Default 'stealth' (best anti-bot, 5 credits). */
  firecrawlProxy?: 'basic' | 'stealth' | 'auto'
  /** Firecrawl scrape timeout (ms). Default 60000. */
  firecrawlTimeoutMs?: number
}

/** Why a lookup produced no usable quote — surfaced by the PURE parser for probes. */
export type AmazonParseReason = 'ok' | 'blocked' | 'no_result' | 'parse_error'

/** Result of parsing a search page: a quote on success, plus the classified reason. */
export interface AmazonParseResult {
  quote: CompetitorQuote | null
  reason: AmazonParseReason
  /** Candidate cards inspected (observability, even when none was usable). */
  candidatesChecked: number
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Markers that mean Amazon served a bot-check instead of results (block). */
const BLOCK_MARKERS = [
  '/errors/validateCaptcha',
  'api-services-support@amazon.com',
  'Type the characters you see in this image',
  'Enter the characters you see below',
  'To discuss automated access',
  'Robot Check',
]

/** Lowercase alnum tokens (>=2 chars) for title-overlap scoring. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

/** Parse an Amazon MXN price string ("$1,234.00") → number, or null. */
export function parseMxnPrice(raw: string | undefined | null): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.,]/g, '')
  if (!cleaned) return null
  // Mexican format uses '.' as decimal + ',' as thousands → drop commas.
  const n = Number(cleaned.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Count how many query tokens appear in the title (overlap score). */
function overlapScore(queryTokens: string[], title: string): number {
  if (queryTokens.length === 0) return 0
  const titleTokens = new Set(tokenize(title))
  let n = 0
  for (const t of queryTokens) if (titleTokens.has(t)) n++
  return n
}

/**
 * PURE parser: given a search-results HTML page and the query, return the best
 * priced card as a {@link CompetitorQuote} (priceMxn set; `fetchedAt:''` for the
 * caller to stamp), or `null` with a classified reason. Never throws — a parse
 * exception is caught and classified `parse_error`.
 */
export function parseAmazonSearchHtml(
  html: string,
  query: string,
  origin = AMAZON_MX_ORIGIN,
): AmazonParseResult {
  try {
    // Bot-check pages can come back with HTTP 200 — detect them by content.
    // (Inside the try so a non-string `html` classifies parse_error, never throws.)
    if (BLOCK_MARKERS.some((m) => html.includes(m))) {
      return { quote: null, reason: 'blocked', candidatesChecked: 0 }
    }

    const $ = load(html)
    const queryTokens = tokenize(query)
    const cards = $('div[data-component-type="s-search-result"][data-asin]').toArray()

    /**
     * The card's CURRENT (sale) price = the lowest non-strikethrough `.a-offscreen`
     * in the card. Amazon renders the struck-through LIST price (`.a-text-price` /
     * `data-a-strike="true"`) BEFORE the sale block, so a blind `.first()` would
     * return the higher list price and overstate the competitor (seam contract:
     * priceMxn = the LOWEST usable price). We skip strikethrough blocks and take
     * the min of what remains; if every block is struck, fall back to the min of
     * all prices rather than invent nothing.
     */
    const extractCardPriceMxn = (card: ReturnType<typeof $>): number | null => {
      const live: number[] = []
      const all: number[] = []
      card.find('.a-price').each((_i, el) => {
        const block = $(el)
        const p = parseMxnPrice(block.find('.a-offscreen').first().text())
        if (p == null) return
        all.push(p)
        const struck =
          (block.attr('class') ?? '').split(/\s+/).includes('a-text-price') ||
          block.attr('data-a-strike') === 'true'
        if (!struck) live.push(p)
      })
      const pool = live.length ? live : all
      return pool.length ? Math.min(...pool) : null
    }

    let best: { title: string; priceMxn: number; permalink: string | null; asin: string; score: number } | null = null
    let candidatesChecked = 0

    for (const el of cards) {
      const card = $(el)
      const asin = (card.attr('data-asin') ?? '').trim()
      if (!asin) continue
      candidatesChecked++

      // Title: Amazon varies between <h2><a><span> and <h2><span>.
      const title = (card.find('h2 a span').first().text() || card.find('h2 span').first().text()).trim()
      const priceMxn = extractCardPriceMxn(card)
      if (!title || priceMxn == null) continue // only priced, titled cards qualify

      const href = card.find('h2 a').first().attr('href') ?? null
      const permalink = href ? (href.startsWith('http') ? href : `${origin}${href}`) : null
      const score = overlapScore(queryTokens, title)

      // Best = highest title-overlap; ties keep the earlier (higher-ranked) card.
      if (best == null || score > best.score) {
        best = { title, priceMxn, permalink, asin, score }
      }
    }

    // Require a MINIMUM relevance: if the top card shares NO token with the query
    // (every card scored 0), this is not a real match — fail soft to no_result
    // rather than emit an unrelated product's price as a confident competitor.
    // (A search returns the most popular items even with zero query relevance.)
    if (!best || best.score < 1) {
      return { quote: null, reason: 'no_result', candidatesChecked }
    }

    const quote: CompetitorQuote = {
      source: AMAZON_MX_SOURCE_ID,
      title: best.title,
      priceMxn: best.priceMxn,
      permalink: best.permalink,
      productId: best.asin,
      categoryId: null,
      candidatesChecked,
      failureReason: null,
      fetchedAt: '', // stamped by the caller
    }
    return { quote, reason: 'ok', candidatesChecked }
  } catch {
    return { quote: null, reason: 'parse_error', candidatesChecked: 0 }
  }
}

// ── The source (fetch shell) ─────────────────────────────────────────────────

/** Build the search URL for a query against the configured origin. */
export function amazonSearchUrl(query: string, origin = AMAZON_MX_ORIGIN): string {
  return `${origin}/s?k=${encodeURIComponent(query)}`
}

/**
 * Create the Amazon MX {@link CompetitorSource}. Config-gated: `enabled:false`
 * THROWS "not configured" (the canonical resolver pattern → the workflow omits
 * the source). `lookup` does ONE polite request (realistic UA, AbortSignal, no
 * internal retry) and fail-softs to `null` on any non-200 / block / no-result /
 * parse miss / network error — it never throws.
 */
export function createAmazonMxSource(config: AmazonMxConfig): CompetitorSource {
  if (!config.enabled) {
    throw new Error('Amazon MX not configured (set enabled:true to use the scraping source)')
  }
  const directOrigin = config.proxyUrl?.replace(/\/+$/, '') ?? AMAZON_MX_ORIGIN
  const userAgent = config.userAgent ?? DEFAULT_USER_AGENT
  const minIntervalMs = Math.max(0, config.minIntervalMs ?? 0)
  const jitterMs = Math.max(0, config.jitterMs ?? 0)
  const firecrawlKey = config.firecrawlKey
  const firecrawlProxy = config.firecrawlProxy ?? 'stealth'
  const firecrawlTimeoutMs = config.firecrawlTimeoutMs ?? 60000
  // Through Firecrawl we ask for the REAL amazon.com.mx URL (Firecrawl is the
  // proxy); direct mode honors any proxyUrl origin override. The chosen origin is
  // also the permalink base the parser uses.
  const scrapeOrigin = firecrawlKey ? AMAZON_MX_ORIGIN : directOrigin

  /**
   * Fetch the search-results HTML for a query — via Firecrawl when a key is set,
   * else a direct request. Returns the HTML string, or null on any failure
   * (non-200 / Firecrawl error / network) so the source stays fail-soft.
   */
  async function fetchHtml(query: string, signal?: AbortSignal): Promise<string | null> {
    const target = amazonSearchUrl(query, scrapeOrigin)
    if (firecrawlKey) {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: target,
          formats: ['rawHtml'],
          location: { country: 'MX', languages: ['es-MX'] },
          proxy: firecrawlProxy,
          timeout: firecrawlTimeoutMs,
        }),
        signal,
      })
      if (!res.ok) return null
      const body = (await res.json()) as {
        success?: boolean
        data?: { rawHtml?: string; html?: string }
      }
      if (!body.success) return null
      return body.data?.rawHtml || body.data?.html || null
    }
    const res = await fetch(target, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'es-MX,es;q=0.9',
      },
      signal,
    })
    // Non-200 (incl. 503 Robot Check) → treat as blocked/unavailable.
    if (!res.ok) return null
    return await res.text()
  }

  // Politeness throttle: serialize this source's requests so consecutive Amazon
  // hits are >= minIntervalMs (+ jitter) apart, even when the caller queries fast.
  // `nextAllowedAt` reserves the next slot, so it stays correct under concurrent
  // calls too. Default 0 → no wait (unit tests stay instant).
  let nextAllowedAt = 0
  async function throttle(): Promise<void> {
    if (minIntervalMs === 0 && jitterMs === 0) return
    const now = Date.now()
    const start = Math.max(now, nextAllowedAt)
    const gap = minIntervalMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0)
    nextAllowedAt = start + gap // reserve this slot before awaiting
    const waitMs = start - now
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  return {
    id: AMAZON_MX_SOURCE_ID,
    async lookup(query, opts): Promise<CompetitorQuote | null> {
      try {
        await throttle()
        const html = await fetchHtml(query, opts?.signal)
        if (html == null) return null
        return parseAmazonSearchHtml(html, query, scrapeOrigin).quote
      } catch {
        return null // network error / abort / Firecrawl error → fail-soft
      }
    },
  }
}
