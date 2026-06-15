import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { EngineError } from '@godin-engine/contract'
import { db, schema } from '@godin-engine/db'
import { getBoss, QUEUE, type RunJob } from '@godin-engine/queue'
import { getWorkflow } from '@godin-engine/workflows'
import { demoPage, demoOpsPage } from './demo-page'

const CONSUMER = 'demo'

/**
 * Best-effort per-IP rate limit for the PUBLIC demo run endpoint. The demo is
 * ungated (no operator key), so without this any visitor could spam dispatches.
 * In-memory (engine-api runs as a single instance); a token-list per IP within a
 * sliding window. Not a security boundary — a cost/abuse guardrail. The chain is
 * forced no-LLM (scripted) so the marginal cost of a run is a Notion write, which
 * this caps.
 */
const RUN_LIMIT = 12
const RUN_WINDOW_MS = 10 * 60_000 // 10 minutes
const runHits = new Map<string, number[]>()

function clientIp(forwardedFor: string | undefined, realIp: string | undefined): string {
  const fwd = (forwardedFor ?? '').split(',')[0]?.trim()
  return fwd || realIp?.trim() || 'unknown'
}

/** Returns true if this IP is OVER the limit (and should be rejected). */
function rateLimited(ip: string, nowMs: number): boolean {
  const recent = (runHits.get(ip) ?? []).filter((t) => nowMs - t < RUN_WINDOW_MS)
  if (recent.length >= RUN_LIMIT) {
    runHits.set(ip, recent)
    return true
  }
  recent.push(nowMs)
  runHits.set(ip, recent)
  // Opportunistic prune so the map can't grow unbounded across many one-off IPs.
  if (runHits.size > 5000) {
    for (const [k, v] of runHits) {
      if (v.every((t) => nowMs - t >= RUN_WINDOW_MS)) runHits.delete(k)
    }
  }
  return false
}

async function enqueue(runId: string): Promise<void> {
  const boss = await getBoss()
  await boss.send(QUEUE, { runId } satisfies RunJob)
}

async function dispatchRun(workflowId: string, input: unknown, parentRunId?: string): Promise<string> {
  const runId = randomUUID()
  await db.insert(schema.engineRuns).values({
    runId,
    workflowId,
    consumerId: CONSUMER,
    input,
    traceId: randomUUID(),
    parentRunId: parentRunId ?? null,
    status: 'queued',
  })
  await enqueue(runId)
  return runId
}

/** Walk the chain from the root run via parent_run_id, plus its approval gates. */
async function assembleState(rootRunId: string) {
  const runsByWf: Record<string, typeof schema.engineRuns.$inferSelect> = {}
  let current = await db.query.engineRuns.findFirst({ where: eq(schema.engineRuns.runId, rootRunId) })
  // PUBLIC endpoint: only ever expose DEMO runs. A non-demo (real tenant) root, or
  // an unknown id, is indistinguishable here → null (404). Prevents reading another
  // tenant's run chain by id.
  if (!current || current.consumerId !== CONSUMER) return null
  const chainIds: string[] = []
  while (current) {
    runsByWf[current.workflowId] = current
    chainIds.push(current.runId)
    current = await db.query.engineRuns.findFirst({
      where: eq(schema.engineRuns.parentRunId, current.runId),
    })
  }
  const approvals = chainIds.length
    ? await db.select().from(schema.engineApprovals).where(inArray(schema.engineApprovals.sourceRunId, chainIds))
    : []
  return { rootRunId, runsByWf, approvals }
}

/**
 * Resolve an approval and assert it belongs to the DEMO consumer. The /demo API is
 * PUBLIC, so an approve/reject MUST never act on a real tenant's approval by id. A
 * non-demo or missing approval is reported identically (SKILL_NOT_FOUND) so a caller
 * cannot tell a real approval id from a non-existent one.
 */
async function demoApprovalOr404(approvalId: string) {
  const approval = await db.query.engineApprovals.findFirst({
    where: eq(schema.engineApprovals.approvalId, approvalId),
  })
  if (!approval) throw new EngineError('SKILL_NOT_FOUND', 'approval not found')
  const source = await db.query.engineRuns.findFirst({
    where: eq(schema.engineRuns.runId, approval.sourceRunId),
  })
  if (!source || source.consumerId !== CONSUMER) {
    throw new EngineError('SKILL_NOT_FOUND', 'approval not found')
  }
  return approval
}

