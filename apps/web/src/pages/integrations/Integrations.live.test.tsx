import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import { useTenantContext } from '@/providers/TenantProvider'
import Integrations from './Integrations'
import type { IntegrationStatus, TenantView } from '@godin-engine/contract'

/**
 * INTEGRATIONS-LIVE ★ (P5b Wave 2). The Integrations surface is wired off the
 * LIVE read model `GET /v1/integrations` — it is in `LIVE_PATHS`, so even under
 * the jsdom `VITE_USE_MOCKS=true` pin it bypasses the in-process mock registry
 * and hits `global.fetch`. This file asserts against the STUBBED fetch (NOT the
 * mock registry): real rows render with honest ops-asserted ENABLEMENT status
 * (enabled / pending / disabled — NEVER "Connected/Live"), an empty roster reads
 * "none enabled", the request carries NO `?tenant=` authority (the Privy JWT is
 * the only tenant authority), and the honest card renders none of the removed
 * risk / report / feed affordances.
 *
 * The Privy SDK (cannot boot in jsdom) is replaced by the shared controllable
 * mock; the tenant identity comes from the already-live `GET /v1/tenants/me`
 * (TenantProvider), which `IntegrationsGate` waits on before mounting the page
 * (the page reads `useTenant()`, valid only once the tenant has resolved — the
 * production gate is AppShell).
 */

vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft', 'pricing-apply-confident'],
}

/**
 * Mirror AppShell's gate: the page calls `useTenant()`, which throws until the
 * tenant has resolved. Mount the page only once `useTenantContext().status` is
 * 'ready' so we exercise the real loaded path (not a transient throw).
 */
function IntegrationsGate({ children }: { children: ReactNode }) {
  const { status } = useTenantContext()
  if (status !== 'ready') return <div data-testid="tenant-gate">{status}</div>
  return <>{children}</>
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
  // Tenant identity is always needed (the page reads it for the heading copy).
  mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
})

describe('INTEGRATIONS-LIVE ★ — GET /v1/integrations renders real, honest rows', () => {
  it('renders the live rows with honest enablement status (enabled / pending / disabled)', async () => {
    const integrations: IntegrationStatus[] = [
      {
        id: 'notion',
        displayName: 'Notion CRM',
        category: 'crm',
        status: 'enabled',
        detail: 'Writes approved proposals to the workspace.',
      },
      { id: 'resend', displayName: 'Resend Email', category: 'email', status: 'pending' },
      { id: 'shopify', displayName: 'Shopify', category: 'commerce', status: 'disabled' },
    ]
    mockLivePath('GET', '/v1/integrations', { status: 200, body: { integrations } })

    renderWithProviders(
      <IntegrationsGate>
        <Integrations />
      </IntegrationsGate>,
    )

    // Each real row surfaced by displayName.
    await waitFor(() => expect(screen.getByText('Notion CRM')).toBeInTheDocument())
    expect(screen.getByText('Resend Email')).toBeInTheDocument()
    expect(screen.getByText('Shopify')).toBeInTheDocument()

    // Honest ops-asserted ENABLEMENT vocabulary — Enabled / Pending / Disabled.
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()

    // Status detail copy passes through when present.
    expect(
      screen.getByText('Writes approved proposals to the workspace.'),
    ).toBeInTheDocument()
  })

  it('NEVER renders the dishonest "Connected" / "Live" enablement vocabulary', async () => {
    const integrations: IntegrationStatus[] = [
      { id: 'notion', displayName: 'Notion CRM', category: 'crm', status: 'enabled' },
    ]
    mockLivePath('GET', '/v1/integrations', { status: 200, body: { integrations } })

    renderWithProviders(
      <IntegrationsGate>
        <Integrations />
      </IntegrationsGate>,
    )

    await waitFor(() => expect(screen.getByText('Notion CRM')).toBeInTheDocument())

    // The enabled connector reads "Enabled" — not "Connected" / "Live".
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.queryByText(/connected/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument()
  })

  it('an empty roster reads "none enabled" (graceful EmptyState, not an error)', async () => {
    mockLivePath('GET', '/v1/integrations', { status: 200, body: { integrations: [] } })

    renderWithProviders(
      <IntegrationsGate>
        <Integrations />
      </IntegrationsGate>,
    )

    await waitFor(() =>
      expect(screen.getByText('No integrations enabled yet')).toBeInTheDocument(),
    )
    // The empty-state body names the tenant and explains enablement is operator-driven.
    expect(screen.getByText(/enabled for Mi Pase yet/i)).toBeInTheDocument()
  })

  it('requests the live path with NO ?tenant= authority (the JWT is the only tenant authority)', async () => {
    mockLivePath('GET', '/v1/integrations', { status: 200, body: { integrations: [] } })

    renderWithProviders(
      <IntegrationsGate>
        <Integrations />
      </IntegrationsGate>,
    )

    await waitFor(() =>
      expect(screen.getByText('No integrations enabled yet')).toBeInTheDocument(),
    )

    const integrationReqs = capturedRequests.filter(
      (r) => r.method === 'GET' && r.path.split('?')[0] === '/v1/integrations',
    )
    // It actually hit the network (live path), not the mock registry.
    expect(integrationReqs.length).toBeGreaterThanOrEqual(1)
    for (const req of integrationReqs) {
      // No ?tenant= (or any query) authority is appended.
      expect(req.path).toBe('/v1/integrations')
      expect(req.path).not.toContain('?')
      expect(req.path).not.toContain('tenant=')
      // The Privy JWT is carried as the authority; no machine secret in the browser.
      expect(req.headers['authorization']).toBe('Bearer test-privy-jwt')
      expect(req.headers['x-service-key']).toBeUndefined()
    }
  })

  it('renders the honest card shape only — no risk / report / feed affordances', async () => {
    const integrations: IntegrationStatus[] = [
      {
        id: 'notion',
        displayName: 'Notion CRM',
        category: 'crm',
        status: 'enabled',
        detail: 'Writes approved proposals to the workspace.',
      },
    ]
    mockLivePath('GET', '/v1/integrations', { status: 200, body: { integrations } })

    const { container } = renderWithProviders(
      <IntegrationsGate>
        <Integrations />
      </IntegrationsGate>,
    )

    await waitFor(() => expect(screen.getByText('Notion CRM')).toBeInTheDocument())

    // The removed risk-tier / report-slot / read-only-feed / estimated vocabulary
    // is gone from the rendered card.
    expect(screen.queryByText(/risk/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/report/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/read[- ]?only/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/estimated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/not yet live/i)).not.toBeInTheDocument()
    // The honest IntegrationStatus shape carries only {id,displayName,category,status,detail?};
    // the card renders the category + status pill + optional detail, nothing more.
    expect(screen.getByText('crm')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="risk-badge"]')).toBeNull()
  })
})
