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

/**
 * Send an email via Resend. THROWS when unconfigured or on API error — the
 * caller catches and records the failure (D3). Implemented by Lane B.
 * When RESEND_TO is set it overrides the recipient (demo safety).
 */
export async function sendEmail(_input: EmailInput): Promise<SentMessage> {
  if (!resendConfigured()) throw new Error('Resend not configured (set RESEND_API_KEY / RESEND_FROM)')
  throw new Error('sendEmail not implemented yet (Phase 0 stub — TASK-002)')
}
