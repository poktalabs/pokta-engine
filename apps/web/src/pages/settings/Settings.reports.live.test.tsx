import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type { TenantView } from '@godin-engine/contract'
import { useTenantContext } from '@/providers/TenantProvider'
import Settings from '@/pages/settings/index'
import ReportsPage from '@/pages/reports/ReportsPage'
import ReportDetailPage from '@/pages/reports/ReportDetailPage'

/**
 * P5b SETTINGS + REPORTS — honest, live-path surfaces (no production mocks).
 *
 * Two deferral guarantees, asserted through the LIVE-PATH split (we stub
 * `global.fetch` via `installMockFetch`, NOT the in-process mock registry):
 *
 *   - SETTINGS reads its tenant PROFILE from the already-live TenantProvider
 *     (`GET /v1/tenants/me` → TenantView): name / currency / locale / branding all
 *     come from the server payload. The team-roster panel is an honest deferred
 *     ComingSoon shell — NO fabricated rows, and crucially NO DIDs rendered as
 *     emails. Settings imports no `@/mocks` value.
 *   - REPORTS is a no-network ComingSoon on both routes (index + detail): the
 *     routes stay mounted (nav/roadmap visibility) but the page makes ZERO
 *     `/v1/reports…` calls and imports no mock fixture.
 *
 * Because the jsdom web project pins `VITE_USE_MOCKS=true`, only paths the spine
 * added to `LIVE_PATHS` reach `fetch`. `/v1/tenants/me` is live (TenantProvider),
 * so Settings' profile fetch hits the stub; Reports has NO live path at all, so a
 * stray `/v1/reports` call would surface here as a captured request (it must not).
 */

// Replace the Privy SDK (cannot boot in jsdom) with the shared controllable mock,
// exactly as the reauth / tenant-provider live-path tests do.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

/**
 * A concrete server tenant view. DELIBERATELY non-default values (USD/en, a custom
 * badge) so the assertions prove the panel projects the SERVER payload field-for-
 * field rather than any hardcoded record.
 */
const VINO_VIEW: TenantView = {
  id: 'vino',
  name: 'Vino Design Build',
  status: 'active',
  currency: 'USD',
  locale: 'en',
  branding: { name: 'Vino Design Build', badge: 'Studio' },
  allowedWorkflows: ['call-intake', 'proposal-step'],
}

/** Reports/Settings panels render react-router <Link>s — give them a router. */
function withRouter(children: ReactNode) {
  return <MemoryRouter initialEntries={['/vino/settings']}>{children}</MemoryRouter>
}

/**
 * Gate Settings on `status==='ready'`, mirroring the production AppShell — Settings
 * calls `useTenant()` (which throws until the tenant resolves), so in production it
 * is only mounted after the router gate confirms ready. The harness reproduces that
 * precondition rather than mounting Settings mid-load. We still render Settings
 * through the REAL provider tree (its profile reads the live TenantView).
 */
function SettingsGate() {
  const { status } = useTenantContext()
  if (status !== 'ready') return <div data-testid="gate">{status}</div>
  return <Settings />
}

/** Reports-path predicate: any /v1/reports… request (query/id variants included). */
function isReportsCall(path: string): boolean {
  return path.split('?')[0]?.startsWith('/v1/reports') ?? false
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
})

describe('SETTINGS — profile renders from the live TenantView; roster is an honest deferred shell', () => {
  it('projects name / currency / locale / branding badge from GET /v1/tenants/me', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: VINO_VIEW })
    renderWithProviders(<SettingsGate />, { wrapInner: withRouter })

    // Profile hydrates only once the live tenant query resolves.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Tenant profile' })).toBeInTheDocument(),
    )

    // Every field is the SERVER payload, not a hardcoded mi-pase record.
    expect(screen.getByText('Vino Design Build')).toBeInTheDocument()
    expect(screen.getByText('USD')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument() // locale 'en' → label
    expect(screen.getByText('vino')).toBeInTheDocument() // tenant id field
    expect(screen.getByText('Studio')).toBeInTheDocument() // branding badge

    // The profile fetch went over the LIVE path (the stubbed fetch), carrying the
    // Privy bearer — proving it is server-sourced, not mock-registry-served.
    const meCalls = capturedRequests.filter(
      (r) => r.method === 'GET' && r.path.split('?')[0] === '/v1/tenants/me',
    )
    expect(meCalls.length).toBeGreaterThanOrEqual(1)
    expect(meCalls[0]?.headers.authorization).toBe('Bearer test-privy-jwt')
  })

  it('renders the role-adaptive Team panel as a MEMBER (no role/isSuperadmin on the view) — one honest line, NO management UI, NO DIDs-as-emails', async () => {
    // VINO_VIEW carries no `role`/`isSuperadmin` → the panel resolves to the MEMBER
    // variant (role=null, isSuperadmin=false), which shows one honest line and NO
    // management surface (no add input, no role toggle, no revoke).
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: VINO_VIEW })
    renderWithProviders(<SettingsGate />, { wrapInner: withRouter })

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument(),
    )

    // The honest member line names the tenant and points to an admin.
    expect(
      screen.getByText(/contact an admin to manage members/i),
    ).toBeInTheDocument()
    // No management affordances leak into the member view.
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(/invite teammate by email/i),
    ).not.toBeInTheDocument()

    // …and nothing that looks like a fabricated member row leaks through. The
    // engine only knows the human as an opaque Privy DID (did:privy:…); it must
    // never be rendered, least of all dressed up as an email address.
    expect(document.body.textContent ?? '').not.toMatch(/did:privy:/i)
    expect(document.body.textContent ?? '').not.toMatch(/@/) // no email-shaped rows
  })
})

describe('REPORTS — no-network ComingSoon on both routes (routes stay mounted)', () => {
  it('renders the index ComingSoon and makes NO /v1/reports network call', async () => {
    // Register only the tenant live path (TenantProvider still mounts under the
    // shared renderer). Reports itself has NO live path, so any /v1/reports fetch
    // would surface as a captured request.
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: VINO_VIEW })
    renderWithProviders(<ReportsPage />, { wrapInner: withRouter })

    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument()
    expect(screen.getByText('No reports yet')).toBeInTheDocument()

    // Give any (forbidden) async fetch a tick to fire, then assert none did.
    await waitFor(() => {
      expect(capturedRequests.some((r) => isReportsCall(r.path))).toBe(false)
    })
    expect(capturedRequests.filter((r) => isReportsCall(r.path))).toHaveLength(0)
  })

  it('renders the detail ComingSoon and makes NO /v1/reports network call', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: VINO_VIEW })
    renderWithProviders(<ReportDetailPage />, { wrapInner: withRouter })

    // Both detail-route deferred affordances render (the back link + the panel).
    expect(screen.getByRole('link', { name: 'All reports' })).toBeInTheDocument()
    expect(screen.getByText('No reports yet')).toBeInTheDocument()

    await waitFor(() => {
      expect(capturedRequests.some((r) => isReportsCall(r.path))).toBe(false)
    })
    expect(capturedRequests.filter((r) => isReportsCall(r.path))).toHaveLength(0)
  })
})
