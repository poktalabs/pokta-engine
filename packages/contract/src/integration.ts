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
 *
 * `status: 'simulated'` means the integration is wired but **not configured**
 * (no provider key in this deployment) — the side effect was skipped, not failed.
 * This is the modular default: integrations ship in the code and activate when
 * their keys are present. The dashboard renders it neutrally, never as an error.
 */
import { z } from 'zod'

export interface IntegrationResult {
  provider: 'notion' | 'resend'
  status: 'ok' | 'failed' | 'simulated'
  /** External id of the created artifact: Notion pageId | Resend messageId. */
  ref?: string
  /** Human-openable URL when the provider has one (e.g. the Notion page). */
  url?: string
  /** Present iff status === 'failed' — the error message, surfaced for retry. */
  error?: string
  /** ISO 8601 timestamp of the attempt. */
  at: string
}

/**
 * Per-tenant CONNECTION status for an integration (P5b). This is the tenant's
 * configured wiring state for a provider (`engine_tenant_integrations.status`),
 * NOT the per-call {@link IntegrationResult}:
 *   - `enabled`  — connected + active (secrets present, side effects allowed),
 *   - `pending`  — known/desired but not yet connected (no secrets yet),
 *   - `disabled` — explicitly off (audit row kept; never deleted).
 */
export const integrationConnectionStatusSchema = z.enum(['enabled', 'pending', 'disabled'])
export type IntegrationConnectionStatus = z.infer<typeof integrationConnectionStatusSchema>

/**
 * One row of `GET /v1/integrations` — a tenant's integration enriched with the
 * live registry descriptor (`displayName`, `category`) joined to its per-tenant
 * connection `status`. NO secret value is ever included.
 */
export const integrationStatusSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  category: z.string(),
  status: integrationConnectionStatusSchema,
  detail: z.string().optional(),
})
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>

/** Response envelope for `GET /v1/integrations`. */
export const integrationListResponseSchema = z.object({
  integrations: z.array(integrationStatusSchema),
})
export type IntegrationListResponse = z.infer<typeof integrationListResponseSchema>
