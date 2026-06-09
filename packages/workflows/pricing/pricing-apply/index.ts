import type { RunContext } from '@godin-engine/contract'
import type { ShopifyClient } from '@godin-engine/shopify'

import type { ApplySku, PricingApplyInput } from './manifest.js'
import {
  createDbApplyStateStore,
  type ApplyStateRow,
  type ApplyStateStore,
} from './apply-state-store.js'

/**
 * Type the per-tenant integration clients this workflow asks for (D2). Apply
 * only ever touches Shopify; the augmentation gives `ctx.integration('shopify')`
 * a precise `ShopifyClient` type WITHOUT the contract importing the package.
 * (Last-write-wins module augmentation; matches the pricing-draft seam.)
 */
declare module '@godin-engine/contract' {
  interface IntegrationClients {
    shopify: ShopifyClient
  }
}

/** Anti-thrash threshold (plan: skip a write when |new − lastApplied| < 1%). */
export const ANTI_THRASH_PCT = 0.01

/** Pause between paced Shopify writes (reuses the mi-pase sequential pacing). */
const SHOPIFY_PACE_MS = 250

/** Per-SKU terminal outcome of an apply run. */
export type ApplyOutcome = 'applied' | 'skipped' | 'failed'

/** One SKU's apply result (the rich, durable truth also lives in state). */
export interface ApplySkuResult {
  sku: string
  shopifyVariantId: number
  outcome: ApplyOutcome
  /** The price written (applied) or that would have been written (skipped). */
  price: number | null
  /** Why it was skipped or failed (null when applied). */
  reason: string | null
}

export interface PricingApplyOutput {
  applied: number
  skipped: number
  failed: number
  perSku: ApplySkuResult[]
}

