import { z } from 'zod'

/**
 * The tenant lifecycle status (mirrors the `tenant_status` pg enum in
 * @pokta-engine/db). Only `'active'` tenants resolve + dispatch; `'pending'` and
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
 * The per-user role WITHIN a tenant (admin-roles Wave A / D1) — mirrors the
 * `member_role` pg enum. `admin` manages the team (invites + the 5-seat cap);
 * `member` is a plain team member. Platform superadmin is a SEPARATE cross-tenant
 * dimension (`isSuperadmin`), not a value here.
 */
export const memberRoleSchema = z.enum(['admin', 'member'])
export type MemberRole = z.infer<typeof memberRoleSchema>

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
  // admin-roles Wave A (D3/Codex#13): ADDITIVE, optional, backward-compatible. The
  // caller's resolved role in THIS tenant + whether they are a platform superadmin,
  // so the SPA can adapt the Settings → Team panel. Optional so existing TenantView
  // producers/consumers (and the wire shape before this wave) stay valid.
  role: memberRoleSchema.optional(),
  isSuperadmin: z.boolean().optional(),
})
export type TenantView = z.infer<typeof tenantViewSchema>

/**
 * The lifecycle status of an invite (mirrors the `invite_status` pg enum in
 * @pokta-engine/db): `pending` (seeded, unclaimed), `claimed` (a verified DID is
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
  // admin-roles Wave A (D2): the role this invite grants on claim. Required — every
  // invite row now carries a role (DB default 'member').
  role: memberRoleSchema,
  claimedByDid: z.string().nullable(),
  claimedAt: z.string().nullable(),
})
export type InviteView = z.infer<typeof inviteViewSchema>

/** `GET /admin/tenants/:tenantId/invites` response — the tenant's invite roster. */
export const inviteListResponseSchema = z.object({
  invites: z.array(inviteViewSchema),
})
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>

/**
 * A tenant MEMBER as projected to a tenant-admin/superadmin (admin-roles Wave A). The
 * DID + its role within the tenant. Identity beyond the DID (names/emails) is deferred.
 */
export const memberViewSchema = z.object({
  did: z.string(),
  role: memberRoleSchema,
})
export type MemberView = z.infer<typeof memberViewSchema>

/**
 * The tenant TEAM view (admin-roles Wave A) — the invites roster + the bound members,
 * for the Settings → Team panel.
 */
export const teamViewSchema = z.object({
  invites: z.array(inviteViewSchema),
  members: z.array(memberViewSchema),
})
export type TeamView = z.infer<typeof teamViewSchema>

/**
 * A single tenant in the superadmin tenant PICKER (admin-roles Wave A) — the minimal
 * identity a superadmin needs to choose which tenant to manage. No secrets/config.
 */
export const tenantListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: tenantStatusSchema,
})
export type TenantListItem = z.infer<typeof tenantListItemSchema>

/** `GET /v1/superadmin/tenants` response — the superadmin's tenant list. */
export const tenantListResponseSchema = z.object({
  tenants: z.array(tenantListItemSchema),
})
export type TenantListResponse = z.infer<typeof tenantListResponseSchema>
