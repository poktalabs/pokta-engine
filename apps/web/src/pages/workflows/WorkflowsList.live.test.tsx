import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type {
  ErrorEnvelope,
  TenantView,
  WorkflowCard,
  WorkspaceWorkflowsResponse,
} from '@godin-engine/contract'
import { useTenantContext } from '@/providers/TenantProvider'
import WorkflowsList from './WorkflowsList'

/**
 * WORKFLOWS-LIST LIVE ★ (P5b Wave 2) — proves the workspace workflows surface is
 * wired to the network read model, NOT the mock registry.
 *
 * The web jsdom project pins `VITE_USE_MOCKS=true`, so a non-LIVE `/v1` path would
 * be served from the in-process mock registry and never touch `fetch`. The spine
 * added `/v1/workspace/workflows` (exact) to `LIVE_PATHS`, so the request DOES hit
 * the network — this test stubs `global.fetch` (via `installMockFetch` /
 * `mockLivePath`) and asserts against the captured request + the rendered cards.
 * It deliberately imports NO `@/mocks` fixtures: the data comes only from the
 * stubbed fetch, exactly as production would serve it.
 *
 * `WorkflowsList` reads `useTenant()` (resolved from the already-live
 * `GET /v1/tenants/me`) for its detail-link base path, and `<WorkflowRow>` renders
 * a `<Link>`, so the page is mounted under a `MemoryRouter` via `wrapInner` and the
 * tenant live path is mocked alongside the workflows one.
 */

// The real Privy SDK can't boot in jsdom — swap in the shared controllable mock.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

const MI_PASE_VIEW: TenantView = {
  id: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase', badge: 'Shopify test store' },
  allowedWorkflows: ['pricing-draft', 'pricing-apply-confident'],
}

// The Daily Pricing card the assertions key on — a real WorkflowCard contract
// shape with a populated lastRun + pending approvals.
const DAILY_PRICING_CARD: WorkflowCard = {
  id: 'pricing-draft',
  displayName: 'Daily Pricing',
  trigger: 'manual',
  lastRun: { status: 'succeeded', at: '2026-06-08T15:30:00.000Z' },
  pendingApprovals: 3,
  hasDetail: true,
}

const SECOND_CARD: WorkflowCard = {
  id: 'call-intake',
  displayName: 'Call Intake',
  trigger: 'event',
  lastRun: null,
  pendingApprovals: 0,
  hasDetail: false,
}

/** Build the REAL wrapped wire error body `{ error: { code, message, retryable } }` for a given contract code. */
function errBody(code: ErrorEnvelope['code'], message = code): { error: ErrorEnvelope } {
  return { error: { code, message, retryable: false } }
}

/**
 * Production-faithful tenant gate. `WorkflowsList` calls `useTenant()`, which
 * THROWS until the tenant has resolved — in production the router-level AppShell
 * gates on `useTenantContext().status === 'ready'` before mounting any page. We
 * mirror that gate (without pulling in AppShell's TopBar/Sidebar/redirect) so the
 * page mounts exactly as it does live, after the already-live `/v1/tenants/me`
 * resolves.
 */
function TenantGate({ children }: { children: ReactNode }) {
  const { status } = useTenantContext()
  if (status !== 'ready') return null
  return <>{children}</>
}

/** Mount WorkflowsList under a MemoryRouter so <WorkflowRow>'s <Link> resolves. */
const router = (children: ReactNode) => (
  <MemoryRouter initialEntries={['/mi-pase/workflows']}>
    <TenantGate>{children}</TenantGate>
  </MemoryRouter>
)

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
  // The tenant live path always resolves so useTenant() (the detail base path) is
  // ready; each case layers its own /v1/workspace/workflows response on top.
  mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
})

