/**
 * T10 — full chained pricing flow, integration test.
 *
 * Drives the REAL engine seams end-to-end against a REAL Postgres (the
 * `godin-engine-pg` dev container on :5434, the same DATABASE_URL the services
 * use), mocking ONLY at the package boundary the plan calls out: the `shopify`
 * and `mercadolibre` provider factories registered with the worker's integration
 * resolver (D2/D3). Everything between — `pricing-draft.run`, the post-success
 * fan-out (`dispatchOnSuccess` with live DB effects), the approval-gate row, the
 * approve→dispatch transaction (engine-api's logic, replayed faithfully), and
 * both `pricing-apply` children — runs for real.
 *
 * What it proves (plan T10 verify line):
 *   1. trigger pricing-draft → the real run classifies into confident[] | flagged[]
 *      and upserts desired rows into engine_workflow_state.
 *   2. on success the worker auto-dispatches the CONFIDENT child via onComplete —
 *      a child engine_runs row, NO engine_approvals row for it (ungated).
 *   3. the FLAGGED child opens an approval gate (engine_approvals, state=pending);
 *      it is NOT applied until approved.
 *   4. executing the confident child applies its prices WITHOUT a gate — and a
 *      partial-failure SKU (Shopify 422) is RECORDED (engine_workflow_state=failed)
 *      while the run still SUCCEEDS (partial outcome), and a RE-RUN retries ONLY
 *      the failed SKU (resumable, idempotent — D7).
 *   5. approving the gate dispatches + runs the flagged child; after approval the
 *      flagged subset is applied (its per-SKU outcomes recorded).
 *
 * If the dev Postgres is not reachable the whole suite SKIPS with a clear note
 * (the task: prefer real PG when the container is up, else skip).
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { RunContext } from '@godin-engine/contract'
import type { Catalog, ShopifyClient, UpdatedVariant, VariantPriceUpdate } from '@godin-engine/shopify'
import type { MercadoLibreClient, MLSearchResult } from '@godin-engine/mercadolibre'

import { dispatchOnSuccess, type DispatchEffects } from './dispatch'
import { makeIntegrationResolver, registerProvider, unregisterProvider } from './integration-resolver'

// The dev container the services share (see docker-compose.yml / .env.example).
const DEFAULT_DEV_DB = 'postgresql://postgres:postgres@localhost:5434/godin_engine'
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = DEFAULT_DEV_DB

const CONSUMER = `mi-pase-itest-${randomUUID().slice(0, 8)}`

// ── Mocked integration clients (THE package boundary, D3) ────────────────────

/** A barcode the confident SKUs share with their ML competitor title → high match. */
const BARCODE_A = '7501234567890'
const BARCODE_B = '7509876543210'

/**
 * Catalog the stub Shopify serves. Two CONFIDENT candidates (barcode-matched ML
 * competitor, cost supplied → actionable `lower_to_competitor`) and one FLAGGED
 * candidate (ML returns no MXN price → competitor miss → manual_review/hold).
 */
function devCatalog(): Catalog {
  const products = [
    {
      id: 1,
      title: 'Filtro de Agua AquaPure AP100',
      vendor: 'AquaPure',
      product_type: 'Filtro',
      variants: [{ id: 1001, sku: 'SKU-A', title: null, price: '1000.00', barcode: BARCODE_A }],
    },
    {
      id: 2,
      title: 'Bomba Sumergible HydroMax HM200',
      vendor: 'HydroMax',
      product_type: 'Bomba',
      variants: [{ id: 1002, sku: 'SKU-B', title: null, price: '2000.00', barcode: BARCODE_B }],
    },
    {
      id: 3,
      title: 'Accesorio Genérico Sin Competidor',
      vendor: 'GenBrand',
      product_type: 'Accesorio',
      variants: [{ id: 1003, sku: 'SKU-F', title: null, price: '500.00', barcode: null }],
    },
  ]
  const variantCount = products.reduce((n, p) => n + p.variants.length, 0)
  return { products, variantCount }
}

/** ML result that carries the SKU's barcode in its title → identifier exact match. */
function mlHit(query: string, barcode: string, priceMxn: number): MLSearchResult {
  return {
    query,
    title: `Producto compatible ${barcode} oferta`,
    price_mxn: priceMxn,
    permalink: 'https://articulo.mercadolibre.com.mx/MLM-1',
    catalog_product_id: 'MLM1',
    item_id: 'MLM-1',
    category_id: 'MLM1000',
    match_strategy: 'catalog_search_lowest_mxn_item',
    candidates_checked: 1,
    failure_reason: null,
    raw_response_summary: { results_count: 1, first_id: 'MLM-1' },
  }
}

