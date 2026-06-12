import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import { useTenantContext } from '@/providers/TenantProvider'
import type { ErrorEnvelope, TenantView } from '@godin-engine/contract'
import { brandForPath, LoginScreen } from '@/components/auth/LoginScreen'
import { render } from '@testing-library/react'

/**
 * AUTO-PROVISION ★ (tenant-invites Wave 2, plan §5/§6) — transparent first-login
 * provisioning. When `GET /v1/tenants/me` returns `403 TENANT_UNKNOWN` (the DID is
 * in no tenant), TenantProvider fires `POST /v1/tenants/claim` EXACTLY ONCE; on
 * success it refetches `/me` and resolves to `ready`; on failure (incl. a 404 when
 * the Wave-1 backend is not yet deployed) it lands on the terminal `access-denied`.
 *
 * ★ CRITICAL no-loop / masked-401 regressions:
 *  - a PERSISTENT TENANT_UNKNOWN fires the claim AT MOST ONCE (single-flight ref);
 *  - a `401 UNAUTHENTICATED` NEVER triggers a claim (apiFetch routes it to
 *    re-auth/logout; it never surfaces here as TENANT_UNKNOWN).
 */

// Privy cannot boot in jsdom — swap in the shared controllable mock.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

const TENANT_UNKNOWN_ENVELOPE: ErrorEnvelope = {
  code: 'TENANT_UNKNOWN',
  message: 'No tenant resolves for this principal',
  retryable: false,
}

const UNAUTHENTICATED_ENVELOPE: ErrorEnvelope = {
  code: 'UNAUTHENTICATED',
  message: 'Authentication required',
  retryable: false,
}

const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft'],
}

/** Surfaces the tenant status + resolved id so transitions are observable. */
function StatusProbe() {
  const ctx = useTenantContext()
  return (
    <div>
      <div data-testid="status">{ctx.status}</div>
      <div data-testid="tenant-id">{ctx.tenant?.id ?? ''}</div>
    </div>
  )
}

function claimCalls() {
  return capturedRequests.filter(
    (r) => r.method === 'POST' && r.path.split('?')[0] === '/v1/tenants/claim',
  )
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'jwt-unprovisioned-did' })
})

describe('AUTO-PROVISION ★ — TENANT_UNKNOWN → claim once → refetch → workspace', () => {
  it('fires POST /v1/tenants/claim once on TENANT_UNKNOWN, then refetches /me and resolves ready', async () => {
    let meCall = 0
    mockLivePath('GET', '/v1/tenants/me', () => {
      meCall += 1
      // First /me: unprovisioned (403). After the claim binds the DID, the
      // invalidate-driven refetch resolves the now-bound tenant (200).
      return meCall === 1
        ? { status: 403, body: TENANT_UNKNOWN_ENVELOPE }
        : { status: 200, body: MI_PASE_VIEW }
    })
    mockLivePath('POST', '/v1/tenants/claim', { status: 200, body: MI_PASE_VIEW })

    renderWithProviders(<StatusProbe />)

    // It resolves to the workspace (ready) with the bound tenant.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('tenant-id')).toHaveTextContent('mi-pase')

    // The claim fired EXACTLY ONCE; /me was fetched twice (initial + post-claim refetch).
    expect(claimCalls()).toHaveLength(1)
    const meCalls = capturedRequests.filter(
      (r) => r.method === 'GET' && r.path.split('?')[0] === '/v1/tenants/me',
    )
    expect(meCalls).toHaveLength(2)
  })

  it('shows the transient provisioning state while the claim is in flight', async () => {
    let resolveClaim: (() => void) | undefined
    const claimGate = new Promise<void>((r) => {
      resolveClaim = r
    })
    mockLivePath('GET', '/v1/tenants/me', () => ({
      status: 403,
      body: TENANT_UNKNOWN_ENVELOPE,
    }))
    mockLivePath('POST', '/v1/tenants/claim', async () => {
      await claimGate
      return { status: 403, body: TENANT_UNKNOWN_ENVELOPE }
    })

    renderWithProviders(<StatusProbe />)

    // While the claim is in flight, the provisioning ("setting up") state shows —
    // never an access-denied flash.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('provisioning'))

    // Release the claim → it fails → terminal access-denied.
    resolveClaim?.()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))
  })
})