describe('WORKFLOWS-LIST LIVE ★ — GET /v1/workspace/workflows drives the card list', () => {
  it('renders the loading state while the workflows fetch is in flight', async () => {
    // Hold the workflows response open so the query stays pending; the tenant query
    // resolves immediately so the page mounts past its own gate into LoadingState.
    let release!: (value: { status: number; body: WorkspaceWorkflowsResponse }) => void
    const pending = new Promise<{ status: number; body: WorkspaceWorkflowsResponse }>((resolve) => {
      release = resolve
    })
    mockLivePath('GET', '/v1/workspace/workflows', () => pending)

    renderWithProviders(<WorkflowsList />, { wrapInner: router })

    // The list body is the LoadingState (role="status") while the fetch is open.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading workflows'))

    // Settle so no unhandled promise leaks past the test.
    release({ status: 200, body: { workflows: [DAILY_PRICING_CARD] } })
    await waitFor(() => expect(screen.getByText('Daily Pricing')).toBeInTheDocument())
  })

  it('renders an error state (never a white screen) when the endpoint fails', async () => {
    mockLivePath('GET', '/v1/workspace/workflows', {
      status: 500,
      body: errBody('SKILL_EXEC_ERROR'),
    })

    renderWithProviders(<WorkflowsList />, { wrapInner: router })

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    // Code-aware fallback copy from ErrorState (default branch).
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    // No card leaked through on the error path.
    expect(screen.queryByText('Daily Pricing')).not.toBeInTheDocument()
  })

  it('renders the empty state when the tenant has no workflows', async () => {
    mockLivePath('GET', '/v1/workspace/workflows', {
      status: 200,
      body: { workflows: [] } satisfies WorkspaceWorkflowsResponse,
    })

    renderWithProviders(<WorkflowsList />, { wrapInner: router })

    await waitFor(() => expect(screen.getByText('No workflows yet')).toBeInTheDocument())
    expect(screen.queryByText('Daily Pricing')).not.toBeInTheDocument()
  })

  it('renders WorkflowCard[] from the stubbed fetch in the loaded state', async () => {
    mockLivePath('GET', '/v1/workspace/workflows', {
      status: 200,
      body: { workflows: [DAILY_PRICING_CARD, SECOND_CARD] } satisfies WorkspaceWorkflowsResponse,
    })

    renderWithProviders(<WorkflowsList />, { wrapInner: router })

    await waitFor(() => expect(screen.getByText('Daily Pricing')).toBeInTheDocument())
    // Both contract cards rendered, not a mock fixture.
    expect(screen.getByText('Call Intake')).toBeInTheDocument()
  })

  it('the Daily Pricing card surfaces displayName + lastRun + pendingApprovals', async () => {
    mockLivePath('GET', '/v1/workspace/workflows', {
      status: 200,
      body: { workflows: [DAILY_PRICING_CARD] } satisfies WorkspaceWorkflowsResponse,
    })

    renderWithProviders(<WorkflowsList />, { wrapInner: router })

    // displayName.
    await waitFor(() => expect(screen.getByText('Daily Pricing')).toBeInTheDocument())
    // lastRun.status === 'succeeded' → the WorkflowRow outcome pill reads "Applied".
    expect(screen.getByText('Applied')).toBeInTheDocument()
    // pendingApprovals === 3 → the amber pending chip + its a11y label.
    expect(screen.getByText('3 pending')).toBeInTheDocument()
    expect(screen.getByLabelText('3 pending approvals')).toBeInTheDocument()
    // hasDetail → the row is a Link to the tenant-scoped detail base path.
    const link = screen.getByRole('link', { name: /Daily Pricing/ })
    expect(link).toHaveAttribute('href', '/mi-pase/workflows/pricing-draft')
  })

  it('issues GET /v1/workspace/workflows as a LIVE path with NO ?tenant= query authority', async () => {
    mockLivePath('GET', '/v1/workspace/workflows', {
      status: 200,
      body: { workflows: [DAILY_PRICING_CARD] } satisfies WorkspaceWorkflowsResponse,
    })

    renderWithProviders(<WorkflowsList />, { wrapInner: router })
    await waitFor(() => expect(screen.getByText('Daily Pricing')).toBeInTheDocument())

    // The request actually hit the network (LIVE path), not the mock registry.
    const wfCalls = capturedRequests.filter(
      (r) => r.method === 'GET' && r.path.split('?')[0] === '/v1/workspace/workflows',
    )
    expect(wfCalls.length).toBeGreaterThanOrEqual(1)
    // JWT is the only tenant authority — the path carries NO ?tenant= query and the
    // Bearer token is present (the machine secret never reaches the browser).
    for (const call of wfCalls) {
      expect(call.path).not.toContain('?tenant=')
      expect(call.path).not.toContain('tenant=')
      expect(call.headers['authorization']).toBe('Bearer test-privy-jwt')
      expect(call.headers['x-service-key']).toBeUndefined()
    }
  })
})
