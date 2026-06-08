import type { TenantId } from '@/providers/TenantProvider'

/**
 * Settings fixtures (M2 P4-C) — READ-ONLY for M2.
 *
 * The Settings surface shows three read-only panels: the tenant profile, an
 * integration-status summary, and the user roster. There is NO credential
 * editing and NO write surface in M2 — credential management is explicitly
 * descoped (the page renders a "coming soon" affordance for any such surface).
 *
 * No backend exists for any of this yet, so the whole surface is mock-only
 * behind `VITE_USE_MOCKS`. These shapes are page-local (not contract types):
 *   - `SettingsView` is NOT a contract type — `GET /v1/settings` is a P5a
 *     addition that does not exist today. When it lands, this shape is what the
 *     hook reconciles against.
 *   - The integration-status summary reuses the resolved 3-tier risk scale
 *     (`risk-tiers.css`, no new brand color) and the `connected | estimated |
 *     not-yet-live` status vocabulary from the M2 plan's `IntegrationStatus`.
 *
 * Unlike the approvals fixtures, this module does NOT self-register a mock route
 * (the `GET /v1/settings` endpoint is not defined in the registry yet). It
 * exports typed fixtures the page consumes directly behind `VITE_USE_MOCKS`; the
 * hook + route registration land with P5a. Exporting (rather than registering)
 * keeps it from colliding with the frozen registry seam.
 */

/** Coarse risk tier — the resolved 3-tier scale (P1-C-risk, no new color). */
export type SettingsRiskTier = 'low' | 'medium' | 'high'

/** Catalog/status of one connector, as surfaced read-only in Settings. */
export type IntegrationConnectionStatus =
  | 'connected'
  | 'estimated'
  | 'not-yet-live'

/** One connector row in the integration-status summary. */
export interface IntegrationStatusSummary {
  /** Open provider id (shopify, mercadolibre, gohighlevel, …). */
  provider: string
  /** Human label for the provider. */
  label: string
  status: IntegrationConnectionStatus
  riskTier: SettingsRiskTier
  /** Optional one-line detail (e.g. "Test store · 3 stores tracked"). */
  detail?: string
}

/** A workspace member, read-only roster row. */
export type MemberRole = 'owner' | 'admin' | 'approver' | 'viewer'

export interface WorkspaceMember {
  id: string
  name: string
  email: string
  role: MemberRole
  /** Membership status — only `active` is surfaced in M2. */
  status: 'active' | 'invited'
  /** ISO 8601; null when the member has not signed in yet. */
  lastActiveAt: string | null
}

/** Read-only tenant profile block. */
export interface TenantProfile {
  tenantId: TenantId
  name: string
  /** ISO 4217, mirrors TenantProvider currency. */
  currency: 'MXN' | 'USD'
  /** Default workspace locale (user pref overrides display locale). */
  locale: 'es-MX' | 'en'
  /** Plan label, illustrative. */
  plan: string
  /** ISO 8601 — when this tenant workspace was created. */
  createdAt: string
  /** Optional amber badge text (e.g. "Shopify test store"). */
  badge?: string
}

/** The full read-only settings payload for one tenant. */
export interface SettingsView {
  profile: TenantProfile
  integrations: IntegrationStatusSummary[]
  members: WorkspaceMember[]
}