/** Internal carrier for the optional injected store + pacing override (tests). */
type PricingApplyRunInput = PricingApplyInput & {
  /** Test seam: inject a fake apply store (the worker never sets this). */
  __applyStore?: ApplyStateStore
  /** Test seam: disable inter-write pacing so unit tests run instantly. */
  __noPace?: boolean
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Pick the price set this run should apply. The worker feeds the WHOLE parent
 * output as input, which carries both `confident` and `flagged`; the manifest id
 * selects the right subset. An explicit `skus` (or a direct array input) wins —
 * that is how a re-run or a test targets an exact set.
 */
export function selectSkus(input: PricingApplyInput, workflowId: string): ApplySku[] {
  if (input.skus && input.skus.length) return input.skus
  if (workflowId === 'pricing-apply-flagged' && input.flagged) return input.flagged
  if (workflowId === 'pricing-apply-confident' && input.confident) return input.confident
  // Fallbacks: whichever single subset is present, else the other; else empty.
  return input.confident ?? input.flagged ?? input.skus ?? []
}

/**
 * The baseline an anti-thrash comparison measures the new target against: the
 * last price we actually applied if the row is/was applied, else the price
 * observed before our first write. Null when we have no baseline (always write).
 */
function antiThrashBaseline(row: ApplyStateRow | undefined, fallback: number | null): number | null {
  if (!row) return fallback
  if (row.status === 'applied' && row.attemptedPrice != null) return row.attemptedPrice
  return row.priorShopify ?? fallback
}

/** True when |new − baseline| / baseline is under the 1% anti-thrash threshold. */
export function isWithinAntiThrash(newPrice: number, baseline: number | null): boolean {
  if (baseline == null || baseline === 0) return false // no baseline → always apply
  return Math.abs(newPrice - baseline) / Math.abs(baseline) < ANTI_THRASH_PCT
}

/**
 * Apply a price set to Shopify, per-SKU resumable + fail-soft (plan T8).
 *
 * For each SKU, in order:
 *   1. Resumability: if the row is already `applied`, SKIP (re-run retries only
 *      non-applied rows — idempotent).
 *   2. Hold: a null target is a hold → record `skipped`.
 *   3. Anti-thrash: |new − lastApplied| < 1% → `skipped` (no churn write).
 *   4. CHECKPOINT before: status=attempting (so a crash mid-write is visible to
 *      the reaper + a re-run knows we got this far).
 *   5. ctx.integration('shopify').updateVariantPrice() — the dev-store write.
 *   6. CHECKPOINT after: status=applied(ok) | failed(reason).
 *
 * A single-SKU failure is RECORDED and the batch CONTINUES — the run never
 * throws on one SKU; it resolves with a partial-outcome summary (plan T8). Only
 * a failure to even read the integration/store (no SKU could be attempted) is
 * fatal, matching the draft's "the work source must be readable" discipline.
 */
export async function run(
  rawInput: PricingApplyInput,
  ctx: RunContext,
  workflowId = 'pricing-apply-confident',
): Promise<PricingApplyOutput> {
  const input = rawInput as PricingApplyRunInput
  const consumerId = input.consumerId
  if (!consumerId) {
    throw new Error('pricing-apply: consumerId is required (resolved from the run record)')
  }

  const skus = selectSkus(input, workflowId)
  const perSku: ApplySkuResult[] = []
  let applied = 0
  let skipped = 0
  let failed = 0

  if (skus.length === 0) {
    ctx.logger.info(`pricing-apply (${workflowId}): empty price set — nothing to apply`)
    return { applied, skipped, failed, perSku }
  }

  // The write target + the durable ledger. A failure to obtain EITHER means no
  // SKU can be attempted — let that propagate (run fails), unlike per-SKU errors.
  const shopify = ctx.integration('shopify')
  const store = input.__applyStore ?? (await createDbApplyStateStore())
  const existing = await store.readRows(
    consumerId,
    skus.map((s) => s.sku),
  )

  for (let i = 0; i < skus.length; i++) {
    const item = skus[i]!
    const row = existing.get(item.sku)
    const target = item.suggestedPriceMxn

    // 1. Resumability — a re-run retries ONLY rows not already applied.
    if (row?.status === 'applied') {
      skipped++
      perSku.push({
        sku: item.sku,
        shopifyVariantId: item.shopifyVariantId,
        outcome: 'skipped',
        price: row.attemptedPrice ?? target,
        reason: 'already_applied',
      })
      continue
    }

    // 2. Hold — no target price means there is nothing to write.
    if (target == null) {
      skipped++
      await safeCheckpoint(store, ctx, {
        consumerId,
        sku: item.sku,
        status: 'skipped',
        attemptedPrice: null,
        failureReason: 'no_target_price',
        sourceRunId: ctx.runId,
      })
      perSku.push({
        sku: item.sku,
        shopifyVariantId: item.shopifyVariantId,
        outcome: 'skipped',
        price: null,
        reason: 'no_target_price',
      })
      continue
    }

    // 3. Anti-thrash — skip a write within 1% of what we last applied.
    const baseline = antiThrashBaseline(row, item.currentPriceMxn ?? null)
    if (isWithinAntiThrash(target, baseline)) {
      skipped++
      await safeCheckpoint(store, ctx, {
        consumerId,
        sku: item.sku,
        status: 'skipped',
        attemptedPrice: target,
        failureReason: 'within_anti_thrash_1pct',
        sourceRunId: ctx.runId,
      })
      perSku.push({
        sku: item.sku,
        shopifyVariantId: item.shopifyVariantId,
        outcome: 'skipped',
        price: target,
        reason: 'within_anti_thrash_1pct',
      })
      continue
    }

    // 4. CHECKPOINT before — status=attempting (crash-visible).
    await safeCheckpoint(store, ctx, {
      consumerId,
      sku: item.sku,
      status: 'attempting',
      attemptedPrice: target,
      failureReason: null,
      sourceRunId: ctx.runId,
    })

    // 5 + 6. Write, then CHECKPOINT after. A single-SKU failure NEVER throws.
    try {
      await shopify.updateVariantPrice({ variantId: item.shopifyVariantId, newPriceMxn: target })
      await safeCheckpoint(store, ctx, {
        consumerId,
        sku: item.sku,
        status: 'applied',
        attemptedPrice: target,
        failureReason: null,
        sourceRunId: ctx.runId,
      })
      applied++
      perSku.push({
        sku: item.sku,
        shopifyVariantId: item.shopifyVariantId,
        outcome: 'applied',
        price: target,
        reason: null,
      })
    } catch (e) {
      const reason = (e as Error).message ?? 'shopify_write_error'
      ctx.logger.error(`pricing-apply (${workflowId}): ${item.sku} write failed: ${reason}`)
      await safeCheckpoint(store, ctx, {
        consumerId,
        sku: item.sku,
        status: 'failed',
        attemptedPrice: target,
        failureReason: reason,
        sourceRunId: ctx.runId,
      })
      failed++
      perSku.push({
        sku: item.sku,
        shopifyVariantId: item.shopifyVariantId,
        outcome: 'failed',
        price: target,
        reason,
      })
    }

    if (!input.__noPace && i < skus.length - 1) await delay(SHOPIFY_PACE_MS)
  }

  ctx.logger.info(
    `pricing-apply (${workflowId}): ${applied} applied, ${skipped} skipped, ${failed} failed`,
  )
  return { applied, skipped, failed, perSku }
}

/**
 * Checkpoint that never lets a state-write error abort the batch. A checkpoint
 * failure is logged but treated fail-soft: the in-memory outcome is still
 * returned, and the reaper + a re-run reconcile from whatever did persist. (The
 * BEFORE checkpoint is best-effort; the durable safety net is the reaper.)
 */
async function safeCheckpoint(
  store: ApplyStateStore,
  ctx: RunContext,
  cp: Parameters<ApplyStateStore['checkpoint']>[0],
): Promise<void> {
  try {
    await store.checkpoint(cp)
  } catch (e) {
    ctx.logger.error(
      `pricing-apply: checkpoint(${cp.sku} → ${cp.status}) failed: ${(e as Error).message}`,
    )
  }
}

/** The flagged child shares run(); bind its id so subset selection is correct. */
export function runFlagged(input: PricingApplyInput, ctx: RunContext): Promise<PricingApplyOutput> {
  return run(input, ctx, 'pricing-apply-flagged')
}

/** The confident child shares run(); bind its id so subset selection is correct. */
export function runConfident(input: PricingApplyInput, ctx: RunContext): Promise<PricingApplyOutput> {
  return run(input, ctx, 'pricing-apply-confident')
}
