import { describe, expect, it } from 'vitest'
import draftManifest, { PRICING_DRAFT_TIMEOUT_MS } from './pricing-draft/manifest'
import {
  pricingApplyConfidentManifest,
  pricingApplyFlaggedManifest,
  PRICING_APPLY_TIMEOUT_MS,
} from './pricing-apply/manifest'

/**
 * T11 — generous timeouts on the pricing manifests + reused ml-batch pacing.
 *
 * The draft (~316 SKUs × a paced per-SKU ML lookup) carries the larger budget;
 * apply does NO ML lookup, only the same paced Shopify writes, so it is tighter
 * but still generous. Both must comfortably exceed the worst-case paced batch and
 * never undercut the reaper's default deadline (so a healthy run is never reaped).
 */
describe('pricing manifest timeouts (T11)', () => {
  const ML_PACE_MS = 250 // the reused mi-pase ml-batch sequential pacing
  const WORST_CASE_SKUS = 316
  const PACED_BATCH_MS = WORST_CASE_SKUS * ML_PACE_MS // ≈ 79s of pure pacing

  it('draft has a generous ~20min budget', () => {
    expect(PRICING_DRAFT_TIMEOUT_MS).toBe(20 * 60_000)
    expect(draftManifest.timeoutMs).toBe(PRICING_DRAFT_TIMEOUT_MS)
  })

  it('apply has a generous ~15min budget — tighter than the draft (no ML lookup)', () => {
    expect(PRICING_APPLY_TIMEOUT_MS).toBe(15 * 60_000)
    expect(pricingApplyConfidentManifest.timeoutMs).toBe(PRICING_APPLY_TIMEOUT_MS)
    expect(pricingApplyFlaggedManifest.timeoutMs).toBe(PRICING_APPLY_TIMEOUT_MS)
    // Apply is lighter than the draft (it does no per-SKU ML search).
    expect(PRICING_APPLY_TIMEOUT_MS).toBeLessThan(PRICING_DRAFT_TIMEOUT_MS)
  })

  it('every pricing timeout dwarfs the worst-case paced batch (wide headroom)', () => {
    for (const t of [PRICING_DRAFT_TIMEOUT_MS, PRICING_APPLY_TIMEOUT_MS]) {
      // At least ~10x the pure-pacing floor so per-call latency + backoff fit.
      expect(t).toBeGreaterThan(PACED_BATCH_MS * 10)
    }
  })
})
