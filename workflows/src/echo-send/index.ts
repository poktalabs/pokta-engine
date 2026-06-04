import type { RunContext } from '@godin-engine/contract'

/** Run 2: the real write/send, executed only after a human approved the gate. */
export async function run(input: { proposal: string }, ctx: RunContext) {
  ctx.logger.info('echo-send', { runId: ctx.runId })
  return { sent: true, delivered: input.proposal }
}
