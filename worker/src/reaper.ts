import { EngineError, type RunContext } from '@godin-engine/contract'

/**
 * A run as the reaper sees it. Narrowed to the fields needed to decide whether a
 * `running` run has overstayed its deadline, so the logic stays unit-testable
 * without a DB.
 */
export interface ReapableRun {
  runId: string
  workflowId: string
  startedAt: Date | null
}

/** Side-effect seams the reaper drives. Injected so the decision logic stays pure. */
export interface ReaperEffects {
  /** All runs currently in status `running`. */
  listRunningRuns: () => Promise<ReapableRun[]>
  /**
   * The per-workflow timeoutMs. Returns null for an unregistered workflow so the
   * reaper can fall back to its default deadline rather than guess.
   */
  timeoutMsFor: (workflowId: string) => number | null
  /** Mark a stranded run failed with the given envelope (worker is the only writer). */
  failRun: (runId: string, err: EngineError) => Promise<void>
}

/**
 * Default deadline (ms) used when a `running` run's workflow is no longer
 * registered (e.g. renamed/removed) and so has no manifest timeout to read.
 */
export const DEFAULT_TIMEOUT_MS = 20 * 60_000

/**
 * Extra slack (ms) added on top of a workflow's `timeoutMs` before the reaper
 * declares a `running` run stranded. `withTimeout` should normally fail a run in
 * `timeoutMs`; the reaper only catches runs whose worker died before it could —
 * so the grace keeps the reaper from racing a still-finishing run.
 */
export const DEFAULT_GRACE_MS = 60_000

/**
 * Decide whether a single `running` run has stranded: started, and now past
 * `startedAt + timeoutMs + grace`. A run with no `startedAt` is not yet running
 * for real, so it's never reaped here. Pure.
 */
export function isStranded(
  run: ReapableRun,
  timeoutMs: number,
  now: Date,
  graceMs: number = DEFAULT_GRACE_MS,
): boolean {
  if (!run.startedAt) return false
  const deadline = run.startedAt.getTime() + timeoutMs + graceMs
  return now.getTime() > deadline
}

/**
 * The reaper (D8). Periodically fails any run stuck in `running` past its
 * deadline so a crashed mid-batch worker never strands a run forever. Idempotent:
 * each pass only touches runs still `running` and past deadline. Pure given its
 * injected `effects`; the schedule + DB wiring lives in the worker entrypoint.
 */
export async function reapStrandedRuns(
  effects: ReaperEffects,
  logger: RunContext['logger'],
  now: Date = new Date(),
  graceMs: number = DEFAULT_GRACE_MS,
): Promise<number> {
  const running = await effects.listRunningRuns()
  let reaped = 0

  for (const run of running) {
    const timeoutMs = effects.timeoutMsFor(run.workflowId) ?? DEFAULT_TIMEOUT_MS
    if (!isStranded(run, timeoutMs, now, graceMs)) continue

    const err = new EngineError(
      'SKILL_TIMEOUT',
      `run stranded in 'running' past ${timeoutMs}ms + ${graceMs}ms grace (worker likely crashed mid-run)`,
      true,
    )
    await effects.failRun(run.runId, err)
    reaped += 1
    logger.error(`reaper failed stranded run ${run.runId} (workflow ${run.workflowId})`)
  }

  if (reaped > 0) logger.info(`reaper failed ${reaped} stranded run(s)`)
  return reaped
}
