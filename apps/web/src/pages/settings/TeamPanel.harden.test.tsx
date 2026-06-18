import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type { InviteView, TenantView } from '@pokta-engine/contract'
import { useTenantContext } from '@/providers/TenantProvider'
import { TeamPanel } from '@/pages/settings/TeamPanel'

/**
 * TeamPanel — HARDENING regressions (admin-roles Wave B, adversarial panel).
 *
 * These lock the gaps the panel review found, all over the LIVE-PATH split (stubbed
 * `global.fetch`, not the in-process mock registry). The server is the authority and
 * the panel is COSMETIC, but it must (a) NEVER white-screen on a malformed-but-200
 * body, (b) NEVER swallow a non-ApiError (network) write failure silently, (c) surface
 * a failed superadmin tenant-list rather than presenting an empty/self-only picker as
 * truth, and (d) announce the disabled-Revoke reason the way the disabled-Add reason is.
 */

vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

function viewFor(over: Partial<TenantView>): TenantView {
  return {
    id: 'mi-pase',
    name: 'Mi Pase',
    status: 'active',
    currency: 'MXN',
    locale: 'es-MX',
    branding: { name: 'Mi Pase', badge: 'Shopify test store' },
    allowedWorkflows: ['pricing-draft'],
    ...over,
  }
}

function invite(over: Partial<InviteView>): InviteView {
  return {
    email: 'teammate@example.com',
    status: 'claimed',
    role: 'member',
    claimedByDid: 'did:privy:abc',
    claimedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

function Gate() {
  const { status } = useTenantContext()
  if (status !== 'ready') return <div data-testid="gate">{status}</div>
  return <TeamPanel />
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'jwt', email: 'me@mipase.com' })
})

describe('TeamPanel hardening — a malformed 200 body degrades to ErrorState (no white-screen)', () => {
  it('NON-ARRAY invites: the panel shows its ErrorState instead of throwing in render', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
    // A 200 with `invites` as an object, not an array — `invites.filter(...)` would
    // throw in render. The schema parse in useTeam must catch it → team.isError.
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: { invites: {} },
    })

    renderWithProviders(<Gate />)

    await waitFor(() =>
      expect(screen.getByText(/could not load your team/i)).toBeInTheDocument(),
    )
    // The heading is still mounted — the panel degraded locally, not a route crash.
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
  })

  it('NULL email row: the malformed row never reaches render (ErrorState, not a crash)', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
    // A row whose email is null — `invite.email.toLowerCase()` would throw. The schema
    // (email: string) rejects it, so useTeam surfaces an error instead of rendering it.
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: { invites: [{ email: null, status: 'pending', role: 'member', claimedByDid: null, claimedAt: null }] },
    })

    renderWithProviders(<Gate />)

    await waitFor(() =>
      expect(screen.getByText(/could not load your team/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
  })
})

describe('TeamPanel hardening — a non-ApiError Add failure surfaces (not swallowed)', () => {
  it('a network-class POST failure shows a generic inline alert, never silence', async () => {
    const user = userEvent.setup()
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', { status: 200, body: { invites: [] } })
    // The POST responder throws a TypeError (network class) — apiFetch retries then
    // rethrows the raw error (NOT an ApiError). The inline alert must still render.
    mockLivePath('POST', '/v1/tenants/mi-pase/invites', () => {
      throw new TypeError('network down')
    })

    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText(/it is just you so far/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/invite teammate by email/i), 'new@x.com')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(
      () => expect(screen.getByRole('alert')).toHaveTextContent(/check your connection/i),
      { timeout: 5000 },
    )
  }, 10000)
})

describe('TeamPanel hardening — superadmin tenant-list failure is surfaced', () => {
  it('a failed GET /v1/superadmin/tenants shows a "could not load tenants" note', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: true }),
    })
    // The cross-tenant list 403s (server disagrees on isSuperadmin) — the picker must
    // NOT present an empty/self-only list as the authoritative set silently.
    mockLivePath('GET', '/v1/superadmin/tenants', {
      status: 403,
      body: { error: { code: 'APPROVAL_DENIED', message: 'no', retryable: false } },
    })
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: { invites: [invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' })] },
    })

    renderWithProviders(<Gate />)

    await waitFor(() =>
      expect(screen.getByText(/could not load tenants/i)).toBeInTheDocument(),
    )
    // The team below still resolves from the caller's own tenant.
    expect(screen.getByText('me@mipase.com')).toBeInTheDocument()
  })
})

describe('TeamPanel hardening — the disabled-Revoke reason is announced (a11y)', () => {
  it('last-admin Revoke is a disabled button wired to a VISIBLE aria-describedby reason', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: true }),
    })
    mockLivePath('GET', '/v1/superadmin/tenants', {
      status: 200,
      body: { tenants: [{ id: 'mi-pase', name: 'Mi Pase', status: 'active' }] },
    })
    // The caller (me@mipase) plus a single OTHER claimed admin → that other admin is
    // the last admin among visible claimed rows, so its Revoke is pre-disabled.
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [
          invite({ email: 'me@mipase.com', role: 'member', status: 'claimed' }),
          invite({ email: 'lastadmin@x.com', role: 'admin', status: 'claimed' }),
        ],
      },
    })

    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('lastadmin@x.com')).toBeInTheDocument())

    // The disabled Revoke is a real <button> (focusable, reads as disabled) — not a
    // title-only static span.
    const revoke = screen.getByRole('button', { name: /^revoke$/i })
    expect(revoke).toBeDisabled()

    // It points at a VISIBLE reason node via aria-describedby (mirrors the Add reason).
    const reasonId = revoke.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    const reasonNode = document.getElementById(reasonId!)
    expect(reasonNode).not.toBeNull()
    expect(reasonNode!.textContent).toMatch(/last admin/i)
  })
})
