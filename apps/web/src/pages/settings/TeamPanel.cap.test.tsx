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
import type { InviteView, TenantView } from '@pokta-engine/contract'
import { useTenantContext } from '@/providers/TenantProvider'
import { TeamPanel } from '@/pages/settings/TeamPanel'

/**
 * TeamPanel — SEAT-CAP + REVOKE FLOW (admin-roles Wave B, §5 DECISIONS 1/3/4/5).
 *
 * Companion to TeamPanel.test.tsx, focused on the seat-cap contract and the
 * destructive revoke confirm. COSMETIC over the Wave A role endpoints — the server
 * re-checks every action — but the SPA must be HONEST about the cap and never let a
 * destructive action fire without a confirm. Drives the LIVE-PATH split: `/v1/tenants/me`
 * + the tenant team endpoints (invites, invites/:email) are in `LIVE_PATHS`/
 * `LIVE_PATH_PATTERNS`, so they hit the stubbed `global.fetch` (installMockFetch /
 * mockLivePath), not the in-process mock registry. Error fixtures use the REAL wrapped
 * `{ error: <envelope> }` shape (the #22 lesson) so parseError unwraps the code.
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
  // The caller is a TENANT-ADMIN of mi-pase (the variant that manages the cap).
  setPrivyState({ ready: true, authenticated: true, token: 'jwt', email: 'me@mipase.com' })
  mockLivePath('GET', '/v1/tenants/me', {
    status: 200,
    body: viewFor({ role: 'admin', isSuperadmin: false }),
  })
})

describe('TeamPanel cap — OVER-CAP (6/5 grandfathered, mi-pase real state)', () => {
  it('shows the amber over-cap WARNING and disables Add with the visible aria-describedby reason', async () => {
    // 6 active (pending) seats over the 5-seat cap — the REAL mi-pase grandfathered state.
    const six = Array.from({ length: 6 }, (_, i) =>
      invite({
        email: `seat${i}@x.com`,
        role: 'member',
        status: 'pending',
        claimedByDid: null,
        claimedAt: null,
      }),
    )
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', { status: 200, body: { invites: six } })
    renderWithProviders(<Gate />)

    // DECISION 1 — the seat cap is always visible, and it reads the over-cap count.
    await waitFor(() =>
      expect(screen.getByTestId('seat-cap')).toHaveTextContent('6 / 5 seats'),
    )

    // DECISION 1 — over-cap is an AMBER (status, not error) warning with TEXT.
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent(/over your 5-seat limit/i)
    expect(warning).toHaveTextContent(/revoke a pending invite/i)

    // DECISION 4 — Add is DISABLED-WITH-REASON, surfaced via aria-describedby (not a
    // silent grey button). Assert the input is disabled, names a reason node, and that
    // node carries the human-readable cap reason.
    const input = screen.getByLabelText(/invite teammate by email/i)
    expect(input).toBeDisabled()
    const reasonId = input.getAttribute('aria-describedby')
    expect(reasonId).toBeTruthy()
    const reasonNode = document.getElementById(reasonId!)
    expect(reasonNode).not.toBeNull()
    expect(reasonNode!.textContent).toMatch(/team is full \(6\/5\)/i)
    expect(reasonNode!.textContent).toMatch(/revoke an invite to free a seat/i)
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled()
  })
})

describe('TeamPanel cap — UNDER-CAP add + TEAM_FULL race', () => {
  it('under cap: Add is enabled, POST fires, and a 409 TEAM_FULL (wrapped envelope) surfaces its message', async () => {
    const user = userEvent.setup()
    // 1 active seat — well under cap, so the add row is enabled.
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [
          invite({
            email: 'solo@x.com',
            role: 'member',
            status: 'pending',
            claimedByDid: null,
            claimedAt: null,
          }),
        ],
      },
    })
    // The server lost the race and rejects with the REAL wrapped envelope shape.
    mockLivePath('POST', '/v1/tenants/mi-pase/invites', {
      status: 409,
      body: { error: { code: 'TEAM_FULL', message: 'team is full', retryable: false } },
    })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('solo@x.com')).toBeInTheDocument())

    // Under cap → input enabled, Add enabled once an email is typed.
    const input = screen.getByLabelText(/invite teammate by email/i)
    expect(input).not.toBeDisabled()
    expect(input.getAttribute('aria-describedby')).toBeNull()
    await user.type(input, 'fresh@x.com')

    const addButton = screen.getByRole('button', { name: /add/i })
    expect(addButton).not.toBeDisabled()
    await user.click(addButton)

    // The POST actually fired to the live path with the typed email.
    await waitFor(() =>
      expect(
        capturedRequests.some(
          (r) =>
            r.method === 'POST' &&
            r.path === '/v1/tenants/mi-pase/invites' &&
            (r.body as { email?: string } | undefined)?.email === 'fresh@x.com',
        ),
      ).toBe(true),
    )

    // TEAM_FULL degrades to an inline alert, never a white-screen.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/team is full/i),
    )
  })
})

describe('TeamPanel cap — REVOKE requires the confirm step', () => {
  it('clicking Revoke opens a confirm echoing the email; confirming fires DELETE', async () => {
    const user = userEvent.setup()
    let deleted = false
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', () => ({
      status: 200,
      body: {
        invites: deleted
          ? [invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' })]
          : [
              invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' }),
              invite({
                email: 'gone@x.com',
                role: 'member',
                status: 'pending',
                claimedByDid: null,
                claimedAt: null,
              }),
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

    // The DELETE must NOT have fired before the confirm step.
    expect(
      capturedRequests.some((r) => r.method === 'DELETE'),
    ).toBe(false)

    // DECISION 3 — clicking Revoke opens a destructive confirm (does not delete yet).
    await user.click(screen.getByRole('button', { name: /^revoke$/i }))
    const dialog = await screen.findByRole('alertdialog')
    // The email is echoed inside the confirm so the user knows who they are removing.
    expect(within(dialog).getByText('gone@x.com')).toBeInTheDocument()
    expect(capturedRequests.some((r) => r.method === 'DELETE')).toBe(false)

    // Confirming fires the DELETE to the encoded live path.
    await user.click(within(dialog).getByRole('button', { name: /revoke access/i }))
    await waitFor(() =>
      expect(
        capturedRequests.some(
          (r) => r.method === 'DELETE' && r.path === '/v1/tenants/mi-pase/invites/gone%40x.com',
        ),
      ).toBe(true),
    )
  })

  it('cancel dismisses the confirm and fires NO DELETE', async () => {
    const user = userEvent.setup()
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [
          invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' }),
          invite({
            email: 'stay@x.com',
            role: 'member',
            status: 'pending',
            claimedByDid: null,
            claimedAt: null,
          }),
        ],
      },
    })
    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('stay@x.com')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^revoke$/i }))

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    // The confirm is gone and nothing was deleted.
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
    expect(capturedRequests.some((r) => r.method === 'DELETE')).toBe(false)
    // The row is still there — cancel is a true no-op.
    expect(screen.getByText('stay@x.com')).toBeInTheDocument()
  })

  it('DECISION 5 — no Revoke on the caller-own row', async () => {
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

    // Both rows render, but Revoke exists ONLY on the other member — never the caller's
    // own row. Exactly one Revoke button.
    expect(screen.getByText('me@mipase.com')).toBeInTheDocument()
    const revokes = screen.getAllByRole('button', { name: /^revoke$/i })
    expect(revokes).toHaveLength(1)

    // Confirm it targets the non-self row: opening it echoes the other member's email.
    const user = userEvent.setup()
    await user.click(revokes[0]!)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('other@x.com')).toBeInTheDocument()
    expect(within(dialog).queryByText('me@mipase.com')).not.toBeInTheDocument()
  })
})
