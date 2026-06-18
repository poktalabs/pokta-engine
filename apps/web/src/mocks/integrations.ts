import { registerMock } from './registry'

/**
 * Integrations catalog fixtures (M2 P4-A).
 *
 * The dashboard needs an integration **catalog/status** shape — distinct from the
 * run-output `IntegrationResult` (provider 'notion'|'resend') in
 * `@pokta-engine/contract`. The catalog type does NOT exist in the contract yet:
 * the plan schedules `IntegrationStatus` + `GET /v1/integrations` as a P5a contract
 * addition. Until that lands, the type lives here (mock-only) and the grid is served
 * ONLY behind `VITE_USE_MOCKS` — there is no backend for any of these providers.
 *
 * When the contract type ships, swap this local `IntegrationStatus` for the import
 * from `@pokta-engine/contract`; the catalog data below stays put.
 *
 *   GET /v1/integrations → { integrations: IntegrationStatus[] }
 *
 * Risk uses the resolved 3-tier scale (P1-C-risk, risk-tiers.css) — NO new brand
 * color. JobTread's "very-high" estimate-commit risk COLLAPSES to `high` (the only
 * "stop" color); the copy still says "highest" so the nuance survives without a 4th
 * color (brand governance decision: 3 tiers only).
 */

/** The resolved 3-tier risk scale (mirrors `risk-tiers.css` / the RiskBadge). */
export type RiskTier = 'low' | 'medium' | 'high'

/**
 * Connection status for a catalog entry.
 *   - `connected`   → live: a real key/credential is present, the feed is flowing.
 *   - `estimated`   → wired but keyless in this deployment → illustrative/simulated.
 *   - `not-yet-live`→ planned connector, not yet wired (roadmap).
 */
export type IntegrationConnectionStatus = 'connected' | 'estimated' | 'not-yet-live'

/**
 * One integration catalog/status entry — NOT `IntegrationResult` (the run-output
 * type). Local mirror of the planned `@pokta-engine/contract` `IntegrationStatus`.
 */
export interface IntegrationStatus {
  /** OPEN provider id (shopify, mercadolibre, gohighlevel, jobtread, …). */
  provider: string
  /** Human-readable connector name. */
  name: string
  /** Connection status driving the status pill. */
  status: IntegrationConnectionStatus
  /** Resolved 3-tier risk of the writes/reads this connector performs. */
  riskTier: RiskTier
  /** One-line plain-language description of what the connector does. */
  detail?: string
  /**
   * The small per-card report/data slot — a compact figure the card surfaces
   * (e.g. "SKUs synced", "competitor SKUs tracked"). Mock-only illustrative data.
   */
  report?: { label: string; value: string }
  /** True when the connector only READS (a feed), never writes back. */
  readOnly?: boolean
}

/** The `GET /v1/integrations` envelope (mirrors the planned contract shape). */
export interface IntegrationListResponse {
  integrations: IntegrationStatus[]
}

/* ─── Mi Pase (Shopify commerce + Mexican marketplace/competitor feeds) ─────── */

const MIPASE_INTEGRATIONS: IntegrationStatus[] = [
  {
    provider: 'shopify',
    name: 'Shopify',
    status: 'connected',
    riskTier: 'medium',
    detail: 'Test store — daily-pricing applies suggested prices here after approval.',
    report: { label: 'SKUs synced', value: '1,284' },
  },
  {
    provider: 'mercadolibre',
    name: 'Mercado Libre',
    status: 'connected',
    riskTier: 'low',
    detail: 'Live competitor price feed — the only real-time reference today.',
    report: { label: 'Live SKUs tracked', value: '946' },
    readOnly: true,
  },
  {
    provider: 'coppel',
    name: 'Coppel',
    status: 'estimated',
    riskTier: 'low',
    detail: 'Competitor feed — periodic scrape, illustrative until a key is set.',
    report: { label: 'Last sweep', value: 'simulated' },
    readOnly: true,
  },
  {
    provider: 'elektra',
    name: 'Elektra',
    status: 'estimated',
    riskTier: 'low',
    detail: 'Competitor feed — periodic scrape, illustrative until a key is set.',
    report: { label: 'Last sweep', value: 'simulated' },
    readOnly: true,
  },
  {
    provider: 'liverpool',
    name: 'Liverpool',
    status: 'estimated',
    riskTier: 'low',
    detail: 'Competitor feed — periodic scrape, illustrative until a key is set.',
    report: { label: 'Last sweep', value: 'simulated' },
    readOnly: true,
  },
  {
    provider: 'amazon-mx',
    name: 'Amazon MX',
    status: 'not-yet-live',
    riskTier: 'low',
    detail: 'Competitor feed — connector planned, not yet wired.',
    report: { label: 'Status', value: 'roadmap' },
    readOnly: true,
  },
]

