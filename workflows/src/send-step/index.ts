import type { RunContext } from '@godin-engine/contract'
import type { ClientEmail } from '../proposal-step'

export interface SendOutput {
  sent: true
  to: string
  subject: string
  note: string
}

/** The committed action. Reached only via an approved gate. Simulated send. */
export async function run(input: { email: ClientEmail }, ctx: RunContext): Promise<SendOutput> {
  ctx.logger.info(`send-step: delivering approved email to ${input.email.to} (simulated)`)
  return {
    sent: true,
    to: input.email.to,
    subject: input.email.subject,
    note: 'Simulated send — no real email left the system.',
  }
}