/** ML competitor miss — no MXN price (the SKU gets flagged, fail-soft D3). */
function mlMiss(query: string): MLSearchResult {
  return {
    query,
    title: null,
    price_mxn: null,
    permalink: null,
    catalog_product_id: null,
    item_id: null,
    category_id: null,
    match_strategy: 'catalog_search_lowest_mxn_item',
    candidates_checked: 0,
    failure_reason: 'no_catalog_match',
    raw_response_summary: { results_count: 0, first_id: null },
  }
}

/** A stub ML client whose .search() returns a barcode hit for A/B, a miss for F. */
function fakeMl(): MercadoLibreClient {
  return {
    configured: true,
    async search(query) {
      // The draft builds the query from brand/model/title; key off those tokens.
      if (/aquapure|ap100|filtro de agua/i.test(query)) return mlHit(query, BARCODE_A, 800)
      if (/hydromax|hm200|bomba sumergible/i.test(query)) return mlHit(query, BARCODE_B, 1600)
      return mlMiss(query)
    },
  }
}

/**
 * A stub Shopify whose updateVariantPrice 422s for ONE variant (the partial
 * failure) and succeeds for the rest. `failVariantId=null` => everything OK
 * (used for the re-run, which must then succeed the previously-failed SKU).
 */
function fakeShopify(opts: {
  catalog: Catalog
  failVariantId: number | null
  writes: VariantPriceUpdate[]
}): ShopifyClient {
  return {
    async getCatalog() {
      return opts.catalog
    },
    async updateVariantPrice(update): Promise<UpdatedVariant> {
      opts.writes.push(update)
      if (opts.failVariantId != null && update.variantId === opts.failVariantId) {
        throw new Error('Shopify API error 422: bad price for variant')
      }
      return { id: update.variantId, price: update.newPriceMxn.toFixed(2), updatedAt: new Date().toISOString() }
    },
  }
}

// Holders the registered factories close over, swapped per phase.
let mlClient: MercadoLibreClient
let shopifyClient: ShopifyClient

// ── Live DB harness (mirrors worker handle() + engine-api approve, sans pg-boss)

let db: typeof import('@godin-engine/db')['db']
let schema: typeof import('@godin-engine/db')['schema']
let sql: typeof import('@godin-engine/db')['sql']
let registry: typeof import('@godin-engine/workflows')
let drizzle: typeof import('drizzle-orm')
let pgUp = false

/** Ping the dev PG; gate the suite on it being reachable. */
async function probePg(): Promise<boolean> {
  try {
    const mod = await import('@godin-engine/db')
    await mod.sql`select 1`
    db = mod.db
    schema = mod.schema
    sql = mod.sql
    drizzle = await import('drizzle-orm')
    registry = await import('@godin-engine/workflows')
    return true
  } catch (e) {
    console.warn(`[pricing-chain.integration] skipping — dev Postgres not reachable: ${(e as Error).message}`)
    return false
  }
}

const noopLogger: RunContext['logger'] = { info: vi.fn(), error: vi.fn() }

/** ctx the way the worker builds it (T2): identity + the real lazy resolver. */
function ctxFor(runId: string, traceId: string): RunContext {
  return {
    runId,
    traceId,
    logger: noopLogger,
    artifactDir: `/tmp/godin-engine-itest/${runId}`,
    integration: makeIntegrationResolver(CONSUMER),
  }
}

/** Insert a queued run row exactly like the control plane does. */
async function insertRun(workflowId: string, input: unknown, parentRunId?: string): Promise<string> {
  const runId = randomUUID()
  await db.insert(schema.engineRuns).values({
    runId,
    workflowId,
    consumerId: CONSUMER,
    input: input as object,
    traceId: randomUUID(),
    parentRunId: parentRunId ?? null,
    status: 'queued',
  })
  return runId
}

/**
 * Execute one run the way the worker's handle() does: running → run() → succeeded
 * (with output) → post-success fan-out. Returns the output for chaining. The
 * dispatch effects insert child runs / approval rows WITHOUT pg-boss (the test
 * drives children explicitly instead of polling a queue).
 */
