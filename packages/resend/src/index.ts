/**
 * Resend email integration client (Phase 0 stub — implemented by Lane B / TASK-002).
 *
 * Mirrors the `packages/llm` discipline: reads its own env, throws when
 * unconfigured or on error, and the CALLER owns the fallback. The workflow
 * (`send-step`) wraps `sendEmail` in try/catch and records an `IntegrationResult`
 * (fail-soft, D3). This module never returns a failure shape — it throws.
 *
 * Env (read at call time, see PLAN-demo-integrations.md):
 *   RESEND_API_KEY  — Resend API key
 *   RESEND_FROM     — verified sender (e.g. "Vino <hello@vino.example>")
 *   RESEND_TO       — demo recipient override (optional; defaults to email.to)
 */

import { Resend } from 'resend'

const API_KEY = process.env.RESEND_API_KEY ?? ''
const FROM = process.env.RESEND_FROM ?? ''
const TO_OVERRIDE = process.env.RESEND_TO ?? ''

export function resendConfigured(): boolean {
  return API_KEY.length > 0 && FROM.length > 0
}

export function resendInfo(): { configured: boolean; from: string; toOverride: string } {
  return { configured: resendConfigured(), from: FROM, toOverride: TO_OVERRIDE }
}

export interface EmailInput {
  to: string
  subject: string
  body: string
}

/** Provider message id returned on success. */
export interface SentMessage {
  messageId: string
}

let client: Resend | null = null
function getClient(): Resend {
  if (!resendConfigured()) throw new Error('Resend not configured (set RESEND_API_KEY / RESEND_FROM)')
  if (!client) client = new Resend(API_KEY)
  return client
}

/**
 * Send an email via Resend. THROWS when unconfigured or on API error — the
 * caller catches and records the failure (D3). When RESEND_TO is set it
 * overrides the recipient (demo safety — keeps test sends off real inboxes).
 */
export async function sendEmail(input: EmailInput): Promise<SentMessage> {
  const to = TO_OVERRIDE || input.to
  const { data, error } = await getClient().emails.send({
    from: FROM,
    to,
    subject: input.subject,
    text: input.body,
  })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
  if (!data?.id) throw new Error('Resend send returned no message id')
  return { messageId: data.id }
}
