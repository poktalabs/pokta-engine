import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type { ErrorEnvelope, TenantView } from '@godin-engine/contract'
import { AppShell } from '@/components/shell/AppShell'

/**
 * ISOLATION ★ (PR2b W4, plan §3.4 / §6 ISOLATION) — fail closed on an unknown
 * principal. A Privy DID in NO tenant's `members[]` resolves to `403
 * TENANT_UNKNOWN` from `GET /v1/tenants/me`; the SPA must render the dedicated
 * ACCESS-DENIED screen (intercepted at the tenant query/gate), and must NEVER fall
 * back to a default or any other tenant's workspace/data.
 *
 * This is a security regression: a hole here means an un-provisioned account could
 * see another tenant's surface. The assertions therefore prove BOTH halves —
 * (1) access-denied IS shown, and (2) no tenant workspace chrome / tenant id ever
 * surfaces.
 */

// Privy cannot boot in jsdom — swap in the shared controllable mock.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

/** The 403 envelope the backend emits when the DID is in no `members[]`. */
const TENANT_UNKNOWN_ENVELOPE: ErrorEnvelope = {
  code: 'TENANT_UNKNOWN',
  message: 'No tenant resolves for this principal',
  retryable: false,
}

/** A real tenant view — used by the negative-control case to prove the gate, not luck, blocks. */
const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft'],
}

/** Mount AppShell (the router-level tenant gate) under a `/:tenant` route. */
function renderShellAt(path: string) {
  return renderWithProviders(<div />, {
    wrapInner: () => (
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/:tenant" element={<AppShell />}>
            <Route index element={<div>workspace outlet</div>} />
            <Route path="approvals" element={<div>workspace outlet</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  })
}

beforeEach(() => {
  installMockFetch()
  // Authenticated principal — the DID just isn't provisioned. Auth is NOT the
  // failure here; tenant resolution is.
  setPrivyState({ ready: true, authenticated: true, token: 'jwt-unprovisioned-did' })
})

describe('ISOLATION ★ — Privy DID in no members[] → access-denied', () => {
  it('renders the dedicated access-denied screen on 403 TENANT_UNKNOWN', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 403,
      body: TENANT_UNKNOWN_ENVELOPE,
    })

    renderShellAt('/mi-pase/approvals')

    // The access-denied screen (AccessDenied.tsx) — its copy is the load-bearing,
    // user-visible signal of the fail-closed terminal state.
    expect(await screen.findByText('No workspace access')).toBeInTheDocument()
    expect(
      screen.getByText(/not provisioned for any workspace/i),
    ).toBeInTheDocument()
    // The only action is sign out — never a "go to workspace" escape hatch.
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('NEVER falls back to a default/other tenant workspace', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 403,
      body: TENANT_UNKNOWN_ENVELOPE,
    })

    // Deep-link straight at a real tenant's URL — a forged/guessed segment must NOT
    // surface that tenant. The server (403) is authoritative, not the URL.
    renderShellAt('/mi-pase/approvals')

    await screen.findByText('No workspace access')

    // No workspace chrome rendered: the protected outlet content must be absent.
    expect(screen.queryByText('workspace outlet')).not.toBeInTheDocument()
    // And no tenant id leaks into a rendered data-tenant workspace container. The
    // AppShell workspace wrapper sets data-tenant={tenant.id}; on access-denied that
    // wrapper is never rendered, so no element carries a real tenant id.
    expect(document.querySelector('[data-tenant="mi-pase"]')).toBeNull()
    expect(document.querySelector('[data-tenant="vino"]')).toBeNull()
  })

  it('intercepts TENANT_UNKNOWN at the tenant gate, not the generic error/retry path', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 403,
      body: TENANT_UNKNOWN_ENVELOPE,
    })

    renderShellAt('/mi-pase/approvals')

    await screen.findByText('No workspace access')

    // Distinguish from the generic retryable error state (ErrorState renders a
    // "Could not load your workspace" title + a retry affordance). access-denied is
    // a TERMINAL fail-closed screen — there must be no retry, and no generic error.
    expect(screen.queryByText(/could not load your workspace/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument()
  })

  it('issues exactly one /tenants/me request carrying Bearer (no retry storm, no X-Service-Key)', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 403,
      body: TENANT_UNKNOWN_ENVELOPE,
    })

    renderShellAt('/mi-pase/approvals')
    await screen.findByText('No workspace access')

    const meCalls = capturedRequests.filter((r) => r.path.startsWith('/v1/tenants/me'))
    // TENANT_UNKNOWN is terminal — not retryable. One fetch, full stop.
    expect(meCalls).toHaveLength(1)
    // The browser is JWT-only: a Bearer token, never the machine secret.
    expect(meCalls[0]?.headers['authorization']).toBe('Bearer jwt-unprovisioned-did')
    expect(meCalls[0]?.headers['x-service-key']).toBeUndefined()
  })

  it('negative control: a provisioned DID (200) renders the workspace, proving the gate (not luck) blocks', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })

    renderShellAt('/mi-pase/approvals')

    // The provisioned principal reaches the protected outlet — same harness, only
    // the server verdict differs. This proves the access-denied path is driven by
    // the 403, not by a broken render that fails everyone.
    expect(await screen.findByText('workspace outlet')).toBeInTheDocument()
    expect(screen.queryByText('No workspace access')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector('[data-tenant="mi-pase"]')).not.toBeNull()
    })
  })
})
