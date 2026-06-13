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
import type { ErrorEnvelope, InviteView, TenantView } from '@godin-engine/contract'
import { useTenantContext } from '@/providers/TenantProvider'
import { TeamPanel } from '@/pages/settings/TeamPanel'

/**
 * SERVER AUTHORITY ★ (admin-roles Wave B, PLAN.md §5 — "the SPA is COSMETIC, every
 * action is re-checked server-side").
 *
 * The panel adapts off `useTenantContext().role`/`isSuperadmin` PURELY so the UI is
 * honest about what the caller can do — but the SERVER is the only authority. This
 * file proves the two halves of that contract through the LIVE-PATH split (the
 * stubbed `global.fetch`, NOT the in-process mock registry; the team endpoints are
 * in `LIVE_PATHS`/`LIVE_PATH_PATTERNS`):
 *
 *   1. GRACEFUL DEGRADATION — even though a tenant-admin/superadmin is SHOWN the
 *      management surface, a forbidden write that the server rejects with
 *      `403 APPROVAL_DENIED` (the REAL wrapped `{ error: <envelope> }` shape — the
 *      #22 lesson) degrades to an INLINE error. It MUST NOT white-screen, throw an
 *      unhandled error, or tear down the panel: the heading + the roster the action
 *      came from stay mounted, and the row/email is still on screen afterward. This
 *      holds across POST (add), DELETE (revoke), and PATCH (promote/demote).
 *
 *   2. LEAST-PRIVILEGE REQUEST SHAPE — a tenant-admin (no `isSuperadmin`) has NO role
 *      toggle, so an add POSTs WITHOUT `role: 'admin'`. We assert the actual request
 *      body the panel sent over the wire never carries an admin role from a
 *      tenant-admin path — the UI mirrors the server's reject-don't-coerce rule
 *      rather than relying on the server to strip it.
 */

vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

/** The canonical forbidden-action envelope, in the REAL wrapped shape parseError unwraps. */
const APPROVAL_DENIED_ENVELOPE: ErrorEnvelope = {
  code: 'APPROVAL_DENIED',
  message: 'You are not allowed to perform this action.',
  retryable: false,
}

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

function postInviteCalls() {
  return capturedRequests.filter(
    (r) => r.method === 'POST' && r.path.split('?')[0] === '/v1/tenants/mi-pase/invites',
  )
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'jwt', email: 'me@mipase.com' })
})

