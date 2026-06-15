import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
 * TeamPanel (admin-roles Wave B, §5) — the role-adaptive Settings → Team panel.
 *
 * COSMETIC over the Wave A role endpoints (every action is re-checked server-side).
 * These cases drive the LIVE-PATH split: `/v1/tenants/me` + the team endpoints are
 * registered in `LIVE_PATHS`/`LIVE_PATH_PATTERNS`, so they hit the stubbed fetch
 * (not the in-process mock registry). We assert the three role variants + the 7
 * locked design decisions.
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

/** Gate the panel on a resolved tenant, exactly like the production AppShell. */
function Gate() {
  const { status } = useTenantContext()
  if (status !== 'ready') return <div data-testid="gate">{status}</div>
  return <TeamPanel />
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'jwt', email: 'me@mipase.com' })
})

describe('TeamPanel — MEMBER variant', () => {
  it('shows one honest line and NO management UI', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'member', isSuperadmin: false }),
    })
    renderWithProviders(<Gate />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument(),
    )
    expect(screen.getByText(/contact an admin to manage members/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/invite teammate by email/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
    // A member NEVER fetches the team roster (no tenant to manage).
    expect(
      capturedRequests.some((r) => r.path.startsWith('/v1/tenants/mi-pase/invites')),
    ).toBe(false)
  })
})

describe('TeamPanel — TENANT-ADMIN variant', () => {
  beforeEach(() => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
  })

  it('renders the seat cap, a scannable roster with role pills + status tags, and a member-only add row', async () => {
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [
          invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' }),
          invite({ email: 'pending@x.com', role: 'member', status: 'pending', claimedByDid: null, claimedAt: null }),
        ],
      },
    })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('pending@x.com')).toBeInTheDocument())
    // DECISION 1 — seat cap always visible: 2 active seats / 5.
    expect(screen.getByTestId('seat-cap')).toHaveTextContent('2 / 5 seats')
    // DECISION 2 — role pills with TEXT labels + status tags.
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getAllByText('Member').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    // DECISION 4 — a tenant-admin gets NO role toggle (cannot grant admin).
    expect(screen.queryByRole('radiogroup', { name: /role to grant/i })).not.toBeInTheDocument()
    // Add row is present (member-only invite).
    expect(screen.getByLabelText(/invite teammate by email/i)).toBeInTheDocument()
  })

  it('DECISION 5 — no Revoke on your own row', async () => {
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [
          invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' }),
          invite({ email: 'other@x.com', role: 'member', status: 'claimed' }),
        ],
      },
    })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('other@x.com')).toBeInTheDocument())
    // Exactly ONE Revoke button — on the other member, NOT the caller's own row.
    const revokes = screen.getAllByRole('button', { name: /revoke/i })
    expect(revokes).toHaveLength(1)
  })

  it('DECISION 3 — Revoke is a destructive confirm with the email echoed; confirm fires DELETE', async () => {
    const user = userEvent.setup()
    let deleted = false
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', () => ({
      status: 200,
      body: {
        invites: deleted
          ? [invite({ email: 'me@mipase.com', role: 'admin' })]
          : [
              invite({ email: 'me@mipase.com', role: 'admin' }),
              invite({ email: 'gone@x.com', role: 'member', status: 'pending', claimedByDid: null, claimedAt: null }),
            ],
      },
    }))
    // apiFetch encodes the email path segment → `gone%40x.com`.
    mockLivePath('DELETE', '/v1/tenants/mi-pase/invites/gone%40x.com', () => {
      deleted = true
      return { status: 204 }
    })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('gone@x.com')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^revoke$/i }))

    // The confirm dialog echoes the email.
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('gone@x.com')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /revoke access/i }))

    await waitFor(() =>
      expect(
        capturedRequests.some(
          (r) => r.method === 'DELETE' && r.path === '/v1/tenants/mi-pase/invites/gone%40x.com',
        ),
      ).toBe(true),
    )
  })

  it('DECISION 4 + 6 — empty team shows a warm line; the add input is present', async () => {
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: { invites: [] },
    })
    renderWithProviders(<Gate />)

    await waitFor(() =>
      expect(screen.getByText(/it is just you so far/i)).toBeInTheDocument(),
    )
    expect(screen.getByLabelText(/invite teammate by email/i)).toBeInTheDocument()
  })

  it('DECISION 1 + 4 — OVER-CAP (6/5) shows the amber warning and disables Add with a reason', async () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      invite({ email: `m${i}@x.com`, role: 'member', status: 'pending', claimedByDid: null, claimedAt: null }),
    )
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', { status: 200, body: { invites: six } })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByTestId('seat-cap')).toHaveTextContent('6 / 5 seats'))
    expect(screen.getByText(/over your 5-seat limit/i)).toBeInTheDocument()
    // DECISION 4 — Add disabled + the reason rendered (aria-describedby).
    const input = screen.getByLabelText(/invite teammate by email/i)
    expect(input).toBeDisabled()
    const reasonId = input.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    expect(document.getElementById(reasonId!)?.textContent).toMatch(/team is full \(6\/5\)/i)
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled()
  })

  it('surfaces TEAM_FULL on add as an inline error (real wrapped envelope), not a white-screen', async () => {
    const user = userEvent.setup()
    // 4 seats — under cap, so the add row is enabled; the server still rejects.
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [
          invite({ email: 'a@x.com', status: 'pending', claimedByDid: null, claimedAt: null }),
        ],
      },
    })
    mockLivePath('POST', '/v1/tenants/mi-pase/invites', {
      status: 409,
      body: { error: { code: 'TEAM_FULL', message: 'team full', retryable: false } },
    })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('a@x.com')).toBeInTheDocument())
    await user.type(screen.getByLabelText(/invite teammate by email/i), 'new@x.com')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/team is full/i),
    )
  })
})

describe('TeamPanel — SUPERADMIN variant', () => {
  beforeEach(() => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: true }),
    })
    mockLivePath('GET', '/v1/superadmin/tenants', {
      status: 200,
      body: { tenants: [{ id: 'mi-pase', name: 'Mi Pase', status: 'active' }] },
    })
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' })],
      },
    })
  })

  it('renders the tenant picker, a role toggle on the add row, and a Platform tag on the own row', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: true }),
    })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('me@mipase.com')).toBeInTheDocument())
    // DECISION 7 — labeled tenant picker.
    expect(screen.getByLabelText(/managing/i)).toBeInTheDocument()
    // DECISION 4 — the role toggle renders for a superadmin (may grant admin).
    expect(screen.getByRole('radiogroup', { name: /role to grant/i })).toBeInTheDocument()
    // The Platform tag on the superadmin's own row.
    expect(screen.getByText('Platform')).toBeInTheDocument()
  })
})
