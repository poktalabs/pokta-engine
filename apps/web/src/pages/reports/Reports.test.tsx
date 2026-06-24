import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { installMockFetch, mockLivePath, renderWithProviders, setPrivyState } from '@/test'
import { useTenantContext } from '@/providers/TenantProvider'
import ReportsPage from './ReportsPage'
import type { TenantView } from '@pokta-engine/contract'

/**
 * REPORTS — the mi-pase tenant gets curated download cards (static bundle data);
 * every other tenant gets the honest ComingSoon (no backend read model yet).
 */

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

const VINO_VIEW: TenantView = {
  id: 'vino',
  name: 'Vino',
  status: 'active',
  currency: 'USD',
  locale: 'en',
  branding: { name: 'Vino' },
  allowedWorkflows: ['call-intake'],
}

/** Mirror AppShell's gate — the page reads useTenant(), which throws until ready. */
function Gate({ children }: { children: ReactNode }) {
  const { status } = useTenantContext()
  if (status !== 'ready') return <div data-testid="tenant-gate">{status}</div>
  return <>{children}</>
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
})

describe('Reports', () => {
  it('renders both curated download cards for the mi-pase tenant', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    renderWithProviders(
      <Gate>
        <ReportsPage />
      </Gate>,
    )

    await waitFor(() =>
      expect(screen.getByText('Data reconciliation report')).toBeInTheDocument(),
    )
    expect(screen.getByText('Daily pricing recommendations')).toBeInTheDocument()
    // Each card exposes a Download action.
    expect(screen.getAllByRole('button', { name: /download/i })).toHaveLength(2)
    // A headline stat from the reconciliation report is surfaced.
    expect(screen.getByText('602')).toBeInTheDocument()
  })

  it('streams the bundled file via a Blob on download (no network)', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    const createUrl = vi.fn((_blob: Blob | MediaSource) => 'blob:report')
    const revokeUrl = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl })
    // jsdom can't navigate; the real <a>.click() would log a navigation error.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    renderWithProviders(
      <Gate>
        <ReportsPage />
      </Gate>,
    )
    await waitFor(() => expect(screen.getByText('Data reconciliation report')).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /download/i })[0]!)
    expect(createUrl).toHaveBeenCalledTimes(1)
    expect(createUrl.mock.calls[0]![0]).toBeInstanceOf(Blob)
    expect(revokeUrl).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('shows the honest ComingSoon for a tenant without curated reports', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: VINO_VIEW })
    renderWithProviders(
      <Gate>
        <ReportsPage />
      </Gate>,
    )

    await waitFor(() => expect(screen.getByText('No reports yet')).toBeInTheDocument())
    expect(screen.queryByText('Data reconciliation report')).not.toBeInTheDocument()
  })
})
