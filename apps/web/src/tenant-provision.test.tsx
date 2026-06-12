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

/**
 * TENANT-PROVISION ★ (tenant-invites Wave 2, plan §5/§6) — TenantProvider's
 * transparent auto-provision handshake, driven over the LIVE-PATH split (a stubbed
 * `global.fetch`, NOT the in-process mock registry). Both `/v1/tenants/me` and
 * `/v1/tenants/claim` are `LIVE_PATHS`, so under the jsdom project's pinned
 * `VITE_USE_MOCKS=true` they still hit `fetch` and exercise the real apiFetch path.
 *
 * Two end-to-end paths through the provider, observed via `useTenantContext`:
 *  (1) /me → 403 TENANT_UNKNOWN → POST /claim → 200 → refetched /me → 200 ⇒ the
 *      provider passes THROUGH a transient `provisioning` status and settles at
 *      `ready` (workspace); the claim fired EXACTLY ONCE.
 *  (2) the claim itself rejects (403/404) ⇒ the provider settles at the terminal
 *      `access-denied` (no white-screen / unhandled throw); the claim fired once.
 */

// Privy cannot boot in jsdom — swap in the shared controllable mock.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

const TENANT_UNKNOWN_ENVELOPE: ErrorEnvelope = {
  code: 'TENANT_UNKNOWN',
  message: 'No tenant resolves for this principal',
  retryable: false,
}

const NOT_FOUND_ENVELOPE: ErrorEnvelope = {
  code: 'SKILL_NOT_FOUND',
  message: 'claim endpoint not deployed',
  retryable: false,
}

const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft', 'pricing-apply-confident'],
}

/** Tiny probe: surfaces the live tenant status + resolved id for assertion. */
function StatusProbe() {
  const ctx = useTenantContext()
  return (
    <div>
      <div data-testid="status">{ctx.status}</div>
      <div data-testid="tenant-id">{ctx.tenant?.id ?? ''}</div>
    </div>
  )
}

/** Live POST /v1/tenants/claim requests captured by the fetch stub. */
function claimCalls() {
  return capturedRequests.filter(
    (r) => r.method === 'POST' && r.path.split('?')[0] === '/v1/tenants/claim',
  )
}

/** Live GET /v1/tenants/me requests captured by the fetch stub. */
function meCalls() {
  return capturedRequests.filter(
    (r) => r.method === 'GET' && r.path.split('?')[0] === '/v1/tenants/me',
  )
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'jwt-unprovisioned-did' })
})

describe('TENANT-PROVISION ★ — TENANT_UNKNOWN → claim once → refetch → ready', () => {
  it('passes through provisioning, claims EXACTLY ONCE, then resolves the workspace (ready)', async () => {
    // A gated claim lets us OBSERVE the in-flight provisioning status before the
    // claim resolves — otherwise the success path can settle to ready too fast to
    // catch the transient state.
    let resolveClaim: ((spec: { status: number; body: unknown }) => void) | undefined
    const claimGate = new Promise<{ status: number; body: unknown }>((r) => {
      resolveClaim = r
    })

    let meCall = 0
    mockLivePath('GET', '/v1/tenants/me', () => {
      meCall += 1
      // First /me is unprovisioned (403 TENANT_UNKNOWN). After the claim binds the
      // DID, the invalidate-driven refetch resolves the now-bound tenant (200).
      return meCall === 1
        ? { status: 403, body: TENANT_UNKNOWN_ENVELOPE }
        : { status: 200, body: MI_PASE_VIEW }
    })
    mockLivePath('POST', '/v1/tenants/claim', async () => {
      return claimGate
    })

    renderWithProviders(<StatusProbe />)

    // The transient provisioning ("setting up") state is shown while the single-shot
    // claim is in flight — never an access-denied flash, never a white screen.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('provisioning'))
    expect(screen.getByTestId('status')).not.toHaveTextContent('access-denied')

    // Release the claim with a 200 → invalidate + refetch /me → now-bound tenant.
    resolveClaim?.({ status: 200, body: MI_PASE_VIEW })

    // Settles at the workspace (ready) with the bound tenant.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))
    expect(screen.getByTestId('tenant-id')).toHaveTextContent('mi-pase')

    // The claim fired EXACTLY ONCE; /me was fetched twice (initial + post-claim refetch).
    expect(claimCalls()).toHaveLength(1)
    expect(meCalls()).toHaveLength(2)
  })

  it('the claim is a live POST carrying the Bearer token and no machine secret', async () => {
    let meCall = 0
    mockLivePath('GET', '/v1/tenants/me', () => {
      meCall += 1
      return meCall === 1
        ? { status: 403, body: TENANT_UNKNOWN_ENVELOPE }
        : { status: 200, body: MI_PASE_VIEW }
    })
    mockLivePath('POST', '/v1/tenants/claim', { status: 200, body: MI_PASE_VIEW })

    renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'))

    const claims = claimCalls()
    expect(claims).toHaveLength(1)
    // The claim hit the network as a LIVE path (it is in the captured fetch log).
    expect(claims[0]?.headers['authorization']).toBe('Bearer jwt-unprovisioned-did')
    // The browser never holds the machine service key.
    expect(claims[0]?.headers['x-service-key']).toBeUndefined()
  })
})

describe('TENANT-PROVISION ★ — claim failure degrades to access-denied (no white-screen)', () => {
  it('claim → 403 TENANT_UNKNOWN (no invite match) ⇒ access-denied, claim fired once', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })
    mockLivePath('POST', '/v1/tenants/claim', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })

    renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))
    // Terminal: no tenant resolved, and the claim was attempted exactly once.
    expect(screen.getByTestId('tenant-id')).toHaveTextContent('')
    expect(claimCalls()).toHaveLength(1)
  })

  it('claim → 404 (Wave-1 backend not yet deployed) ⇒ access-denied, claim fired once', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 403, body: TENANT_UNKNOWN_ENVELOPE })
    mockLivePath('POST', '/v1/tenants/claim', { status: 404, body: NOT_FOUND_ENVELOPE })

    renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))
    expect(claimCalls()).toHaveLength(1)

    // Settle: give any stray re-render a chance to (wrongly) re-fire the claim — the
    // single-flight ref must hold it at one even after the terminal state.
    await new Promise((r) => setTimeout(r, 50))
    expect(claimCalls()).toHaveLength(1)
  })
})
