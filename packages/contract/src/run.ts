import { z } from 'zod'
import type { ErrorEnvelope } from './errors'

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export type RunStatus = z.infer<typeof runStatusSchema>

/**
 * Injected into every `run(input, ctx)` — the TS analog of pyme's Args/context
 * injection. The job gets identity + logging + a scratch dir, never the DB or
 * the policy state.
 */
export interface RunContext {
  runId: string
  traceId: string
  logger: {
    info: (msg: string, meta?: unknown) => void
    error: (msg: string, meta?: unknown) => void
  }
  /** Per-run scratch directory for artifacts (e.g. the Astro build output). */
  artifactDir: string
}

export interface RunResult<O = unknown> {
  runId: string
  status: RunStatus
  output?: O
  error?: ErrorEnvelope
}
