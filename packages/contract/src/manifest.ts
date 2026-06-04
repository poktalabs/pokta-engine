import { z } from 'zod'
import type { Policy } from './policy'
import type { RunContext } from './run'

/** Per-workflow execution runtime (D-3). The engine stays runtime-agnostic. */
export const runtimeSchema = z.enum(['serverless', 'sandbox', 'agent'])
export type Runtime = z.infer<typeof runtimeSchema>

/**
 * The authored manifest (TS analog of pyme `SKILL.md` frontmatter). `input` is a
 * live Zod schema used by the control plane to validate request bodies, so the
 * manifest is held in memory, not serialized wholesale.
 */
export interface WorkflowManifest<I = unknown> {
  id: string
  version: string
  runtime: Runtime
  timeoutMs: number
  policy: Policy[]
  input: z.ZodType<I>
}

export type RunFn<I = unknown, O = unknown> = (input: I, ctx: RunContext) => Promise<O>

/** A discovered workflow = its manifest + its pure run function (D-8). */
export interface WorkflowModule<I = unknown, O = unknown> {
  manifest: WorkflowManifest<I>
  run: RunFn<I, O>
}
