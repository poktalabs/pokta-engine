import type { RunContext } from '@pokta-engine/contract'

/** Run 1: draft only. The returned object becomes the approval artifact. */
export async function run(input: { topic: string }, ctx: RunContext) {
  ctx.logger.info('echo-draft', { runId: ctx.runId, topic: input.topic })
  return { proposal: `Draft proposal about: ${input.topic}` }
}