describe('AUTO-PROVISION ★ — graceful degradation (claim fails / 404)', () => {
  it('claim 404 (Wave-1 not deployed) → access-denied, never white-screen / unhandled throw', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })
    mockLivePath('POST', '/v1/tenants/claim', {
      status: 404,
      body: { code: 'SKILL_NOT_FOUND', message: 'not found', retryable: false },
    })

    renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))
    // The claim was attempted exactly once even though it 404'd.
    expect(claimCalls()).toHaveLength(1)
  })

  it('claim TENANT_UNKNOWN (no invite match) → access-denied', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })
    mockLivePath('POST', '/v1/tenants/claim', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })

    renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))
    expect(claimCalls()).toHaveLength(1)
  })
})

describe('AUTO-PROVISION ★ — CRITICAL no-loop / masked-401', () => {
  it('a PERSISTENT TENANT_UNKNOWN fires the claim AT MOST ONCE (no loop)', async () => {
    // Both /me AND the claim persistently return TENANT_UNKNOWN. The single-flight
    // ref must prevent a second claim from ever firing — never a claim loop.
    mockLivePath('GET', '/v1/tenants/me', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })
    mockLivePath('POST', '/v1/tenants/claim', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })

    renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))

    // Settle: give any stray re-render a chance to (wrongly) re-fire the claim.
    await new Promise((r) => setTimeout(r, 50))
    expect(claimCalls()).toHaveLength(1)
  })

  it('a 401 UNAUTHENTICATED NEVER triggers a claim (routed to re-auth, not claim)', async () => {
    // /me 401s persistently. apiFetch handles the 401 (single-shot re-auth → logout);
    // it surfaces as UNAUTHENTICATED, NOT TENANT_UNKNOWN, so the claim must never fire.
    setPrivyState({ ready: true, authenticated: true, token: 'jwt-doomed' })
    mockLivePath('GET', '/v1/tenants/me', { status: 401, body: UNAUTHENTICATED_ENVELOPE })
    // Intentionally register the claim so a wrongful claim would be CAPTURED (not throw).
    mockLivePath('POST', '/v1/tenants/claim', { status: 200, body: MI_PASE_VIEW })

    renderWithProviders(<StatusProbe />)

    // Status settles to the generic error (UNAUTHENTICATED is not TENANT_UNKNOWN).
    await waitFor(
      () => expect(screen.getByTestId('status')).toHaveTextContent('error'),
      { timeout: 3000 },
    )
    // The claim was NEVER fired — the whole masked-401 invariant.
    expect(claimCalls()).toHaveLength(0)
  })
})

describe('BRANDED LOGIN — /mi-pase pre-auth (UX only)', () => {
  it('brandForPath: /mi-pase → Mi Pase copy; other paths → generic Godinez copy', () => {
    expect(brandForPath('/mi-pase')).toEqual({
      heading: 'Mi Pase',
      subcopy: 'Sign in to your Mi Pase workspace.',
    })
    expect(brandForPath('/mi-pase/approvals').heading).toBe('Mi Pase')
    expect(brandForPath('/').heading).toBe('Godinez Workspace')
    expect(brandForPath('/vino').heading).toBe('Godinez Workspace')
    // Not a prefix false-positive: '/mi-pase-other' is NOT the mi-pase brand.
    expect(brandForPath('/mi-pase-other').heading).toBe('Godinez Workspace')
  })

  it('renders Mi-Pase-branded login when window.location.pathname starts with /mi-pase', () => {
    window.history.replaceState(null, '', '/mi-pase')
    render(<LoginScreen />)
    expect(screen.getByRole('heading', { name: 'Mi Pase' })).toBeInTheDocument()
    expect(screen.getByText(/sign in to your mi pase workspace/i)).toBeInTheDocument()
    // SAME generic CTA — no claim input, no tenant hint surfaced.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('renders the generic Godinez login on a non-/mi-pase path', () => {
    window.history.replaceState(null, '', '/')
    render(<LoginScreen />)
    expect(screen.getByRole('heading', { name: 'Godinez Workspace' })).toBeInTheDocument()
  })
})
