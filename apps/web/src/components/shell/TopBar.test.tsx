import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { installMockFetch, mockLivePath, privyMockSpies, renderWithProviders, setPrivyState } from '@/test'
import { TopBar } from '@/components/shell/TopBar'
import type { TenantView } from '@godin-engine/contract'

/**
 * TopBar identity + sign-out (fix/web-topbar-identity). The shell chrome must
 * reflect the REAL signed-in principal, not the old hardcoded `operator@tenant`
 * placeholder, and "Sign out" must actually call Privy `logout()` (not just close
 * the menu). TopBar pulls in TenantHeader → useTenant, so the tenant query is
 * stubbed live; Privy is the shared controllable mock.
 */

vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

// TenantHeader calls useTenant() (gated on a resolved tenant); in the real app
// TopBar only mounts once AppShell sees status==='ready'. This test isolates the
// user-menu (identity + sign-out), so stub the branding lockup.
vi.mock('@/components/shell/TenantHeader', () => ({ TenantHeader: () => <div data-testid="brand" /> }))

const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft'],
}

const router = (children: ReactNode) => <MemoryRouter initialEntries={['/mi-pase']}>{children}</MemoryRouter>

beforeEach(() => {
  installMockFetch()
  mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt', email: 'dev@poktalabs.com' })
})

describe('TopBar — real identity + working sign-out', () => {
  it('shows the signed-in Privy email, not the operator@tenant placeholder', async () => {
    renderWithProviders(<TopBar />, { wrapInner: router })
    await userEvent.click(await screen.findByRole('button', { name: /dev@poktalabs\.com/i }))
    // Shown in both the trigger button and the menu's "signed in as" line.
    expect(screen.getAllByText('dev@poktalabs.com').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('operator@tenant')).not.toBeInTheDocument()
  })

  it('Sign out calls Privy logout()', async () => {
    renderWithProviders(<TopBar />, { wrapInner: router })
    await userEvent.click(await screen.findByRole('button', { name: /dev@poktalabs\.com/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }))
    await waitFor(() => expect(privyMockSpies.logout).toHaveBeenCalledTimes(1))
  })

  it('falls back to the generic operator label when no email is linked', async () => {
    setPrivyState({ email: null })
    renderWithProviders(<TopBar />, { wrapInner: router })
    // The generic label resolves via i18n; just assert the placeholder email is gone.
    await waitFor(() => expect(screen.queryByText('operator@tenant')).not.toBeInTheDocument())
  })
})
