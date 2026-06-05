import type { IntegrationResult, RunContext } from '@godin-engine/contract'
import { sendEmail } from '@godin-engine/resend'
import type { ClientEmail } from '../proposal-step'

export interface SendOutput {
  sent: boolean
  to: string
  subject: string
  sendResult: IntegrationResult
}

/**
 * The committed action. Reached only via an approved gate (gate 2). Terminal step.
 * Sends the approved email for real via Resend and records the outcome as an
 * `IntegrationResult` on the output. Fail-soft (D3): on send failure we record
 * `status:'failed'` and RESOLVE the run (never throw) so the dashboard can show
 * the failed send for retry instead of a dead run.
 */
export async function run(input: { email: ClientEmail }, ctx: RunContext): Promise<SendOutput> {
  const at = new Date().toISOString()
  try {
    ctx.logger.info(`send-step: delivering approved email to ${input.email.to} via Resend`)
    const { messageId } = await sendEmail({
      to: input.email.to,
      subject: input.email.subject,
      body: input.email.body,
    })
    ctx.logger.info(`send-step: Resend accepted message ${messageId}`)
    const sendResult: IntegrationResult = { provider: 'resend', status: 'ok', ref: messageId, at }
    return { sent: true, to: input.email.to, subject: input.email.subject, sendResult }
  } catch (e) {
    const error = (e as Error).message
    ctx.logger.error(`send-step: Resend send failed (${error}); recording fail-soft outcome`)
    const sendResult: IntegrationResult = { provider: 'resend', status: 'failed', error, at }
    return { sent: false, to: input.email.to, subject: input.email.subject, sendResult }
  }
}