const MIPASE_SETTINGS: SettingsView = {
  profile: {
    tenantId: 'mipase',
    name: 'Mi Pase',
    currency: 'MXN',
    locale: 'es-MX',
    plan: 'Pilot · single-tenant',
    createdAt: '2026-04-02T09:00:00.000Z',
    badge: 'Shopify test store',
  },
  integrations: [
    {
      provider: 'shopify',
      label: 'Shopify',
      status: 'connected',
      riskTier: 'medium',
      detail: 'Test store · price writes gated behind approval',
    },
    {
      provider: 'mercadolibre',
      label: 'Mercado Libre',
      status: 'estimated',
      riskTier: 'low',
      detail: 'Competitor price reference only (read)',
    },
    {
      provider: 'coppel',
      label: 'Coppel',
      status: 'estimated',
      riskTier: 'low',
      detail: 'Competitor price reference only (read)',
    },
    {
      provider: 'elektra',
      label: 'Elektra',
      status: 'estimated',
      riskTier: 'low',
      detail: 'Competitor price reference only (read)',
    },
    {
      provider: 'liverpool',
      label: 'Liverpool',
      status: 'not-yet-live',
      riskTier: 'low',
      detail: 'Connector planned — not yet live',
    },
    {
      provider: 'amazon-mx',
      label: 'Amazon MX',
      status: 'not-yet-live',
      riskTier: 'low',
      detail: 'Connector planned — not yet live',
    },
  ],
  members: [
    {
      id: 'usr_mp_owner',
      name: 'Lucía Hernández',
      email: 'lucia@mipase.mx',
      role: 'owner',
      status: 'active',
      lastActiveAt: '2026-06-08T11:42:00.000Z',
    },
    {
      id: 'usr_mp_ops',
      name: 'Diego Ramírez',
      email: 'diego@mipase.mx',
      role: 'approver',
      status: 'active',
      lastActiveAt: '2026-06-08T08:15:00.000Z',
    },
    {
      id: 'usr_mp_analyst',
      name: 'Sofía Castro',
      email: 'sofia@mipase.mx',
      role: 'viewer',
      status: 'active',
      lastActiveAt: '2026-06-05T17:03:00.000Z',
    },
  ],
}

const VINO_SETTINGS: SettingsView = {
  profile: {
    tenantId: 'vino',
    name: 'Vino Design Build',
    currency: 'USD',
    locale: 'en',
    plan: 'Pilot · single-tenant',
    createdAt: '2026-05-19T14:00:00.000Z',
  },
  integrations: [
    {
      provider: 'gohighlevel',
      label: 'GoHighLevel',
      status: 'estimated',
      riskTier: 'medium',
      detail: 'CRM pipeline moves gated behind approval',
    },
    {
      provider: 'jobtread',
      label: 'JobTread',
      status: 'estimated',
      riskTier: 'high',
      detail: 'Estimate commits gated behind approval',
    },
    {
      provider: 'gmail',
      label: 'Gmail',
      status: 'connected',
      riskTier: 'low',
      detail: 'Drafted follow-ups sent on approval',
    },
    {
      provider: 'google-calendar',
      label: 'Google Calendar',
      status: 'estimated',
      riskTier: 'low',
      detail: 'Site-visit scheduling (read)',
    },
    {
      provider: 'smartsuite',
      label: 'SmartSuite',
      status: 'not-yet-live',
      riskTier: 'low',
      detail: 'Connector planned — not yet live',
    },
  ],
  members: [
    {
      id: 'usr_vino_owner',
      name: 'Marco Vino',
      email: 'marco@vinodesignbuild.com',
      role: 'owner',
      status: 'active',
      lastActiveAt: '2026-06-08T16:20:00.000Z',
    },
    {
      id: 'usr_vino_pm',
      name: 'Dana Keller',
      email: 'dana@vinodesignbuild.com',
      role: 'admin',
      status: 'active',
      lastActiveAt: '2026-06-07T19:48:00.000Z',
    },
  ],
}

const SETTINGS_BY_TENANT: Record<TenantId, SettingsView> = {
  mipase: MIPASE_SETTINGS,
  vino: VINO_SETTINGS,
}

/** Read the mock SettingsView for a tenant (deep-cloned so callers can't mutate). */
export function getMockSettings(tenantId: TenantId): SettingsView {
  return structuredClone(SETTINGS_BY_TENANT[tenantId])
}

/** An empty settings payload — drives the page's EMPTY state in demos/tests. */
export const EMPTY_SETTINGS: SettingsView = {
  profile: {
    tenantId: 'mipase',
    name: 'Mi Pase',
    currency: 'MXN',
    locale: 'es-MX',
    plan: 'Pilot · single-tenant',
    createdAt: '2026-04-02T09:00:00.000Z',
  },
  integrations: [],
  members: [],
}
