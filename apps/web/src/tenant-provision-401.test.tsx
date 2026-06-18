import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  privyMockSpies,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import { useTenantContext } from '@/providers/TenantProvider'
import type { ErrorEnvelope, TenantView } from '@pokta-engine/contract'

/**
 * AUTO-PROVISION ★ — masked-401 / claim-no-loop CRITICAL regression
 * (tenant-invites Wave 2, plan §5/§6).
 *
 * This file is the hardened companion to auto-provision.test.tsx. It pins the two
 * invariants that, if broken, would either (a) hammer the brand-new
 * `POST /v1/tenants/claim` endpoint in a loop, or (b) auto-provision a tenant on a
 * SESSION-EXPIRY 401 that should instead drop the user to re-auth/logout:
 *
 *   (1) NO-LOOP: a PERSISTENT 403 `TENANT_UNKNOWN` on `GET /v1/tenants/me` fires
 *       `POST /v1/tenants/claim` AT MOST ONCE across MANY re-renders + forced
 *       refetches. The single-flight `useRef` in TenantProvider must hold even when
 *       the consumer drives extra renders and invalidations — the claim fetch count
 *       stays EXACTLY 1, never 2+, never a loop.
 *
 *   (2) MASKED-401: a `401 UNAUTHENTICATED` on `/v1/tenants/me` must NEVER call
 *       `/v1/tenants/claim`. `apiFetch` classifies the 401 and runs its single-shot
 *       re-auth → logout path; it surfaces as `UNAUTHENTICATED` (NOT
 *       `TENANT_UNKNOWN`), so the claim branch is never entered. We assert ZERO POSTs
 *       to `/claim` AND that the real re-auth/logout path fired (the Privy mock
 *       `logout` spy, wired through the real `AuthTokenBridge` in renderWithProviders).
 *
 * LIVE-PATH split: VITE_USE_MOCKS is pinned true, so only LIVE_PATHS hit `fetch`.
 * Both `/v1/tenants/me` and `/v1/tenants/claim` are LIVE_PATHS, so they resolve via
 * the `installMockFetch` stub (NOT the in-process mock registry) — that is the whole
 * reason these network assertions are observable on `capturedRequests`.
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

/** All POSTs that reached the live `/v1/tenants/claim` path (query stripped). */
function claimCalls() {
  return capturedRequests.filter(
    (r) => r.method === 'POST' && r.path.split('?')[0] === '/v1/tenants/claim',
  )
}

/** All GETs that reached the live `/v1/tenants/me` path (query stripped). */
function meCalls() {
  return capturedRequests.filter(
    (r) => r.method === 'GET' && r.path.split('?')[0] === '/v1/tenants/me',
  )
}

/**
 * Surfaces tenant status + exposes `refetch` so a test can deliberately drive extra
 * renders + tenant re-queries. The button lets the no-loop test hammer the provider
 * the way a real UI (retry click / focus refetch / re-render storm) would — proving
 * the single-flight claim guard survives churn, not just a quiet first paint.
 */
function StatusProbe() {
  const ctx = useTenantContext()
  return (
    <div>
      <div data-testid="status">{ctx.status}</div>
      <div data-testid="tenant-id">{ctx.tenant?.id ?? ''}</div>
      <button type="button" data-testid="refetch" onClick={() => ctx.refetch()}>
        refetch
      </button>
    </div>
  )
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'jwt-unprovisioned-did' })
})

