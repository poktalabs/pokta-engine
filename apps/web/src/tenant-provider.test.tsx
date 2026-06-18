import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import { useTenantContext } from '@/providers/TenantProvider'
import { AppShell } from '@/components/shell/AppShell'
import type { TenantView } from '@pokta-engine/contract'

/**
 * TENANT-FETCH + SPOOF ★ (§6).
 *
 * TenantProvider hydrates the ACTIVE tenant from `GET /v1/tenants/me` (a TenantView
 * served by the server, the single source of truth) — branding / currency / locale /
 * allowedWorkflows all come from the payload; the old hardcoded `TENANTS` record is
 * gone. SPOOF ★: a `/:tenant` URL segment that disagrees with the server tenant is
 * redirected by the router-level guard (AppShell) to the server tenant's URL, and a
 * hand-edited segment never surfaces another tenant's data because the only data
 * call is the server-scoped `/v1/tenants/me` (server scoping holds even pre-redirect:
 * the SPA never sends the URL tenant as an authority).
 */

// Replace the Privy SDK (cannot boot in jsdom) with the shared controllable mock.
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

// A DELIBERATELY DIFFERENT tenant view — proves the projected config tracks the
// server payload field-for-field rather than any hardcoded mi-pase record.
const VINO_VIEW: TenantView = {
  id: 'vino',
  name: 'Vino Design Build',
  status: 'active',
  currency: 'USD',
  locale: 'en',
  branding: { name: 'Vino Design Build', badge: 'Studio' },
  allowedWorkflows: ['call-intake', 'proposal-step'],
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
})

/** Reads the resolved tenant config + raw view and renders them for assertion. */
function TenantProbe() {
  const ctx = useTenantContext()
  if (ctx.status !== 'ready' || !ctx.tenant || !ctx.view) {
    return <div data-testid="tenant-status">{ctx.status}</div>
  }
  // Safe: only reached once status==='ready' (ctx.tenant resolved). useTenant reads
  // the same already-resolved context (no extra hook ordering risk vs above).
  const t = ctx.tenant
  return (
    <div>
      <div data-testid="tenant-status">{ctx.status}</div>
      <div data-testid="tenant-id">{t.id}</div>
      <div data-testid="tenant-name">{t.name}</div>
      <div data-testid="tenant-currency">{t.currency}</div>
      <div data-testid="tenant-locale">{t.locale}</div>
      <div data-testid="tenant-lockup-name">{t.lockup.name}</div>
      <div data-testid="tenant-lockup-badge">{t.lockup.badge ?? ''}</div>
      <div data-testid="tenant-workflows">{t.allowedWorkflows.join(',')}</div>
      <div data-testid="tenant-view-id">{ctx.view.id}</div>
    </div>
  )
}

describe('TENANT-FETCH — TenantProvider hydrates from GET /v1/tenants/me', () => {
  it('projects branding/currency/locale/allowedWorkflows from the server payload', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(<TenantProbe />)

    await waitFor(() => expect(screen.getByTestId('tenant-status')).toHaveTextContent('ready'))

    expect(screen.getByTestId('tenant-id')).toHaveTextContent('mi-pase')
    expect(screen.getByTestId('tenant-name')).toHaveTextContent('Mi Pase')
    expect(screen.getByTestId('tenant-currency')).toHaveTextContent('MXN')
    expect(screen.getByTestId('tenant-locale')).toHaveTextContent('es-MX')
    expect(screen.getByTestId('tenant-lockup-name')).toHaveTextContent('Mi Pase')
    expect(screen.getByTestId('tenant-lockup-badge')).toHaveTextContent('Shopify test store')
    expect(screen.getByTestId('tenant-workflows')).toHaveTextContent(
      'pricing-draft,pricing-apply-confident',
    )
  })

  it('tracks the server payload (vino) — no hardcoded mi-pase record bleeds through', async () => {
    // If a hardcoded TENANTS record were still in play, these vino values could not
    // surface. Server is the only source.
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: VINO_VIEW })
    renderWithProviders(<TenantProbe />)

    await waitFor(() => expect(screen.getByTestId('tenant-status')).toHaveTextContent('ready'))

    expect(screen.getByTestId('tenant-id')).toHaveTextContent('vino')
    expect(screen.getByTestId('tenant-name')).toHaveTextContent('Vino Design Build')
    expect(screen.getByTestId('tenant-currency')).toHaveTextContent('USD')
    expect(screen.getByTestId('tenant-locale')).toHaveTextContent('en')
    expect(screen.getByTestId('tenant-workflows')).toHaveTextContent('call-intake,proposal-step')
    expect(screen.getByTestId('tenant-view-id')).toHaveTextContent('vino')
  })

  it('issues the /v1/tenants/me request as a live path (not the mock registry)', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(<TenantProbe />)

    await waitFor(() => expect(screen.getByTestId('tenant-status')).toHaveTextContent('ready'))

    const meCalls = capturedRequests.filter(
      (r) => r.method === 'GET' && r.path.split('?')[0] === '/v1/tenants/me',
    )
    expect(meCalls.length).toBeGreaterThanOrEqual(1)
  })
})

