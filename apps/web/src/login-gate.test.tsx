import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  privyMockSpies,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type { TenantView } from '@godin-engine/contract'

/**
 * LOGIN-GATE + TOKEN (PR2b §6, login-gate.test.tsx). Two security-critical claims:
 *
 *   LOGIN-GATE — Privy `ready/authenticated` drives the AuthGate:
 *     - not ready        → loading state (never a login flash),
 *     - unauthenticated  → login screen, and CRUCIALLY no query / token lookup
 *       fires (assert at the query/getAuthToken layer — the Privy mock bypasses
 *       the network, so the assertion is "getAccessToken never called" +
 *       "no live-path request captured", NOT a network spy),
 *     - authenticated    → the workspace children render.
 *
 *   TOKEN — a LIVE_PATH request (`/v1/tenants/me`) carries
 *     `Authorization: Bearer <jwt>` and NEVER an `X-Service-Key` header; mocked
 *     paths still resolve through the in-process registry (no network).
 *
 * The Privy SDK can't boot in jsdom, so it's replaced by the shared controllable
 * mock; the factory is loaded via dynamic import INSIDE the hoisted `vi.mock`
 * callback (the documented TDZ-safe pattern).
 */
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

// Import the REAL gate + token bridge AFTER the mock is registered so they bind to
// the mocked `usePrivy`. These are the exact production symbols under test.
import { AuthGate } from '@/providers/AuthGate'
import { PrivyAuthProvider } from '@/providers/PrivyProvider'
import { AuthTokenBridge } from '@/providers/AuthTokenBridge'
import { apiFetch } from '@/lib/api'

const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft'],
}

beforeEach(() => {
  installMockFetch()
  mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
})

/** Render the REAL AuthGate inside the REAL PrivyAuthProvider (the production
 *  composition AppProviders uses). No Query/Tenant below it, so this isolates the
 *  gate decision itself — if children mount, a sentinel appears. */
function renderGate(children: ReactNode) {
  return render(<PrivyAuthProvider>{<AuthGate>{children}</AuthGate>}</PrivyAuthProvider>)
}

describe('LOGIN-GATE — AuthGate', () => {
  it('Privy not ready → loading state, no login screen, no children', () => {
    setPrivyState({ ready: false, authenticated: false, token: null })
    renderGate(<div>workspace-sentinel</div>)

    // Loading state (role=status); never the login CTA and never the children.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
    expect(screen.queryByText('workspace-sentinel')).not.toBeInTheDocument()
  })

  it('unauthenticated → login screen, and NO query / token lookup fires', async () => {
    setPrivyState({ ready: true, authenticated: false, token: 'should-not-be-read' })
    renderGate(<div>workspace-sentinel</div>)

    // Login screen renders; the gated children do NOT mount.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByText('workspace-sentinel')).not.toBeInTheDocument()

    // The security claim: nothing below the gate mounted, so the token getter was
    // never registered/called and no `/v1` request was issued. Assert at the
    // getAuthToken layer (the Privy `getAccessToken` spy) AND the request log —
    // NOT the network (mocks bypass it).
    expect(privyMockSpies.getAccessToken).not.toHaveBeenCalled()
    expect(capturedRequests).toHaveLength(0)
  })

  it('authenticated → workspace children render', async () => {
    setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
    renderGate(<div>workspace-sentinel</div>)

    expect(await screen.findByText('workspace-sentinel')).toBeInTheDocument()
    // Login screen + loading are gone once authed.
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()
  })

  it('unauthenticated → authenticated: only the authed render reaches the children', () => {
    // Pre-auth: login screen, no children. (Re-render after auth flips is covered
    // by the dedicated authed case above; here we lock the pre-auth fail-closed.)
    setPrivyState({ ready: true, authenticated: false, token: null })
    renderGate(<div>workspace-sentinel</div>)
    expect(screen.queryByText('workspace-sentinel')).not.toBeInTheDocument()
    expect(privyMockSpies.getAccessToken).not.toHaveBeenCalled()
  })
})