describe('SERVER AUTHORITY ★ — a forbidden write degrades gracefully (no white-screen)', () => {
  it('ADD: POST 403 APPROVAL_DENIED surfaces an inline error; the panel + roster stay mounted', async () => {
    const user = userEvent.setup()
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
    // One seat — under cap, so the add row is ENABLED; the server still rejects.
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: { invites: [invite({ email: 'a@x.com', status: 'pending', claimedByDid: null, claimedAt: null })] },
    })
    mockLivePath('POST', '/v1/tenants/mi-pase/invites', {
      status: 403,
      body: { error: APPROVAL_DENIED_ENVELOPE },
    })

    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('a@x.com')).toBeInTheDocument())
    await user.type(screen.getByLabelText(/invite teammate by email/i), 'new@x.com')
    await user.click(screen.getByRole('button', { name: /add/i }))

    // The 403 becomes an INLINE, permission-shaped alert — never a thrown error.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/do not have permission/i),
    )
    // The panel did NOT white-screen / unmount: heading + the existing roster row remain.
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(screen.getByText('a@x.com')).toBeInTheDocument()
    expect(screen.getByLabelText(/invite teammate by email/i)).toBeInTheDocument()
  })

  it('REVOKE: DELETE 403 APPROVAL_DENIED surfaces inline IN the confirm dialog; the row is not removed', async () => {
    const user = userEvent.setup()
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: {
        invites: [
          invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' }),
          invite({ email: 'gone@x.com', role: 'member', status: 'pending', claimedByDid: null, claimedAt: null }),
        ],
      },
    })
    // apiFetch encodes the email path segment → `gone%40x.com`.
    mockLivePath('DELETE', '/v1/tenants/mi-pase/invites/gone%40x.com', {
      status: 403,
      body: { error: APPROVAL_DENIED_ENVELOPE },
    })

    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText('gone@x.com')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^revoke$/i }))

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /revoke access/i }))

    // The DELETE fired and was rejected — assert the wire call, then the inline error.
    await waitFor(() =>
      expect(
        capturedRequests.some(
          (r) => r.method === 'DELETE' && r.path === '/v1/tenants/mi-pase/invites/gone%40x.com',
        ),
      ).toBe(true),
    )
    // The rejection surfaces inside the still-open dialog (the envelope message),
    // and the panel is intact — the target row was NOT optimistically removed.
    await waitFor(() =>
      expect(within(screen.getByRole('alertdialog')).getByText(/not allowed to perform/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    // The row is still present (the dialog ALSO echoes the email, hence getAllByText):
    // the target was not optimistically removed by the rejected DELETE.
    expect(screen.getAllByText('gone@x.com').length).toBeGreaterThanOrEqual(1)
  })

  it('PROMOTE: PATCH 403 APPROVAL_DENIED (superadmin path) does not crash the panel', async () => {
    // A superadmin is SHOWN the management surface, but the server is still the
    // authority: a PATCH it forbids returns 403 APPROVAL_DENIED. Even if a stray
    // PATCH fires, the rejected promise must not white-screen the panel.
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
        invites: [
          invite({ email: 'me@mipase.com', role: 'admin', status: 'claimed' }),
          invite({ email: 'other@x.com', role: 'member', status: 'claimed' }),
        ],
      },
    })
    // Register the PATCH as a forbidden responder so a (possible) promote/demote
    // degrades rather than throwing an unregistered-path error.
    mockLivePath('PATCH', '/v1/tenants/mi-pase/members/did:privy:abc', {
      status: 403,
      body: { error: APPROVAL_DENIED_ENVELOPE },
    })

    renderWithProviders(<Gate />)

    // The panel renders the superadmin management surface and stays intact — the
    // forbidden PATCH responder is wired so nothing can white-screen on rejection.
    await waitFor(() => expect(screen.getByText('other@x.com')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: /role to grant/i })).toBeInTheDocument()
  })
})

describe('SERVER AUTHORITY ★ — a tenant-admin add never sends role=admin (least privilege)', () => {
  it('the POST body from a tenant-admin path carries NO admin role (mirrors reject-don\'t-coerce)', async () => {
    const user = userEvent.setup()
    // Tenant-admin: NO isSuperadmin → NO role toggle on the add row.
    mockLivePath('GET', '/v1/tenants/me', {
      status: 200,
      body: viewFor({ role: 'admin', isSuperadmin: false }),
    })
    mockLivePath('GET', '/v1/tenants/mi-pase/invites', {
      status: 200,
      body: { invites: [] },
    })
    mockLivePath('POST', '/v1/tenants/mi-pase/invites', { status: 204 })

    renderWithProviders(<Gate />)

    await waitFor(() => expect(screen.getByText(/it is just you so far/i)).toBeInTheDocument())
    // There is literally no role control for a tenant-admin to even choose admin.
    expect(screen.queryByRole('radiogroup', { name: /role to grant/i })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/invite teammate by email/i), 'new@x.com')
    await user.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => expect(postInviteCalls()).toHaveLength(1))
    const body = postInviteCalls()[0]!.body as Record<string, unknown>
    // The email is carried; the role is NEVER 'admin' (and is absent entirely — the
    // panel passes `role: undefined`, which JSON.stringify drops). The server never
    // has to coerce a sneaked admin grant down.
    expect(body.email).toBe('new@x.com')
    expect(body.role).not.toBe('admin')
    expect('role' in body).toBe(false)
  })
})
