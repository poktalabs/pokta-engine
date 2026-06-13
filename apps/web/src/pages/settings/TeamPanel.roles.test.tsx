import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type { InviteView, TenantView } from '@godin-engine/contract'
import { useTenantContext } from '@/providers/TenantProvider'
import { TeamPanel } from '@/pages/settings/TeamPanel'

/**
 * TeamPanel — ROLE-ADAPTIVE RENDERING (admin-roles Wave B, §5).
 *
 * The panel is COSMETIC over the Wave A role endpoints — every action is
 * re-checked server-side — so its only job in the SPA is to be HONEST about what
 * the caller can do. This file pins that honesty: the SAME panel, driven purely by
 * the `role` / `isSuperadmin` fields on the `GET /v1/tenants/me` payload, resolves
 * to three visibly different surfaces.
 *
 *   (1) MEMBER       (role=member, isSuperadmin=false) → one honest line, and NO
 *                     management UI whatsoever (no add input, no revoke). A member
 *                     has no tenant to manage, so it NEVER even fetches the roster.
 *   (2) TENANT-ADMIN (role=admin,  isSuperadmin=false) → the team list with role
 *                     pills + an add input, but NO admin-granting role toggle and
 *                     NO tenant picker.
 *   (3) SUPERADMIN   (role=admin,  isSuperadmin=true)  → all of the admin surface
 *                     PLUS the tenant picker and the Member|Admin role toggle.
 *
 * Drives the LIVE-PATH split (api.ts): `/v1/tenants/me`, the team-invites endpoints,
 * and `/v1/superadmin/tenants` are in `LIVE_PATHS`/`LIVE_PATH_PATTERNS`, so they hit
 * the stubbed `global.fetch` (installMockFetch), NOT the in-process mock registry —
 * even under the jsdom `VITE_USE_MOCKS=true` pin. Error/success bodies use the REAL
 * wrapped shapes (success = bare view; the team list = `{ invites: [...] }`).
 */

// Privy cannot boot in jsdom — swap in the shared controllable mock.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

/** A concrete server tenant view; `over` injects the additive role/isSuperadmin. */
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

/** Gate the panel on a resolved tenant, exactly like the production AppShell. */
function Gate() {
  const { status } = useTenantContext()
  if (status !== 'ready') return <div data-testid="gate">{status}</div>
  return <TeamPanel />
}

/** A small, stable two-row team used by the admin + superadmin variants. */
function smallTeam(): { invites: InviteView[] } {
  return {
    invites: [
      invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' }),
      invite({
        email: 'pending@mipase.com',
        role: 'member',
        status: 'pending',
        claimedByDid: null,
        claimedAt: null,
      }),
    ],
  }
}

beforeEach(() => {
  installMockFetch()
  // The caller's own email — anchors the self-row guardrails (no Revoke on own row).
  setPrivyState({ ready: true, authenticated: true, token: 'jwt', email: 'me@mipase.com' })
})

describe('TeamPanel role-adaptive rendering — MEMBER', () => {
  it('a member (role=member, isSuperadmin=false) sees the honest line and NO management UI / NO roster fetch', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'member', isSuperadmin: false }),
    })
    // Register the roster path so a WRONGFUL fetch would be CAPTURED (not throw) —
    // the assertion below proves the member never reaches for it.
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', { status: 200, body: smallTeam() })

    renderWithProviders(<Gate />)

    // The Team section renders, but only as one honest line.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument(),
    )
    expect(screen.getByText(/contact an admin to manage members/i)).toBeInTheDocument()

    // NO management affordances: no add input, no role toggle, no revoke, no cap.
    expect(screen.queryByLabelText(/invite teammate by email/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: /role to grant/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/managing/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('seat-cap')).not.toBeInTheDocument()

    // A member has no tenant to manage → it NEVER fetches the roster.
    expect(
      capturedRequests.some((r) => r.path.startsWith('/v1/tenants/mi-pase/invites')),
    ).toBe(false)
    // …and it never reaches the superadmin tenant list either.
    expect(
      capturedRequests.some((r) => r.path.startsWith('/v1/superadmin/tenants')),
    ).toBe(false)
  })
})

describe('TeamPanel role-adaptive rendering — TENANT-ADMIN', () => {
  it('a tenant-admin (role=admin, isSuperadmin=false) sees the team list with role pills + the add input, but NO toggle / NO picker', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', { status: 200, body: smallTeam() })

    renderWithProviders(<Gate />)

    // The roster renders both rows (fetched over the live path).
    await waitFor(() =>
      expect(screen.getByText('pending@mipase.com')).toBeInTheDocument(),
    )
    expect(screen.getByText('me@mipase.com')).toBeInTheDocument()

    // Role pills carry TEXT labels (an Admin pill + at least one Member pill).
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getAllByText('Member').length).toBeGreaterThanOrEqual(1)
    // The seat cap is visible (2 active seats / 5).
    expect(screen.getByTestId('seat-cap')).toHaveTextContent('2 / 5 seats')

    // The add input is present (member-only invite for a tenant-admin).
    expect(screen.getByLabelText(/invite teammate by email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument()

    // But NO admin-granting toggle and NO tenant picker — those are superadmin-only.
    expect(
      screen.queryByRole('radiogroup', { name: /role to grant/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/managing/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Platform')).not.toBeInTheDocument()

    // The admin fetched the roster (live path), but NOT the superadmin tenant list.
    expect(
      capturedRequests.some(
        (r) => r.method === 'GET' && r.path.startsWith('/v1/tenants/mi-pase/invites'),
      ),
    ).toBe(true)
    expect(
      capturedRequests.some((r) => r.path.startsWith('/v1/superadmin/tenants')),
    ).toBe(false)
  })
})

describe('TeamPanel role-adaptive rendering — SUPERADMIN', () => {
  it('a superadmin (role=admin, isSuperadmin=true) additionally sees the tenant picker + the Member|Admin role toggle', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: true }),
    })
    mockLivePath('GET', '/v1/superadmin/tenants', {
      status: 200,
      body: { tenants: [{ id: 'mi-pase', name: 'Mi Pase', status: 'active' }] },
    })
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', { status: 200, body: smallTeam() })

    renderWithProviders(<Gate />)

    // The roster renders (same admin team view), keyed off the picked/own tenant.
    await waitFor(() => expect(screen.getByText('me@mipase.com')).toBeInTheDocument())

    // EVERYTHING the tenant-admin has…
    expect(screen.getByLabelText(/invite teammate by email/i)).toBeInTheDocument()
    expect(screen.getByTestId('seat-cap')).toBeInTheDocument()

    // …PLUS the two superadmin-only affordances:
    // DECISION 7 — a labeled tenant picker.
    expect(screen.getByLabelText(/managing/i)).toBeInTheDocument()
    // DECISION 4 — the Member|Admin role toggle on the add row (may grant admin).
    const toggle = screen.getByRole('radiogroup', { name: /role to grant/i })
    expect(toggle).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /member/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /admin/i })).toBeInTheDocument()
    // The Platform tag marks the superadmin's own row.
    expect(screen.getByText('Platform')).toBeInTheDocument()

    // The superadmin fetched BOTH the tenant list and the active tenant's roster.
    expect(
      capturedRequests.some((r) => r.path.startsWith('/v1/superadmin/tenants')),
    ).toBe(true)
    expect(
      capturedRequests.some(
        (r) => r.method === 'GET' && r.path.startsWith('/v1/tenants/mi-pase/invites'),
      ),
    ).toBe(true)
  })
})