/* ─── Vino Design Build (CRM, jobs, comms, scheduling, ops) ──────────────────── */

const VINO_INTEGRATIONS: IntegrationStatus[] = [
  {
    provider: 'gohighlevel',
    name: 'GoHighLevel',
    status: 'connected',
    riskTier: 'medium',
    detail: 'CRM pipeline — lead-qual moves leads between stages after approval.',
    report: { label: 'Leads in pipeline', value: '38' },
  },
  {
    provider: 'jobtread',
    name: 'JobTread',
    // Very-high (estimate commit) COLLAPSES to high — 3-tier scale, no new color.
    status: 'connected',
    riskTier: 'high',
    detail: 'Jobs & estimates — committing an estimate locks a client-facing figure.',
    report: { label: 'Open jobs', value: '12' },
  },
  {
    provider: 'gmail',
    name: 'Gmail',
    status: 'connected',
    riskTier: 'medium',
    detail: 'Outbound email — drafted follow-ups send from sales@ after approval.',
    report: { label: 'Drafts pending', value: '3' },
  },
  {
    provider: 'google-calendar',
    name: 'Google Calendar',
    status: 'connected',
    riskTier: 'low',
    detail: 'Scheduling — reads availability for site-visit booking.',
    report: { label: 'Upcoming visits', value: '5' },
    readOnly: true,
  },
  {
    provider: 'twilio',
    name: 'Twilio',
    status: 'estimated',
    riskTier: 'medium',
    detail: 'SMS reminders — wired but keyless here, so sends are simulated.',
    report: { label: 'SMS this month', value: 'simulated' },
  },
  {
    provider: 'smartsuite',
    name: 'SmartSuite',
    status: 'estimated',
    riskTier: 'low',
    detail: 'Ops records — wired but keyless here, so writes are simulated.',
    report: { label: 'Records synced', value: 'simulated' },
  },
]

/** Per-tenant integration catalogs, keyed by `TenantId`. */
export const MOCK_INTEGRATIONS: Record<string, IntegrationStatus[]> = {
  'mi-pase': MIPASE_INTEGRATIONS,
  vino: VINO_INTEGRATIONS,
}

/**
 * Resolve a tenant's catalog. Unknown tenants resolve to an empty list (the page
 * renders its empty state) rather than throwing — keeps the surface resilient.
 */
export function integrationsForTenant(tenantId: string): IntegrationStatus[] {
  return MOCK_INTEGRATIONS[tenantId] ?? []
}

/**
 * Register `GET /v1/integrations`. The mock scopes by a `?tenant=` query param so
 * the single route serves either tenant's set behind `VITE_USE_MOCKS`. Real wiring
 * (P5a) scopes server-side by the Privy-JWT→consumer_id; the param is a mock-only
 * affordance.
 */
registerMock('GET', /^\/v1\/integrations$/, (ctx): IntegrationListResponse => {
  const tenant = new URLSearchParams(ctx.path.split('?')[1] ?? '').get('tenant') ?? 'mi-pase'
  return { integrations: integrationsForTenant(tenant) }
})
