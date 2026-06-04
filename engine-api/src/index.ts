import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { and, desc, eq, sql } from 'drizzle-orm'
import { EngineError } from '@godin-engine/contract'
import { db, schema } from '@godin-engine/db'
import { getBoss, QUEUE, type RunJob } from '@godin-engine/queue'
import { approvalTargets, getWorkflow } from '@godin-engine/workflows'
import { serviceKeyAuth } from './auth'
import { mountDemo } from './demo'

const gatedTargets = approvalTargets()

async function enqueue(runId: string): Promise<void> {
  const boss = await getBoss()
  await boss.send(QUEUE, { runId } satisfies RunJob)
}

function fail(c: Context, err: EngineError) {
  return c.json({ error: err.toEnvelope() }, err.httpStatus as ContentfulStatusCode)
}

const app = new Hono()

app.get('/', (c) => c.json({ service: 'godin-engine engine-api', version: '0.1.0', ok: true }))

// Demo console (no X-Service-Key; its own surface). Mounted before /v1 auth.
mountDemo(app)

app.use('/v1/*', serviceKeyAuth())

/**
 * POST /v1/workflows/:id/runs — the consumer boundary (D-4).
 * Enforces policy pre-dispatch in one transaction (D-5):
 *   - quota-policy workflows: FOR UPDATE the ledger row, 429 if over the daily limit
 *   - approval targets (onApprove of some gate): refused, only reachable via /approve
 */
app.post('/v1/workflows/:id/runs', async (c) => {
  const id = c.req.param('id')
  const wf = getWorkflow(id)
  if (!wf) return fail(c, new EngineError('SKILL_NOT_FOUND', `workflow '${id}' not found`))
  if (gatedTargets.has(id)) {
    return fail(c, new EngineError('APPROVAL_REQUIRED', `'${id}' is only reachable via an approved gate`))
  }

  const body = (await c.req.json().catch(() => null)) as { consumer_id?: string; input?: unknown } | null
  const consumerId = body?.consumer_id
  if (!consumerId) return fail(c, new EngineError('ARGS_INVALID', 'consumer_id is required'))

  const parsed = wf.manifest.input.safeParse(body?.input)
  if (!parsed.success) return fail(c, new EngineError('ARGS_INVALID', parsed.error.message))

  const quota = wf.manifest.policy.find((p) => p.kind === 'quota')

  let result: { runId: string; traceId: string }
  try {
    result = await db.transaction(async (tx) => {
      if (quota && quota.kind === 'quota') {
        const day = new Date().toISOString().slice(0, 10) // UTC day
        const ledgerId = `${consumerId}:${id}:${day}`
        await tx.execute(sql`
          insert into engine_quota_ledger (id, consumer_id, workflow_id, day, count)
          values (${ledgerId}, ${consumerId}, ${id}, ${day}, 0)
          on conflict (id) do nothing
        `)
        const locked = await tx.execute(
          sql`select count from engine_quota_ledger where id = ${ledgerId} for update`,
        )
        const current = Number((locked as unknown as Array<{ count: number }>)[0]?.count ?? 0)
        if (current >= quota.perDay) {
          throw new EngineError('QUOTA_EXCEEDED', `daily limit of ${quota.perDay} reached for '${id}'`)
        }
        await tx.execute(sql`update engine_quota_ledger set count = count + 1 where id = ${ledgerId}`)
      }

      const runId = randomUUID()
      const traceId = randomUUID()
      await tx.insert(schema.engineRuns).values({
        runId,
        workflowId: id,
        consumerId,
        input: parsed.data,
        traceId,
        status: 'queued',
      })
      return { runId, traceId }
    })
  } catch (e) {
    if (e instanceof EngineError) return fail(c, e)
    throw e
  }

  await enqueue(result.runId) // see dispatch note in README (D-5 outbox refinement)
  return c.json({ runId: result.runId, status: 'queued', traceId: result.traceId })
})

app.get('/v1/runs/:id', async (c) => {
  const row = await db.query.engineRuns.findFirst({
    where: eq(schema.engineRuns.runId, c.req.param('id')),
  })
  if (!row) return fail(c, new EngineError('SKILL_NOT_FOUND', 'run not found'))
  return c.json(row)
})