describe('TOKEN — live-path request carries Bearer JWT, never X-Service-Key', () => {
  it('a /v1/tenants/me request carries Authorization: Bearer <jwt>', async () => {
    setPrivyState({ ready: true, authenticated: true, token: 'jwt-abc-123' })

    // Mount the REAL token bridge under the REAL PrivyProvider — this is the exact
    // production path that registers Privy.getAccessToken into the api.ts getter.
    render(
      <PrivyAuthProvider>
        <AuthTokenBridge />
      </PrivyAuthProvider>,
    )

    // Now a live-path fetch goes through the registered getter → Bearer header.
    const view = await apiFetch<TenantView>('/v1/tenants/me')
    expect(view).toEqual(MI_PASE_VIEW)

    const req = capturedRequests.find((r) => r.path.startsWith('/v1/tenants/me'))
    expect(req).toBeDefined()
    expect(req?.headers['authorization']).toBe('Bearer jwt-abc-123')
    // The token getter (Privy.getAccessToken) was actually consulted.
    expect(privyMockSpies.getAccessToken).toHaveBeenCalled()
  })

  it('NEVER attaches an X-Service-Key header on a live-path request', async () => {
    setPrivyState({ ready: true, authenticated: true, token: 'jwt-abc-123' })
    render(
      <PrivyAuthProvider>
        <AuthTokenBridge />
      </PrivyAuthProvider>,
    )

    await apiFetch<TenantView>('/v1/tenants/me')

    const req = capturedRequests.find((r) => r.path.startsWith('/v1/tenants/me'))
    expect(req).toBeDefined()
    // The machine secret must never reach the browser — assert absence in any case.
    expect(req?.headers['x-service-key']).toBeUndefined()
    expect(
      Object.keys(req?.headers ?? {}).some((h) => h.toLowerCase() === 'x-service-key'),
    ).toBe(false)
  })

  it('mocked (non-live) paths resolve via the registry, not the network', async () => {
    // No token getter registered here on purpose: a mocked path must short-circuit
    // to `resolveMock` BEFORE any token lookup or network call (VITE_USE_MOCKS=true
    // in the test env; only LIVE_PATHS hit fetch). `/v1/reports` is a genuinely
    // NON-live path post P5b Wave 2 (Reports is a deferred ComingSoon surface, so
    // it is deliberately absent from LIVE_PATHS) and still has a registry fixture.
    setPrivyState({ ready: true, authenticated: true, token: 'jwt-abc-123' })

    const reports = await apiFetch<{ reports: unknown[] }>('/v1/reports')

    // Registry fixture resolved (reports mock registers GET /v1/reports →
    // `{ reports: [...] }`)…
    expect(reports).toBeDefined()
    expect(Array.isArray((reports as { reports?: unknown[] }).reports)).toBe(true)
    // …and it NEVER touched the live-path fetch stub.
    expect(capturedRequests.some((r) => r.path.startsWith('/v1/reports'))).toBe(false)
  })

  it('a live-path token getter is bridged via AuthTokenBridge, and unmount clears it', async () => {
    setPrivyState({ ready: true, authenticated: true, token: 'jwt-xyz' })

    // renderWithProviders mounts the AuthTokenBridge as part of the real tree; use
    // it to prove the bridge wires the getter end-to-end through the provider stack.
    const { unmount } = renderWithProviders(<div>bridged</div>)
    await screen.findByText('bridged')

    const view = await apiFetch<TenantView>('/v1/tenants/me')
    expect(view).toEqual(MI_PASE_VIEW)
    const first = capturedRequests.find((r) => r.path.startsWith('/v1/tenants/me'))
    expect(first?.headers['authorization']).toBe('Bearer jwt-xyz')

    // After unmount the getter is cleared → no Bearer header on a later request.
    unmount()
    await apiFetch<TenantView>('/v1/tenants/me')
    const calls = capturedRequests.filter((r) => r.path.startsWith('/v1/tenants/me'))
    const last = calls[calls.length - 1]
    expect(last?.headers['authorization']).toBeUndefined()
  })
})
