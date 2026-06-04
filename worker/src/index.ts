import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { EngineError, type RunContext } from '@godin-engine/contract'
import { db, schema } from '@godin-engine/db'
import { getBoss, QUEUE, type RunJob } from '@godin-engine/queue'
import { getWorkflow } from '@godin-engine/workflows'

/** Up to this many jobs run concurrently per poll (the thesis's "parallel slots"). */
const TEAM_SIZE = 5
// Note: this service's Railway Watch Paths must include the shared packages
// (workflows/, packages/**) or it won't rebuild when a workflow changes.
// (rebuild marker: llm timeout + workflow timeoutMs tuning)

function makeLogger(runId: string): RunContext['logger'] {
  return {
    info: (msg, meta) => console.log(`[run ${runId}] ${msg}`, meta ?? ''),
    error: (msg, meta) => console.error(`[run ${runId}] ${msg}`, meta ?? ''),
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new EngineError('SKILL_TIMEOUT', `exceeded ${ms}ms`, true)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

async function markFailed(runId: string, err: EngineError): Promise<void> {
  await db
    .update(schema.engineRuns)
    .set({ status: 'failed', error: err.toEnvelope(), finishedAt: new Date() })
    .where(eq(schema.engineRuns.runId, runId))
}

/** The worker is the ONLY writer of post-enqueue status (AGENTS.md hard rule). */
async function handle(runId: string): Promise<void> {
  const run = await db.query.engineRuns.findFirst({ where: eq(schema.engineRuns.runId, runId) })
  if (!run) {
    console.error(`[worker] run ${runId} not found`)
    return
  }

  const wf = getWorkflow(run.workflowId)
  if (!wf) {
    await markFailed(runId, new EngineError('SKILL_NOT_FOUND', `workflow '${run.workflowId}' not registered`))
    return
  }

  await db
    .update(schema.engineRuns)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.engineRuns.runId, runId))

  const ctx: RunContext = {
    runId,
    traceId: run.traceId,
    logger: makeLogger(runId),
    artifactDir: `/tmp/godin-engine/${runId}`,
  }

  try {
    const output = await withTimeout(wf.run(run.input, ctx), wf.manifest.timeoutMs)
    await db
      .update(schema.engineRuns)
      .set({ status: 'succeeded', output, finishedAt: new Date() })
      .where(eq(schema.engineRuns.runId, runId))

    // On success of an approval-policy workflow, open the first-class gate (D-8).
    const approval = wf.manifest.policy.find((p) => p.kind === 'approval')
    if (approval && approval.kind === 'approval') {
      await db.insert(schema.engineApprovals).values({
        approvalId: randomUUID(),
        sourceRunId: runId,
        workflowId: approval.onApprove,
        artifact: output,
        approver: approval.approver,
        state: 'pending',
      })
      ctx.logger.info(`approval gate opened → ${approval.onApprove} (approver ${approval.approver})`)
    }
  } catch (e) {
    const err =
      e instanceof EngineError
        ? e
        : new EngineError('SKILL_EXEC_ERROR', e instanceof Error ? e.message : String(e))
    await markFailed(runId, err)
  }
}

async function main(): Promise<void> {
  const boss = await getBoss()
  await boss.work<RunJob>(QUEUE, { batchSize: TEAM_SIZE }, async (jobs) => {
    const arr = Array.isArray(jobs) ? jobs : [jobs]
    await Promise.all(arr.map((job) => handle(job.data.runId)))
  })
  console.log(`[worker] processing '${QUEUE}' (batchSize ${TEAM_SIZE})`)
}

main().catch((e) => {
  console.error('[worker] fatal', e)
  process.exit(1)
})