/** Renders the current pathname so a redirect is observable in the DOM. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}

/**
 * Mount AppShell under `/:tenant` inside a MemoryRouter, starting at `initialPath`.
 * AppShell is the router-level tenant guard (the redirect-on-mismatch lives there,
 * since TenantProvider sits above the router and cannot navigate).
 *
 * AppShell preserves the deep-link sub-path on redirect by reading
 * `window.location.pathname` (production runs under BrowserRouter, where the
 * browser URL IS the route). MemoryRouter does NOT touch `window.location`, so we
 * align jsdom's URL with the spoofed entry to exercise that production-faithful
 * sub-path preservation. (setup.ts has no jsdom-URL reset; each call sets it fresh.)
 */
function routerHarness(initialPath: string): ReactElement {
  window.history.replaceState(null, '', initialPath)
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path="/:tenant" element={<AppShell />}>
          <Route path="approvals" element={<div data-testid="page">approvals</div>} />
          <Route path="runs/:id" element={<div data-testid="page">run</div>} />
          <Route index element={<div data-testid="page">index</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('SPOOF ★ — router guard redirects a /:tenant segment that disagrees with the server', () => {
  it('redirects /vino/approvals → /mi-pase/approvals when the server tenant is mi-pase', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(routerHarness('/vino/approvals'))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/mi-pase/approvals'),
    )
  })

  it('preserves the deep-link sub-path on redirect (/vino/runs/abc → /mi-pase/runs/abc)', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(routerHarness('/vino/runs/abc'))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/mi-pase/runs/abc'),
    )
  })

  it('does NOT redirect when the URL segment already matches the server tenant', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(routerHarness('/mi-pase/approvals'))

    await waitFor(() => expect(screen.getByTestId('page')).toBeInTheDocument())
    expect(screen.getByTestId('location')).toHaveTextContent('/mi-pase/approvals')
  })

  it('a forged segment never surfaces another tenant\'s data: only the server-scoped /v1/tenants/me is fetched, carrying the Bearer token and NO X-Service-Key', async () => {
    // Server tenant is mi-pase; the URL claims vino. The guard will redirect, but
    // the security guarantee is that data is server-scoped: the SPA's only data
    // call is /v1/tenants/me, which carries the Privy JWT (not the URL tenant) as
    // the authority. The forged segment is never sent as a ?tenant= authority on a
    // live path.
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(routerHarness('/vino/approvals'))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/mi-pase/approvals'),
    )

    // Every live request hit /v1/tenants/me — no other live (network) call leaked.
    expect(capturedRequests.length).toBeGreaterThanOrEqual(1)
    for (const req of capturedRequests) {
      expect(req.path.split('?')[0]).toBe('/v1/tenants/me')
      // The forged URL tenant 'vino' is never sent as a query authority.
      expect(req.path).not.toContain('vino')
      // JWT carried; machine secret never reaches the browser.
      expect(req.headers['authorization']).toBe('Bearer test-privy-jwt')
      expect(req.headers['x-service-key']).toBeUndefined()
    }
  })

  it('the resolved tenant comes from the server even while the URL still says vino (pre-redirect scoping)', async () => {
    // The server payload (mi-pase) is what TenantProvider exposes regardless of the
    // /vino URL — the URL segment is display/deep-link only.
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(routerHarness('/vino/approvals'))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/mi-pase/approvals'),
    )
    // After redirect the matched page renders under the SERVER tenant, never vino's.
    expect(screen.getByTestId('location')).not.toHaveTextContent('/vino')
  })
})