describe('AUTO-PROVISION ★ — persistent TENANT_UNKNOWN claims AT MOST ONCE (no loop)', () => {
  it('a PERSISTENT 403 TENANT_UNKNOWN fires the claim exactly once across many re-renders/refetches', async () => {
    // BOTH /me and the claim persistently 403 TENANT_UNKNOWN. The single-flight ref
    // must ensure the claim fetch count is EXACTLY 1 — never a second claim, never a
    // loop — even though /me keeps resolving TENANT_UNKNOWN forever.
    mockLivePath('GET', '/v1/tenants/me', { status: 403, body: { error: TENANT_UNKNOWN_ENVELOPE } })
    mockLivePath('POST', '/v1/tenants/claim', { status: 403, body: { error: TENANT_UNKNOWN_ENVELOPE } })

    renderWithProviders(<StatusProbe />)

    // The one claim fires, fails, and lands terminal (access-denied).
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))
    expect(claimCalls()).toHaveLength(1)

    // Now HAMMER the provider: force several explicit tenant refetches (each re-runs
    // queryFn → another TENANT_UNKNOWN) and let microtasks/timers flush between them.
    // A broken single-flight guard would re-fire the claim on each TENANT_UNKNOWN.
    const refetchBtn = screen.getByTestId('refetch')
    for (let i = 0; i < 5; i += 1) {
      refetchBtn.click()
      // Each refetch re-resolves /me as TENANT_UNKNOWN; give the effect a tick to
      // (wrongly) try to re-fire the claim.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 10))
    }
    // Settle once more for good measure.
    await new Promise((r) => setTimeout(r, 50))

    // Status is still terminal access-denied, and — the hard invariant — the claim
    // was NEVER fired a second time. Exactly one POST /claim, ever.
    expect(screen.getByTestId('status')).toHaveTextContent('access-denied')
    expect(claimCalls()).toHaveLength(1)

    // Sanity: /me was hit repeatedly (initial + the forced refetches), so the loop of
    // TENANT_UNKNOWN responses really did keep coming — yet the claim still held at 1.
    expect(meCalls().length).toBeGreaterThanOrEqual(2)
  })

  it('the single claim carries the Bearer JWT and never the machine X-Service-Key', async () => {
    // The claim is a user-scoped first-login action: authenticated by the Privy JWT,
    // NEVER by a machine service key (which must never reach the browser).
    mockLivePath('GET', '/v1/tenants/me', { status: 403, body: { error: TENANT_UNKNOWN_ENVELOPE } })
    mockLivePath('POST', '/v1/tenants/claim', { status: 403, body: { error: TENANT_UNKNOWN_ENVELOPE } })

    renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('access-denied'))

    const claims = claimCalls()
    expect(claims).toHaveLength(1)
    expect(claims[0]?.headers['authorization']).toBe('Bearer jwt-unprovisioned-did')
    expect(claims[0]?.headers['x-service-key']).toBeUndefined()
  })
})

describe('AUTO-PROVISION ★ — masked-401: a 401 NEVER triggers a claim', () => {
  it('a persistent 401 UNAUTHENTICATED on /me makes ZERO POSTs to /claim and routes to re-auth/logout', async () => {
    // /me 401s persistently with a NON-renewable token. apiFetch must run its
    // single-shot re-auth → logout path and surface UNAUTHENTICATED (NOT
    // TENANT_UNKNOWN), so the claim branch is never entered. We register the claim
    // route so that a wrongful claim would be CAPTURED on capturedRequests (proving
    // it never fired) rather than throwing a no-route error.
    setPrivyState({ ready: true, authenticated: true, token: 'jwt-doomed' })
    mockLivePath('GET', '/v1/tenants/me', { status: 401, body: { error: UNAUTHENTICATED_ENVELOPE } })
    mockLivePath('POST', '/v1/tenants/claim', { status: 200, body: MI_PASE_VIEW })

    renderWithProviders(<StatusProbe />)

    // It settles on the generic error state — a 401 is NOT TENANT_UNKNOWN, so the
    // provider never shows provisioning/access-denied for it. Timeout covers the
    // documented apiFetch re-auth backoff window.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'), {
      timeout: 3000,
    })

    // ★ THE INVARIANT: a 401 NEVER auto-provisions. Zero POSTs to /claim, ever.
    expect(claimCalls()).toHaveLength(0)

    // And the masked-401 routed through the REAL re-auth/logout path (apiFetch ran its
    // single-shot refresh; the token never renews → logout via the AuthTokenBridge →
    // the Privy mock logout spy). This is what should happen INSTEAD of a claim.
    await waitFor(() => expect(privyMockSpies.logout).toHaveBeenCalled())
  })

  it('the 401 status NEVER lands on provisioning or access-denied (those are TENANT_UNKNOWN-only)', async () => {
    // Guards the masked-401 from the OTHER direction: even transiently, a 401 must not
    // surface as the unprovisioned UX (provisioning → access-denied). It is a generic
    // error the whole time.
    setPrivyState({ ready: true, authenticated: true, token: 'jwt-doomed' })
    mockLivePath('GET', '/v1/tenants/me', { status: 401, body: { error: UNAUTHENTICATED_ENVELOPE } })
    mockLivePath('POST', '/v1/tenants/claim', { status: 200, body: MI_PASE_VIEW })

    const { container } = renderWithProviders(<StatusProbe />)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'), {
      timeout: 3000,
    })

    // Settle, then confirm the status never became the unprovisioned UX and no claim
    // leaked out.
    await new Promise((r) => setTimeout(r, 50))
    const status = container.querySelector('[data-testid="status"]')?.textContent ?? ''
    expect(status).not.toContain('provisioning')
    expect(status).not.toContain('access-denied')
    expect(status).toContain('error')
    expect(claimCalls()).toHaveLength(0)
  })
})
