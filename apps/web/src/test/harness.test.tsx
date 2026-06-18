import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { installMockFetch, mockLivePath, renderWithProviders, setPrivyState } from '@/test'
import type { TenantView } from '@pokta-engine/contract'

/**
 * HARNESS smoke test (PR2b W0 acceptance). Proves the shared utility renders a
 * trivial component inside the real provider tree under jsdom: the Privy mock, the
 * fresh QueryClient, and the path-aware live fetch for `/v1/tenants/me` all wire
 * up. Phase-2 writers build on exactly this setup.
 */

// Replace the Privy SDK (cannot boot in jsdom) with the shared controllable mock.
// The factory is loaded via dynamic import INSIDE the (hoisted) `vi.mock` callback
// so it never references a not-yet-initialized top-level import binding.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

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
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
  mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
})

describe('HARNESS — renderWithProviders', () => {
  it('renders a trivial component inside the real provider tree', async () => {
    renderWithProviders(<div>hello harness</div>)
    expect(await screen.findByText('hello harness')).toBeInTheDocument()
  })
})