async function executeRun(runId: string): Promise<unknown> {
  const { eq } = drizzle
  const run = await db.query.engineRuns.findFirst({ where: eq(schema.engineRuns.runId, runId) })
  if (!run) throw new Error(`run ${runId} not found`)
  const wf = registry.getWorkflow(run.workflowId)
  if (!wf) throw new Error(`workflow ${run.workflowId} not registered`)

  await db.update(schema.engineRuns).set({ status: 'running', startedAt: new Date() }).where(eq(schema.engineRuns.runId, runId))

  const ctx = ctxFor(runId, run.traceId)
  const output = await wf.run(run.input, ctx)
  await db
    .update(schema.engineRuns)
    .set({ status: 'succeeded', output: output as object, finishedAt: new Date() })
    .where(eq(schema.engineRuns.runId, runId))

  await dispatchOnSuccess({ runId, consumerId: run.consumerId }, wf.manifest, output, testEffects(), noopLogger)
  return output
}

/** Live dispatch effects without pg-boss: insert child run + approval rows only. */
function testEffects(): DispatchEffects {
  return {
    dispatchChildRun: async ({ workflowId, consumerId, input, parentRunId }) => {
      const childRunId = randomUUID()
      await db.insert(schema.engineRuns).values({
        runId: childRunId,
        workflowId,
        consumerId,
        input: input as object,
        traceId: randomUUID(),
        parentRunId,
        status: 'queued',
      })
      return childRunId
    },
    openApprovalGate: async ({ sourceRunId, workflowId, artifact, approver }) => {
      await db.insert(schema.engineApprovals).values({
        approvalId: randomUUID(),
        sourceRunId,
        workflowId,
        artifact: artifact as object,
        approver,
        state: 'pending',
      })
    },
  }
}

/** Replay engine-api's approve transaction: flip the gate + dispatch the child. */
async function approveGate(approvalId: string, decidedBy: string): Promise<string> {
  const { eq } = drizzle
  const approval = await db.query.engineApprovals.findFirst({
    where: eq(schema.engineApprovals.approvalId, approvalId),
  })
  if (!approval) throw new Error('approval not found')
  const target = registry.getWorkflow(approval.workflowId)!
  const parsed = target.manifest.input.safeParse(approval.artifact)
  if (!parsed.success) throw new Error('artifact does not match target input')

  const childRunId = randomUUID()
  await db.insert(schema.engineRuns).values({
    runId: childRunId,
    workflowId: approval.workflowId,
    consumerId: CONSUMER,
    input: parsed.data as object,
    traceId: randomUUID(),
    parentRunId: approval.sourceRunId,
    status: 'queued',
  })
  await db
    .update(schema.engineApprovals)
    .set({ state: 'approved', decidedBy, decidedAt: new Date(), dispatchedRunId: childRunId })
    .where(eq(schema.engineApprovals.approvalId, approvalId))
  return childRunId
}

// ── Suite ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  pgUp = await probePg()
  if (!pgUp) return
  // Register the mocked providers at the resolver boundary; the closures read the
  // per-phase holders so the same registration serves draft + every apply phase.
  registerProvider('shopify', () => shopifyClient)
  registerProvider('mercadolibre', () => mlClient)
})

afterAll(async () => {
  if (!pgUp) return
  const { eq } = drizzle
  // Clean only THIS test's rows (keyed by the unique consumer).
  await db.delete(schema.engineWorkflowState).where(eq(schema.engineWorkflowState.consumerId, CONSUMER))
  await db.delete(schema.engineRuns).where(eq(schema.engineRuns.consumerId, CONSUMER))
  // approvals are not consumer-scoped; delete by the runs we created is covered above.
  unregisterProvider('shopify')
  unregisterProvider('mercadolibre')
  await sql.end({ timeout: 5 })
})

