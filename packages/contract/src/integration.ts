/**
 * The integration seam (frozen in Phase 0 — see PLAN-demo-integrations.md).
 *
 * A workflow's `run()` performs a real, post-approval side effect (write to the
 * CRM, send an email) and records the result here in its output, NEVER throwing
 * on integration failure (D3 fail-soft). The operator dashboard reads these off
 * `engine_runs.output` — no dedicated outcomes table (D1).
 *
 *   proposal-step.output.crmResult: IntegrationResult   (provider 'notion')
 *   send-step.output.sendResult:    IntegrationResult   (provider 'resend')
 *
 * A `status: 'failed'` result on a `succeeded` run is the normal fail-soft case;
 * the dashboard renders it distinctly (red outcome, run still green).
 */
export interface IntegrationResult {
  provider: 'notion' | 'resend'
  status: 'ok' | 'failed'
  /** External id of the created artifact: Notion pageId | Resend messageId. */
  ref?: string
  /** Human-openable URL when the provider has one (e.g. the Notion page). */
  url?: string
  /** Present iff status === 'failed' — the error message, surfaced for retry. */
  error?: string
  /** ISO 8601 timestamp of the attempt. */
  at: string
}