/** Approve a gate: validate artifact, insert chained child run, flip gate, enqueue. */
async function approveGate(approvalId: string, decidedBy: string): Promise<string> {
  const approval = await demoApprovalOr404(approvalId)
  if (approval.state !== 'pending') throw new EngineError('APPROVAL_DENIED', `already ${approval.state}`)

  const target = getWorkflow(approval.workflowId)
  if (!target) throw new EngineError('SKILL_NOT_FOUND', `onApprove target '${approval.workflowId}' missing`)
  const parsed = target.manifest.input.safeParse(approval.artifact)
  if (!parsed.success) throw new EngineError('ARGS_INVALID', `artifact does not match '${approval.workflowId}'`)

  const childRunId = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`select state from engine_approvals where approval_id = ${approvalId} for update`,
    )
    const state = (locked as unknown as Array<{ state: string }>)[0]?.state
    if (state !== 'pending') throw new EngineError('APPROVAL_DENIED', `already ${state}`)
    const child = randomUUID()
    await tx.insert(schema.engineRuns).values({
      runId: child,
      workflowId: approval.workflowId,
      consumerId: CONSUMER,
      input: parsed.data,
      traceId: randomUUID(),
      parentRunId: approval.sourceRunId,
      status: 'queued',
    })
    await tx
      .update(schema.engineApprovals)
      .set({ state: 'approved', decidedBy, decidedAt: new Date(), dispatchedRunId: child })
      .where(eq(schema.engineApprovals.approvalId, approvalId))
    return child
  })
  await enqueue(childRunId)
  return childRunId
}

export function mountDemo(app: Hono): void {
  app.get('/demo', (c) => c.html(demoPage()))

  app.get('/demo/ops', async (c) => {
    // PUBLIC, but DEMO-SCOPED: only ever show consumerId 'demo' rows so the
    // "under the hood" view never exposes a real tenant's runs/approvals.
    const runs = await db
      .select()
      .from(schema.engineRuns)
      .where(eq(schema.engineRuns.consumerId, CONSUMER))
      .orderBy(desc(schema.engineRuns.createdAt))
      .limit(30)
    const demoRunIds = runs.map((r) => r.runId)
    const approvals = demoRunIds.length
      ? await db
          .select()
          .from(schema.engineApprovals)
          .where(inArray(schema.engineApprovals.sourceRunId, demoRunIds))
          .orderBy(desc(schema.engineApprovals.createdAt))
          .limit(30)
      : []
    return c.html(demoOpsPage(runs, approvals))
  })

  app.post('/demo/api/run', async (c) => {
    // Cost/abuse guard for the PUBLIC endpoint: per-IP sliding-window rate limit.
    const ip = clientIp(c.req.header('x-forwarded-for'), c.req.header('x-real-ip'))
    if (rateLimited(ip, Date.now())) {
      return c.json({ error: 'Too many demo runs from your network — give it a few minutes.' }, 429)
    }
    const body = (await c.req.json().catch(() => ({}))) as { transcript?: string; source?: string }
    if (!body.transcript || body.transcript.trim().length < 20) {
      return c.json({ error: 'transcript required (paste a call transcript)' }, 400)
    }
    // PUBLIC demo: force the no-LLM scripted path so a visitor can never drive an LLM
    // request (cost/prompt-injection). `scripted: true` threads call-intake → gate-1
    // → proposal-step; the real (LLM) Vino tenant pipeline never sets it.
    const transcript = body.transcript.slice(0, 8000) // cap stored payload size
    const rootRunId = await dispatchRun('call-intake', {
      transcript,
      source: body.source ?? 'Granola call',
      scripted: true,
    })
    return c.json({ rootRunId })
  })

  app.get('/demo/api/state/:rootRunId', async (c) => {
    const state = await assembleState(c.req.param('rootRunId'))
    if (!state) return c.json({ error: 'not found' }, 404)
    return c.json(state)
  })

  app.post('/demo/api/approvals/:id/approve', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { decided_by?: string }
    try {
      const runId = await approveGate(c.req.param('id'), body.decided_by ?? 'demo-owner')
      return c.json({ ok: true, runId })
    } catch (e) {
      if (e instanceof EngineError) return c.json({ error: e.toEnvelope() }, 409)
      throw e
    }
  })

  app.post('/demo/api/approvals/:id/reject', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { decided_by?: string }
    try {
      // Scope to the demo consumer FIRST so a public caller can't reject a real
      // tenant's pending approval by id.
      await demoApprovalOr404(c.req.param('id'))
    } catch (e) {
      if (e instanceof EngineError) return c.json({ error: e.toEnvelope() }, 409)
      throw e
    }
    const updated = await db
      .update(schema.engineApprovals)
      .set({ state: 'rejected', decidedBy: body.decided_by ?? 'demo-owner', decidedAt: new Date() })
      .where(eq(schema.engineApprovals.approvalId, c.req.param('id')))
      .returning({ approvalId: schema.engineApprovals.approvalId })
    if (!updated.length) return c.json({ error: 'not found or already decided' }, 409)
    return c.json({ ok: true })
  })
}
