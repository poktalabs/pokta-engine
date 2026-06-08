import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { EngineError, type RunContext } from '@godin-engine/contract'
import { db, schema } from '@godin-engine/db'
import { getBoss, QUEUE, type RunJob } from '@godin-engine/queue'
import { getWorkflow } from '@godin-engine/workflows'
import { type DispatchEffects, dispatchOnSuccess } from './dispatch'
import { makeIntegrationResolver } from './integration-resolver'
// Side-effect import (T9): registers the env-backed shopify + mercadolibre
// provider factories with the resolver, and declaration-merges their client
// types into the contract's IntegrationClients map.
import './provider-config'
import { type ReaperEffects, reapStrandedRuns } from './reaper'

/** Up to this many jobs run concurrently per poll (the thesis's "parallel slots"). */
const TEAM_SIZE = 5

/** Dedicated queue for the reaper's self-fired tick (kept off the run queue). */
const REAPER_QUEUE = 'workflow.reaper'
/** Cron for the reaper tick — every 5 minutes (D8: catch crashed mid-batch runs). */
const REAPER_CRON = '*/5 * * * *'
// Note: this service's Railway Watch Paths must include the shared packages
// (workflows/, packages/**) or it won't rebuild when a workflow changes.
// (rebuild marker: integrations simulate when unconfigured — keyless-safe prod)

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

/** Production wiring of the dispatch seams against the DB + queue. */
function liveEffects(): DispatchEffects {
  return {
    dispatchChildRun: async ({ workflowId, consumerId, input, parentRunId }) => {
      const childRunId = randomUUID()
      await db.insert(schema.engineRuns).values({
        runId: childRunId,
        workflowId,
        consumerId,
        input,
        traceId: randomUUID(),
        parentRunId,
        status: 'queued',
      })
      const boss = await getBoss()
      await boss.send(QUEUE, { runId: childRunId } satisfies RunJob)
      return childRunId
    },
    openApprovalGate: async ({ sourceRunId, workflowId, artifact, approver }) => {
      await db.insert(schema.engineApprovals).values({
        approvalId: randomUUID(),
        sourceRunId,
        workflowId,
        artifact,
        approver,
        state: 'pending',
      })
    },
  }
}

/** Production wiring of the reaper seams against the DB + workflow registry. */
function liveReaperEffects(): ReaperEffects {
  return {
    listRunningRuns: async () => {
      const rows = await db.query.engineRuns.findMany({
        where: eq(schema.engineRuns.status, 'running'),
        columns: { runId: true, workflowId: true, startedAt: true },
      })
      return rows.map((r) => ({ runId: r.runId, workflowId: r.workflowId, startedAt: r.startedAt }))
    },
    timeoutMsFor: (workflowId) => getWorkflow(workflowId)?.manifest.timeoutMs ?? null,
    failRun: markFailed,
  }
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
    // Lazy per-tenant accessor (D2): resolves ONLY the provider a workflow asks
    // for, scoped to this run's consumer, throwing when it's unconfigured.
    integration: makeIntegrationResolver(run.consumerId),
  }

  try {
    const output = await withTimeout(wf.run(run.input, ctx), wf.manifest.timeoutMs)
    await db
      .update(schema.engineRuns)
      .set({ status: 'succeeded', output, finishedAt: new Date() })
      .where(eq(schema.engineRuns.runId, runId))

    // Post-success fan-out (D1): ungated onComplete child + the gated approval
    // child fire independently. Both keyed off this run's output.
    await dispatchOnSuccess(
      { runId, consumerId: run.consumerId },
      wf.manifest,
      output,
      liveEffects(),
      ctx.logger,
    )
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

  // Reaper (D8): pg-boss fires a tick onto REAPER_QUEUE on REAPER_CRON; the work
  // handler fails any run stranded in 'running' past its deadline. No custom cron.
  const reaperLogger = makeLogger('reaper')
  await boss.createQueue(REAPER_QUEUE)
  await boss.work(REAPER_QUEUE, async () => {
    await reapStrandedRuns(liveReaperEffects(), reaperLogger)
  })
  await boss.schedule(REAPER_QUEUE, REAPER_CRON)
  console.log(`[worker] reaper scheduled on '${REAPER_QUEUE}' (${REAPER_CRON})`)
}

// Only boot the worker when run as the service entrypoint — importing this module
// (e.g. from a test) must not start polling or require DATABASE_URL.
if (process.env.WORKER_AUTOSTART !== 'off') {
  main().catch((e) => {
    console.error('[worker] fatal', e)
    process.exit(1)
  })
}
