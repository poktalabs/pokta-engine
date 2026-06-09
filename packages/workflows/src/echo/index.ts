import type { RunContext } from '@godin-engine/contract'

/** Pure work (D-8): no policy, no DB, no human. Returns its input. */
export async function run(input: { message: string }, ctx: RunContext) {
  ctx.logger.info('echo', { runId: ctx.runId, message: input.message })
  return { echoed: input.message, at: ctx.runId }
}
