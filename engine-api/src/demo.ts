import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { EngineError } from '@godin-engine/contract'
import { db, schema } from '@godin-engine/db'
import { getBoss, QUEUE, type RunJob } from '@godin-engine/queue'
import { getWorkflow } from '@godin-engine/workflows'
import { demoPage, demoOpsPage } from './demo-page'

const CONSUMER = 'demo'

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
  if (!current) return null
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

/** Approve a gate: validate artifact, insert chained child run, flip gate, enqueue. */
async function approveGate(approvalId: string, decidedBy: string): Promise<string> {
  const approval = await db.query.engineApprovals.findFirst({
    where: eq(schema.engineApprovals.approvalId, approvalId),
  })
  if (!approval) throw new EngineError('SKILL_NOT_FOUND', 'approval not found')
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
    const runs = await db.select().from(schema.engineRuns).orderBy(desc(schema.engineRuns.createdAt)).limit(30)
    const approvals = await db.select().from(schema.engineApprovals).orderBy(desc(schema.engineApprovals.createdAt)).limit(30)
    return c.html(demoOpsPage(runs, approvals))
  })

  app.post('/demo/api/run', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { transcript?: string; source?: string }
    if (!body.transcript || body.transcript.trim().length < 20) {
      return c.json({ error: 'transcript required (paste a call transcript)' }, 400)
    }
    const rootRunId = await dispatchRun('call-intake', {
      transcript: body.transcript,
      source: body.source ?? 'Granola call',
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
    const updated = await db
      .update(schema.engineApprovals)
      .set({ state: 'rejected', decidedBy: body.decided_by ?? 'demo-owner', decidedAt: new Date() })
      .where(eq(schema.engineApprovals.approvalId, c.req.param('id')))
      .returning({ approvalId: schema.engineApprovals.approvalId })
    if (!updated.length) return c.json({ error: 'not found or already decided' }, 409)
    return c.json({ ok: true })
  })
}
