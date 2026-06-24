import { describe, it, expect } from 'vitest'

import { buildPricingReportMarkdown, buildPricingReportCsv } from './pricing-report'
import { computeAggregates } from './aggregates'
import type { PricingDraftOutput, PricingSkuResult, QuoteWithMatch } from '../pricing-draft/index'

function q(over: Partial<QuoteWithMatch> & Pick<QuoteWithMatch, 'source'>): QuoteWithMatch {
  return {
    source: over.source,
    title: over.title ?? null,
    priceMxn: over.priceMxn ?? null,
    permalink: over.permalink ?? null,
    productId: over.productId ?? null,
    categoryId: over.categoryId ?? null,
    candidatesChecked: over.candidatesChecked ?? 0,
    failureReason: over.failureReason ?? null,
    fetchedAt: over.fetchedAt ?? '2026-06-24T00:00:00.000Z',
    matchConfidence: over.matchConfidence ?? null,
    matchDecision: over.matchDecision ?? 'reject',
  }
}

// A confident SKU priced to the cheaper accepted (amazon) + a flagged miss.
const confident: PricingSkuResult = {
  sku: 'ASKU',
  title: 'Licuadora Oster 1200',
  shopifyVariantId: 11,
  currentPriceMxn: 1000,
  competitorMinMxn: 750,
  suggestedPriceMxn: 750,
  decision: 'lower_to_competitor',
  reason: 'competitor below current, above floor',
  matchConfidence: 'high',
  matchDecision: 'accept',
  competitorFailureReason: null,
  chosenSource: 'amazon-mx',
  quotes: [
    q({ source: 'mercado-libre', title: 'Oster 1200', priceMxn: 800, matchConfidence: 'high', matchDecision: 'accept' }),
    q({ source: 'amazon-mx', title: 'Oster 1200 envio', priceMxn: 750, matchConfidence: 'high', matchDecision: 'accept' }),
  ],
}

const flagged: PricingSkuResult = {
  sku: 'BSKU',
  title: 'Cafetera Mistica 900',
  shopifyVariantId: 22,
  currentPriceMxn: 500,
  competitorMinMxn: null,
  suggestedPriceMxn: null,
  decision: 'manual_review',
  reason: 'no competitor',
  matchConfidence: null,
  matchDecision: 'reject',
  competitorFailureReason: 'no_catalog_match',
  chosenSource: null,
  quotes: [
    q({ source: 'mercado-libre', failureReason: 'no_catalog_match' }),
    q({ source: 'amazon-mx', failureReason: 'no_result' }),
  ],
}

const output: PricingDraftOutput = {
  consumerId: 'mi-pase',
  summary: {
    consumerId: 'mi-pase',
    totalSkus: 2,
    confidentCount: 1,
    flaggedCount: 1,
    competitorMissCount: 1,
    aggregates: computeAggregates([]),
    bySource: {
      'mercado-libre': { found: 1, accepted: 1 },
      'amazon-mx': { found: 1, accepted: 1 },
    },
  },
  confident: [confident],
  flagged: [flagged],
}

describe('buildPricingReportMarkdown', () => {
  it('renders summary, per-source coverage, and per-SKU detail', () => {
    const md = buildPricingReportMarkdown(output)
    expect(md).toContain('# Reporte de precios sugeridos')
    expect(md).toContain('Cliente: mi-pase')
    expect(md).toContain('SKUs analizados: 2')
    // coverage table lists both sources with their yield
    expect(md).toContain('| amazon-mx | 1 | 1 |')
    expect(md).toContain('| mercado-libre | 1 | 1 |')
    // confident SKU row shows the chosen source + suggested price + delta (-250)
    expect(md).toMatch(/\| ASKU \| Licuadora Oster 1200 \| \$1000\.00 \| amazon-mx \| \$750\.00 \| \$750\.00 \| \$-250\.00 \|/)
    // flagged SKU row leaves competitor/suggested blank
    expect(md).toContain('| BSKU | Cafetera Mistica 900 | $500.00 |  |  |  |  | manual_review | no competitor |')
  })
})

describe('buildPricingReportCsv', () => {
  it('emits fixed columns + two columns per source (sorted), one row per SKU', () => {
    const csv = buildPricingReportCsv(output)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3) // header + 2 SKUs

    const header = lines[0]!
    // sources sorted: amazon-mx before mercado-libre
    expect(header).toBe(
      '"sku","title","current_mxn","chosen_source","competitor_min_mxn","suggested_mxn","delta_mxn","decision","reason","match_confidence","match_decision","amazon-mx_price_mxn","amazon-mx_match","mercado-libre_price_mxn","mercado-libre_match"',
    )

    // ASKU: chosen amazon-mx 750, suggested 750, delta -250, both source prices present
    expect(lines[1]).toBe(
      '"ASKU","Licuadora Oster 1200","1000","amazon-mx","750","750","-250","lower_to_competitor","competitor below current, above floor","high","accept","750","high","800","high"',
    )
    // BSKU: blanks for competitor/suggested, blank source prices
    expect(lines[2]).toBe(
      '"BSKU","Cafetera Mistica 900","500","","","","","manual_review","no competitor","","reject","","","",""',
    )
  })

  it('neutralizes spreadsheet formula injection in free-text cells, but not negative numbers', () => {
    const evil: PricingSkuResult = {
      ...confident,
      sku: 'EVIL',
      title: '=HYPERLINK("http://evil","pwn")',
      reason: '@SUM(A1:A9)',
    }
    const out2: PricingDraftOutput = { ...output, confident: [evil], flagged: [] }
    const lines = buildPricingReportCsv(out2).split('\n')
    // formula-leading text cells are prefixed with a single quote
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"",""pwn"")"`)
    expect(lines[1]).toContain(`"'@SUM(A1:A9)"`)
    // ...but the negative delta (-250) is a real number and stays unescaped
    expect(lines[1]).toContain('"-250"')
    expect(lines[1]).not.toContain(`"'-250"`)
  })
})
