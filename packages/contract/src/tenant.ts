import { z } from 'zod'

/**
 * The tenant lifecycle status (mirrors the `tenant_status` pg enum in
 * @godin-engine/db). Only `'active'` tenants resolve + dispatch; `'pending'` and
 * `'disabled'` fail closed at resolveTenant and GET /v1/tenants/me.
 */
export const tenantStatusSchema = z.enum(['active', 'pending', 'disabled'])
export type TenantStatus = z.infer<typeof tenantStatusSchema>

/**
 * Display branding for a tenant — the TYPED projection of `engine_tenants.branding`
 * (stored as jsonb). Display-only; never used for authorization.
 */
export const tenantBrandingSchema = z.object({
  name: z.string(),
  badge: z.string().optional(),
})
export type TenantBranding = z.infer<typeof tenantBrandingSchema>

/**
 * `GET /v1/tenants/me` response (PR2). The shared, safe projection of a tenant
 * registry row that the SPA renders:
 *
 *   - `branding` is the TYPED branding (not the raw jsonb column),
 *   - `allowedWorkflows` is already FILTERED to this tenant's allow-list ∩ the
 *     live workflow registry (the SPA never sees a workflow it cannot dispatch).
 *
 * Integrations are NO LONGER part of this view (D-Codex#4 / P5b) — the tenant's
 * per-integration connection status is its own surface (`GET /v1/integrations`,
 * backed by `engine_tenant_integrations`), not derived from the live registry here.
 *
 * Deliberately omits `members` and `secretPrefix` — those are server-only authz /
 * ops fields and never leave the engine.
 */
export const tenantViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: tenantStatusSchema,
  currency: z.string(),
  locale: z.string(),
  branding: tenantBrandingSchema,
  allowedWorkflows: z.array(z.string()),
})
export type TenantView = z.infer<typeof tenantViewSchema>

/**
 * The lifecycle status of an invite (mirrors the `invite_status` pg enum in
 * @godin-engine/db): `pending` (seeded, unclaimed), `claimed` (a verified DID is
 * bound), `revoked` (deprovisioned — frees the email to be re-invited).
 */
export const inviteStatusSchema = z.enum(['pending', 'claimed', 'revoked'])
export type InviteStatus = z.infer<typeof inviteStatusSchema>

/**
 * A single invite row as projected by the operator-gated admin API (Wave 3). The
 * MINIMAL honest view: the email, its status, and — when claimed — which DID claimed
 * it and when (ISO string). Deliberately omits created_at/updated_at; this is an ops
 * roster, not an audit export.
 */
export const inviteViewSchema = z.object({
  email: z.string(),
  status: inviteStatusSchema,
  claimedByDid: z.string().nullable(),
  claimedAt: z.string().nullable(),
})
export type InviteView = z.infer<typeof inviteViewSchema>

/** `GET /admin/tenants/:tenantId/invites` response — the tenant's invite roster. */
export const inviteListResponseSchema = z.object({
  invites: z.array(inviteViewSchema),
})
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>