describe.skipIf(!process.env.DATABASE_URL)('pricing chain — full flow over real PG (T10)', () => {
  it('drives draft → confident auto-apply (no gate) + flagged gate → approve → flagged apply, with partial-failure + resume', async () => {
    if (!pgUp) {
      console.warn('[pricing-chain.integration] DATABASE_URL set but PG unreachable — skipping body')
      return
    }
    const { eq, and } = drizzle

    // Phase 0: provider behaviour for the DRAFT (ML hits/misses; Shopify read only).
    const draftWrites: VariantPriceUpdate[] = []
    shopifyClient = fakeShopify({ catalog: devCatalog(), failVariantId: null, writes: draftWrites })
    mlClient = fakeMl()

    // 1. TRIGGER pricing-draft (operator boundary) and EXECUTE it (worker).
    const draftRunId = await insertRun('pricing-draft', {
      consumerId: CONSUMER,
      // costBySku makes the barcode-matched SKUs actionable (lower_to_competitor).
      costBySku: { 'SKU-A': 500, 'SKU-B': 1000, 'SKU-F': 200 },
    })
    const draftOutput = (await executeRun(draftRunId)) as {
      summary: { confidentCount: number; flaggedCount: number; competitorMissCount: number }
      confident: Array<{ sku: string; suggestedPriceMxn: number | null; shopifyVariantId: number }>
      flagged: Array<{ sku: string }>
    }

    // The real run classified: A,B confident (barcode match + actionable), F flagged (no competitor).
    expect(draftOutput.summary.confidentCount).toBe(2)
    expect(draftOutput.confident.map((s) => s.sku).sort()).toEqual(['SKU-A', 'SKU-B'])
    expect(draftOutput.summary.flaggedCount).toBe(1)
    expect(draftOutput.flagged.map((s) => s.sku)).toEqual(['SKU-F'])
    expect(draftOutput.summary.competitorMissCount).toBe(1)
    // The draft is a READ — it never writes prices to Shopify.
    expect(draftWrites).toHaveLength(0)

    // The ONE durable side effect: desired rows upserted (status=pending) for all SKUs.
    const desiredRows = await db
      .select()
      .from(schema.engineWorkflowState)
      .where(eq(schema.engineWorkflowState.consumerId, CONSUMER))
    expect(desiredRows.map((r) => r.sku).sort()).toEqual(['SKU-A', 'SKU-B', 'SKU-F'])
    for (const r of desiredRows) expect(r.status).toBe('pending')

    // 2. onComplete auto-dispatched the CONFIDENT child — a queued child run, NO gate for it.
    const childRuns = await db
      .select()
      .from(schema.engineRuns)
      .where(and(eq(schema.engineRuns.consumerId, CONSUMER), eq(schema.engineRuns.parentRunId, draftRunId)))
    const confidentChild = childRuns.find((r) => r.workflowId === 'pricing-apply-confident')
    expect(confidentChild, 'confident child auto-dispatched via onComplete').toBeDefined()
    expect(confidentChild!.status).toBe('queued')

    // 3. The FLAGGED child is gated: an approval row exists (pending), and NO flagged
    //    child run has been dispatched yet (it waits for approval).
    const approvals = await db
      .select()
      .from(schema.engineApprovals)
      .where(eq(schema.engineApprovals.sourceRunId, draftRunId))
    expect(approvals).toHaveLength(1)
    const gate = approvals[0]!
    expect(gate.workflowId).toBe('pricing-apply-flagged')
    expect(gate.state).toBe('pending')
    expect(gate.approver).toBe('role:owner')
    // No flagged child run yet (only the confident onComplete child was dispatched).
    expect(childRuns.some((r) => r.workflowId === 'pricing-apply-flagged')).toBe(false)

    // 4. EXECUTE the confident child — applies WITHOUT a gate. One SKU (SKU-B / variant
    //    1002) 422s: it is RECORDED as failed while the run still SUCCEEDS (partial).
    const confidentWrites: VariantPriceUpdate[] = []
    shopifyClient = fakeShopify({ catalog: devCatalog(), failVariantId: 1002, writes: confidentWrites })
    const confidentOut = (await executeRun(confidentChild!.runId)) as {
      applied: number
      failed: number
      skipped: number
      perSku: Array<{ sku: string; outcome: string; reason: string | null }>
    }
    // Partial failure is first-class: 1 applied, 1 failed, run succeeded.
    expect(confidentOut.applied).toBe(1)
    expect(confidentOut.failed).toBe(1)
    expect(confidentOut.perSku.find((r) => r.sku === 'SKU-A')!.outcome).toBe('applied')
    const failedSku = confidentOut.perSku.find((r) => r.sku === 'SKU-B')!
    expect(failedSku.outcome).toBe('failed')
    expect(failedSku.reason).toMatch(/422/)
    const confidentRun = await db.query.engineRuns.findFirst({ where: eq(schema.engineRuns.runId, confidentChild!.runId) })
    expect(confidentRun!.status).toBe('succeeded')

    // The partial-failure SKU is recorded in engine_workflow_state (durable, resumable).
    const rowA = await db.query.engineWorkflowState.findFirst({
      where: and(
        eq(schema.engineWorkflowState.consumerId, CONSUMER),
        eq(schema.engineWorkflowState.sku, 'SKU-A'),
      ),
    })
    const rowB = await db.query.engineWorkflowState.findFirst({
      where: and(
        eq(schema.engineWorkflowState.consumerId, CONSUMER),
        eq(schema.engineWorkflowState.sku, 'SKU-B'),
      ),
    })
    expect(rowA!.status).toBe('applied')
    expect(rowB!.status).toBe('failed')
    expect(rowB!.failureReason).toMatch(/422/)
    // Both confident SKUs were attempted exactly once on the first apply.
    expect(confidentWrites.map((w) => w.variantId).sort()).toEqual([1001, 1002])

    // 4b. RE-RUN the confident apply — Shopify now healthy. It must retry ONLY the
    //     previously-failed SKU-B (SKU-A is already applied → skipped). Idempotent.
    const rerunWrites: VariantPriceUpdate[] = []
    shopifyClient = fakeShopify({ catalog: devCatalog(), failVariantId: null, writes: rerunWrites })
    const rerunRunId = await insertRun(
      'pricing-apply-confident',
      { consumerId: CONSUMER, confident: draftOutput.confident },
      confidentChild!.runId,
    )
    const rerunOut = (await executeRun(rerunRunId)) as {
      applied: number
      skipped: number
      perSku: Array<{ sku: string; outcome: string; reason: string | null }>
    }
    expect(rerunOut.applied).toBe(1) // only SKU-B retried
    expect(rerunOut.skipped).toBe(1) // SKU-A already applied
    expect(rerunOut.perSku.find((r) => r.sku === 'SKU-A')!.reason).toBe('already_applied')
    expect(rerunOut.perSku.find((r) => r.sku === 'SKU-B')!.outcome).toBe('applied')
    // The re-run touched ONLY the failed variant — not the already-applied one.
    expect(rerunWrites.map((w) => w.variantId)).toEqual([1002])
    const rowBAfter = await db.query.engineWorkflowState.findFirst({
      where: and(
        eq(schema.engineWorkflowState.consumerId, CONSUMER),
        eq(schema.engineWorkflowState.sku, 'SKU-B'),
      ),
    })
    expect(rowBAfter!.status).toBe('applied')

    // 5. APPROVE the flagged gate → dispatch + execute the flagged child. After
    //    approval the flagged subset is applied (its per-SKU outcomes recorded).
    const flaggedWrites: VariantPriceUpdate[] = []
    shopifyClient = fakeShopify({ catalog: devCatalog(), failVariantId: null, writes: flaggedWrites })
    const flaggedChildId = await approveGate(gate.approvalId, 'dalia')

    const gateAfter = await db.query.engineApprovals.findFirst({
      where: eq(schema.engineApprovals.approvalId, gate.approvalId),
    })
    expect(gateAfter!.state).toBe('approved')
    expect(gateAfter!.dispatchedRunId).toBe(flaggedChildId)

    const flaggedOut = (await executeRun(flaggedChildId)) as {
      applied: number
      skipped: number
      failed: number
      perSku: Array<{ sku: string; outcome: string }>
    }
    const flaggedRun = await db.query.engineRuns.findFirst({ where: eq(schema.engineRuns.runId, flaggedChildId) })
    expect(flaggedRun!.status).toBe('succeeded')
    // The flagged subset (SKU-F) was processed by the apply step post-approval.
    expect(flaggedOut.perSku.map((r) => r.sku)).toEqual(['SKU-F'])
    // SKU-F is a hold (no trusted competitor) → no real price churn, but the gated
    // apply DID run over exactly the flagged subset and recorded its outcome.
    expect(flaggedOut.applied + flaggedOut.skipped + flaggedOut.failed).toBe(1)
    const rowF = await db.query.engineWorkflowState.findFirst({
      where: and(
        eq(schema.engineWorkflowState.consumerId, CONSUMER),
        eq(schema.engineWorkflowState.sku, 'SKU-F'),
      ),
    })
    expect(rowF).toBeDefined()
  })
})