app.get('/v1/runs', async (c) => {
  const status = c.req.query('status')
  const consumer = c.req.query('consumer')
  const conds = [
    status ? eq(schema.engineRuns.status, status as 'queued') : undefined,
    consumer ? eq(schema.engineRuns.consumerId, consumer) : undefined,
  ].filter(Boolean)
  const rows = await db
    .select()
    .from(schema.engineRuns)
    .where(conds.length ? and(...(conds as [ReturnType<typeof eq>])) : undefined)
    .orderBy(desc(schema.engineRuns.createdAt))
    .limit(100)
  return c.json({ runs: rows })
})

/** GET /v1/approvals?state=pending&approver=role:medic — the human gate worklist (D-8). */
app.get('/v1/approvals', async (c) => {
  const state = c.req.query('state')
  const approver = c.req.query('approver')
  const conds = [
    state ? eq(schema.engineApprovals.state, state as 'pending') : undefined,
    approver ? eq(schema.engineApprovals.approver, approver) : undefined,
  ].filter(Boolean)
  const rows = await db
    .select()
    .from(schema.engineApprovals)
    .where(conds.length ? and(...(conds as [ReturnType<typeof eq>])) : undefined)
    .orderBy(desc(schema.engineApprovals.createdAt))
    .limit(100)
  return c.json({ approvals: rows })
})

/** POST /v1/approvals/:id/approve — flip the gate and dispatch the onApprove run (D-8). */
app.post('/v1/approvals/:id/approve', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { decided_by?: string }
  const decidedBy = body.decided_by ?? 'unknown'

  const approval = await db.query.engineApprovals.findFirst({
    where: eq(schema.engineApprovals.approvalId, id),
  })
  if (!approval) return fail(c, new EngineError('SKILL_NOT_FOUND', 'approval not found'))
  if (approval.state !== 'pending') {
    return c.json({ error: new EngineError('APPROVAL_DENIED', `already ${approval.state}`).toEnvelope() }, 409)
  }

  const target = getWorkflow(approval.workflowId)
  if (!target) return fail(c, new EngineError('SKILL_NOT_FOUND', `onApprove target '${approval.workflowId}' missing`))
  const parsedArtifact = target.manifest.input.safeParse(approval.artifact)
  if (!parsedArtifact.success) {
    return fail(c, new EngineError('ARGS_INVALID', `artifact does not match '${approval.workflowId}' input`))
  }

  const sourceRun = await db.query.engineRuns.findFirst({
    where: eq(schema.engineRuns.runId, approval.sourceRunId),
  })
  const consumerId = sourceRun?.consumerId ?? 'unknown'

  let childRunId: string
  try {
    childRunId = await db.transaction(async (tx) => {
      // Re-check state under lock so two approvers can't both dispatch.
      const locked = await tx.execute(
        sql`select state from engine_approvals where approval_id = ${id} for update`,
      )
      const state = (locked as unknown as Array<{ state: string }>)[0]?.state
      if (state !== 'pending') throw new EngineError('APPROVAL_DENIED', `already ${state}`)

      const child = randomUUID()
      await tx.insert(schema.engineRuns).values({
        runId: child,
        workflowId: approval.workflowId,
        consumerId,
        input: parsedArtifact.data,
        traceId: randomUUID(),
        parentRunId: approval.sourceRunId,
        status: 'queued',
      })
      await tx
        .update(schema.engineApprovals)
        .set({ state: 'approved', decidedBy, decidedAt: new Date(), dispatchedRunId: child })
        .where(eq(schema.engineApprovals.approvalId, id))
      return child
    })
  } catch (e) {
    if (e instanceof EngineError) {
      return c.json({ error: e.toEnvelope() }, 409)
    }
    throw e
  }

  await enqueue(childRunId)
  return c.json({ approvalId: id, state: 'approved', runId: childRunId })
})

app.post('/v1/approvals/:id/reject', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { decided_by?: string; reason?: string }
  const updated = await db
    .update(schema.engineApprovals)
    .set({ state: 'rejected', decidedBy: body.decided_by ?? 'unknown', decidedAt: new Date() })
    .where(and(eq(schema.engineApprovals.approvalId, id), eq(schema.engineApprovals.state, 'pending')))
    .returning({ approvalId: schema.engineApprovals.approvalId })
  if (updated.length === 0) {
    return c.json({ error: new EngineError('APPROVAL_DENIED', 'not found or already decided').toEnvelope() }, 409)
  }
  return c.json({ approvalId: id, state: 'rejected' })
})

const port = Number(process.env.PORT ?? 8787)
await getBoss() // ensure the queue exists before serving
serve({ fetch: app.fetch, port })
console.log(`[engine-api] listening on :${port}`)
