import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  parseAmazonSearchHtml,
  parseMxnPrice,
  amazonSearchUrl,
  createAmazonMxSource,
  AMAZON_MX_SOURCE_ID,
} from './index'

const fixture = (name: string): string =>
  readFileSync(new URL(`./__fixtures__/${name}.html`, import.meta.url), 'utf-8')

// ---- pure parser ---------------------------------------------------------

describe('parseAmazonSearchHtml', () => {
  it('returns the best priced, highest-overlap card on a real results page', () => {
    const r = parseAmazonSearchHtml(fixture('search-success'), 'licuadora oster 1200')
    expect(r.reason).toBe('ok')
    expect(r.candidatesChecked).toBe(3) // 3 cards carry data-asin
    expect(r.quote).toEqual({
      source: 'amazon-mx',
      title: 'Licuadora Oster 1200 Watts Vaso Vidrio',
      priceMxn: 1249,
      permalink: 'https://www.amazon.com.mx/Licuadora-Oster-1200/dp/B07OSTER12',
      productId: 'B07OSTER12',
      categoryId: null,
      candidatesChecked: 3,
      failureReason: null,
      fetchedAt: '', // stamped by the caller, never by the parser
    })
  })

  it('does NOT pick a cheaper but unrelated card (overlap wins, not price)', () => {
    // The cafetera card is cheaper ($499) but shares no tokens with the query.
    const r = parseAmazonSearchHtml(fixture('search-success'), 'licuadora oster 1200')
    expect(r.quote!.productId).toBe('B07OSTER12')
    expect(r.quote!.priceMxn).toBe(1249)
  })

  it('returns the SALE price, not the struck-through list price, on a discounted card', () => {
    // List $2,000 renders before sale $1,500 — a blind .first() would overstate.
    const r = parseAmazonSearchHtml(fixture('search-discount'), 'licuadora oster')
    expect(r.reason).toBe('ok')
    expect(r.quote!.priceMxn).toBe(1500)
  })

  it('fails soft to no_result when NO card shares a token with the query (no false positive)', () => {
    // The page has priced cards, but none overlaps "zzz nonsense query" → we must
    // NOT emit an unrelated product as a confident competitor quote.
    const r = parseAmazonSearchHtml(fixture('search-success'), 'zzz nonsense query')
    expect(r.quote).toBeNull()
    expect(r.reason).toBe('no_result')
    expect(r.candidatesChecked).toBe(3) // cards were inspected, just none relevant
  })

  it('classifies a CAPTCHA/robot-check page as blocked → null', () => {
    const r = parseAmazonSearchHtml(fixture('search-blocked'), 'anything')
    expect(r.reason).toBe('blocked')
    expect(r.quote).toBeNull()
  })

  it('classifies a no-results page as no_result → null', () => {
    const r = parseAmazonSearchHtml(fixture('search-no-result'), 'xyzzy producto inexistente')
    expect(r.reason).toBe('no_result')
    expect(r.quote).toBeNull()
    expect(r.candidatesChecked).toBe(0)
  })

  it('never throws on malformed HTML (classifies parse_error or no_result)', () => {
    const r = parseAmazonSearchHtml('<div data-component-type="s-search-result"', 'q')
    expect(r.quote).toBeNull()
    expect(['parse_error', 'no_result']).toContain(r.reason)
  })
})

describe('parseMxnPrice', () => {
  it('parses Mexican price strings and rejects junk', () => {
    expect(parseMxnPrice('$1,249.00')).toBe(1249)
    expect(parseMxnPrice('$499')).toBe(499)
    expect(parseMxnPrice('$12,345.67')).toBe(12345.67)
    expect(parseMxnPrice('')).toBeNull()
    expect(parseMxnPrice(null)).toBeNull()
    expect(parseMxnPrice('No disponible')).toBeNull()
    expect(parseMxnPrice('$0.00')).toBeNull() // a zero price is not usable
  })
})

describe('amazonSearchUrl', () => {
  it('builds an encoded amazon.com.mx search URL', () => {
    expect(amazonSearchUrl('oster 1200')).toBe('https://www.amazon.com.mx/s?k=oster%201200')
  })
  it('honors a proxy origin override', () => {
    expect(amazonSearchUrl('q', 'https://proxy.example')).toBe('https://proxy.example/s?k=q')
  })
})

// ---- factory + fetch shell (fail-soft) -----------------------------------

describe('createAmazonMxSource', () => {
  it('throws "not configured" when disabled (→ resolver omits the source)', () => {
    expect(() => createAmazonMxSource({ enabled: false })).toThrow(/not configured/i)
  })

  it('builds a source with the canonical id when enabled', () => {
    const src = createAmazonMxSource({ enabled: true })
    expect(src.id).toBe(AMAZON_MX_SOURCE_ID)
  })
})

describe('amazon-mx lookup (fail-soft fetch shell)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  function htmlResponse(html: string, init: { ok?: boolean; status?: number } = {}) {
    return { ok: init.ok ?? true, status: init.status ?? 200, text: async () => html }
  }

  it('returns a quote on a clean 200 results page', async () => {
    fetchMock.mockResolvedValue(htmlResponse(fixture('search-success')))
    const src = createAmazonMxSource({ enabled: true })
    const quote = await src.lookup('licuadora oster 1200')
    expect(quote!.source).toBe('amazon-mx')
    expect(quote!.priceMxn).toBe(1249)
    // the configured UA + es-MX header were sent
    const [, init] = fetchMock.mock.calls[0]!
    expect(init.headers['Accept-Language']).toContain('es-MX')
    expect(init.headers['User-Agent']).toMatch(/Mozilla/)
  })

  it('fails soft to null on a non-200 (e.g. 503 Robot Check)', async () => {
    fetchMock.mockResolvedValue(htmlResponse('Robot Check', { ok: false, status: 503 }))
    const src = createAmazonMxSource({ enabled: true })
    await expect(src.lookup('q')).resolves.toBeNull()
  })

  it('fails soft to null on a 200 CAPTCHA page', async () => {
    fetchMock.mockResolvedValue(htmlResponse(fixture('search-blocked')))
    const src = createAmazonMxSource({ enabled: true })
    await expect(src.lookup('q')).resolves.toBeNull()
  })

  it('NEVER throws when fetch rejects (network error/abort) → null', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const src = createAmazonMxSource({ enabled: true })
    await expect(src.lookup('q')).resolves.toBeNull()
  })

  it('routes through a proxy origin when configured', async () => {
    fetchMock.mockResolvedValue(htmlResponse(fixture('search-no-result')))
    const src = createAmazonMxSource({ enabled: true, proxyUrl: 'https://proxy.example/' })
    await src.lookup('q')
    expect(fetchMock.mock.calls[0]![0]).toBe('https://proxy.example/s?k=q')
  })
})
