import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactElement } from 'react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import RunDetail from '@/pages/runs/RunDetail'
import { AppShell } from '@/components/shell/AppShell'
import type { RunDetail as RunDetailRow, TenantView } from '@pokta-engine/contract'

/**
 * RUN DETAIL — LIVE-PATH ★ (P5b Wave 2).
 *
 * RunDetail is wired off the mock fixtures onto the real Wave-1 read model:
 *   - GET /v1/runs/:id            → the run-detail summary (useRunDetail).
 *   - POST /v1/workflows/:id/runs → Re-run dispatch (useRerunWorkflow).
 *
 * The web jsdom project pins `VITE_USE_MOCKS: 'true'`, so these only reach the
 * network because the spine added `^/v1/runs/[^/]+$` + `^/v1/workflows/[^/]+/runs$`
 * to the live-path matcher. This file therefore drives them through the SHARED
 * fetch stub (`installMockFetch` + `mockLivePath`) and asserts against
 * `capturedRequests` — NOT the in-process mock registry. The old mocks
 * (`MOCK_RUN_DETAIL`, `MOCK_RUN_DETAIL_PARTIAL_FAILURE`) are deliberately NOT
 * imported here — the page no longer reads them in production, and this test
 * proves the surface stands up on the server payload alone.
 *
 * TenantProvider sits above the page and hydrates from the (live) `/v1/tenants/me`,
 * so every case registers that route too; the page reads `useTenant()` for the
 * base path of its breadcrumb / re-run navigation.
 */

// The Privy SDK cannot boot in jsdom — replace it with the shared controllable mock.
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

/**
 * A daily-pricing run as the SERVER would return it (RunDetail = the raw
 * engine_runs row). `output.kind === 'mipase.daily-pricing'` triggers the rich
 * tiles; `status: 'succeeded'` with a needs-review count > 0 reads as held-at-gate.
 * Built inline so the test never imports the production mock fixture.
 */
const RUN_ID = 'run_pricing_draft_9001'
const WORKFLOW_ID = 'mipase.daily-pricing'

const SERVER_RUN: RunDetailRow = {
  runId: RUN_ID,
  workflowId: WORKFLOW_ID,
  status: 'succeeded',
  consumerId: 'consumer_mipase',
  input: { schedule: 'daily-0600', channel: 'shopify' },
  output: {
    kind: 'mipase.daily-pricing',
    target: { channel: 'shopify', store: 'mi-pase-test', testStore: true },
    analyzedCount: 1284,
    autoAppliedCount: 248,
    needsReviewCount: 6,
    noChangeCount: 1030,
    pendingApprovalId: 'apr_mipase_pricing_batch_001',
    flagged: [],
    applied: [],
  },
  error: null,
  traceId: 'trace_pricing_9001',
  idempotencyKey: 'mipase-pricing-2026-06-08',
  parentRunId: null,
  createdAt: '2026-06-08T12:00:04.000Z',
  startedAt: '2026-06-08T12:00:05.000Z',
  finishedAt: '2026-06-08T12:01:48.000Z',
}

/** Reflects the current pathname so a re-run navigation is observable in the DOM. */
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}

/**
 * Mount the real RunDetail page under its production route shape — a `/:tenant`
 * AppShell parent (the router-level tenant gate: it renders the `<Outlet/>` only
 * once `/v1/tenants/me` resolves to `status==='ready'`, and redirects a mismatched
 * segment) with `runs/:id` as a child route, mirroring App.tsx. The URL enters at
 * the given run, with the server tenant (mi-pase) matching so no redirect fires.
 * The re-run success path navigates to `/:tenant/workflows/:id`, so a sibling
 * child route catches the landing for the dispatch assertion.
 *
 * AppShell reads `window.location.pathname` for sub-path preservation on redirect;
 * MemoryRouter does not touch jsdom's URL, so we align it with the entry (no
 * redirect is expected here, but this keeps the harness production-faithful — see
 * tenant-provider.test.tsx).
 */
function runHarness(runId: string): ReactElement {
  const initialPath = `/mi-pase/runs/${encodeURIComponent(runId)}`
  window.history.replaceState(null, '', initialPath)
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <Routes>
        <Route path="/:tenant" element={<AppShell />}>
          <Route path="runs/:id" element={<RunDetail />} />
          <Route
            path="workflows/:id"
            element={<div data-testid="workflow-landing">workflow</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
})

describe('RUN DETAIL ★ — GET /v1/runs/:id renders the run from the live read model', () => {
  it('fetches /v1/runs/:id (live, not the mock registry) and renders the run summary', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    mockLivePath('GET', `/v1/runs/${RUN_ID}`, { status: 200, body: SERVER_RUN })

    renderWithProviders(runHarness(RUN_ID))

    // The header surfaces the run id (mono) + the Re-run affordance once loaded.
    await waitFor(() => expect(screen.getByText(RUN_ID)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /re-run/i })).toBeInTheDocument()
    // The daily-pricing output drove the rich tiles (server payload narrowed by kind).
    expect(screen.getByText('Products analyzed')).toBeInTheDocument()

    // The run was fetched over the network as a LIVE path — assert the stubbed fetch
    // saw it (the whole point of the live-path split; the mock registry never runs).
    const runReqs = capturedRequests.filter(
      (r) => r.method === 'GET' && r.path.split('?')[0] === `/v1/runs/${RUN_ID}`,
    )
    expect(runReqs.length).toBeGreaterThanOrEqual(1)
    // It carried the Privy JWT and no machine secret — server is the tenant authority.
    expect(runReqs[0]?.headers['authorization']).toBe('Bearer test-privy-jwt')
    expect(runReqs[0]?.headers['x-service-key']).toBeUndefined()
  })

  it('encodes the run id in the path (no raw interpolation leak)', async () => {
    const weirdId = 'run/with space'
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    // The live matcher is `^/v1/runs/[^/]+$`; an encoded id keeps a single segment.
    mockLivePath('GET', `/v1/runs/${encodeURIComponent(weirdId)}`, {
      status: 200,
      body: { ...SERVER_RUN, runId: weirdId },
    })

    renderWithProviders(runHarness(weirdId))

    await waitFor(() => expect(screen.getByText(weirdId)).toBeInTheDocument())
    const runReqs = capturedRequests.filter((r) => r.path.startsWith('/v1/runs/'))
    expect(runReqs[0]?.path).toBe(`/v1/runs/${encodeURIComponent(weirdId)}`)
  })
})

describe('RUN DETAIL ★ — Re-run dispatches POST /v1/workflows/:id/runs', () => {
  it('clicking Re-run POSTs to the workflow dispatch route and navigates to the workflow', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    mockLivePath('GET', `/v1/runs/${RUN_ID}`, { status: 200, body: SERVER_RUN })
    mockLivePath('POST', `/v1/workflows/${WORKFLOW_ID}/runs`, {
      status: 202,
      body: { runId: 'run_pricing_draft_9002', status: 'queued', traceId: 'trace_rerun_1' },
    })

    renderWithProviders(runHarness(RUN_ID))

    const rerun = await screen.findByRole('button', { name: /re-run/i })
    await userEvent.click(rerun)

    // The dispatch hit the LIVE write route.
    await waitFor(() => {
      const posts = capturedRequests.filter(
        (r) => r.method === 'POST' && r.path.split('?')[0] === `/v1/workflows/${WORKFLOW_ID}/runs`,
      )
      expect(posts.length).toBe(1)
    })
    const post = capturedRequests.find(
      (r) => r.method === 'POST' && r.path.split('?')[0] === `/v1/workflows/${WORKFLOW_ID}/runs`,
    )
    // Carried the Bearer JWT and a JSON `input` envelope (never a machine secret).
    expect(post?.headers['authorization']).toBe('Bearer test-privy-jwt')
    expect(post?.headers['x-service-key']).toBeUndefined()
    expect(post?.body).toEqual({ input: {} })

    // On success the page routes to the workflow, where the fresh run surfaces.
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/mi-pase/workflows/${WORKFLOW_ID}`),
    )
    expect(screen.getByTestId('workflow-landing')).toBeInTheDocument()
  })

  it('a Re-run dispatch failure renders an inline error, not a white screen (run stays visible)', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    mockLivePath('GET', `/v1/runs/${RUN_ID}`, { status: 200, body: SERVER_RUN })
    // Non-retryable so apiFetch throws immediately (a retryable 5xx would spin the
    // exponential-backoff budget; this case asserts the terminal-error UI, not retry).
    mockLivePath('POST', `/v1/workflows/${WORKFLOW_ID}/runs`, {
      status: 500,
      body: { error: { code: 'SKILL_EXEC_ERROR', message: 'Dispatch failed — please try again.', retryable: false } },
    })

    renderWithProviders(runHarness(RUN_ID))

    const rerun = await screen.findByRole('button', { name: /re-run/i })
    await userEvent.click(rerun)

    // The dispatch error degrades into an inline alert; the run summary is still there.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(RUN_ID)).toBeInTheDocument()
    // It did NOT navigate away on a failed dispatch.
    expect(screen.getByTestId('location')).toHaveTextContent(`/mi-pase/runs/${RUN_ID}`)
    expect(screen.queryByTestId('workflow-landing')).not.toBeInTheDocument()
  })
})

describe('RUN DETAIL ★ — graceful degradation (D3): 404 / error never white-screen', () => {
  it('404 → honest error state (role=alert), never a blank page or a crash', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    mockLivePath('GET', `/v1/runs/${RUN_ID}`, {
      status: 404,
      body: { error: { code: 'SKILL_EXEC_ERROR', message: 'Run not found.', retryable: false } },
    })

    renderWithProviders(runHarness(RUN_ID))

    // The page settles on the shared ErrorState (role=alert), surfacing the envelope
    // message — not a white screen, not the run header.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText('Run not found.')).toBeInTheDocument()
    // The run header never rendered for a missing run.
    expect(screen.queryByText(RUN_ID)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /re-run/i })).not.toBeInTheDocument()
  })

  it('a kind-tagged run MISSING its flagged/applied arrays renders the clean summary, not a throw', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    // A young backend can tag the output `kind` before the arrays/counts are
    // populated (an early/failed/partial run). The page must require the FULL shape
    // before rendering the rich tiles — a kind-only narrow would `undefined.map()`
    // the absent `flagged`/`applied` and white-screen. Here the kind is present but
    // the arrays are not, so it must fall through to the empty summary.
    mockLivePath('GET', `/v1/runs/${RUN_ID}`, {
      status: 200,
      body: { ...SERVER_RUN, output: { kind: 'mipase.daily-pricing' } },
    })

    renderWithProviders(runHarness(RUN_ID))

    // The header (and run id) still render — no throw, no white screen.
    await waitFor(() => expect(screen.getByText(RUN_ID)).toBeInTheDocument())
    // The rich tiles did NOT render (the partial payload was rejected by the narrow).
    expect(screen.queryByText('Products analyzed')).not.toBeInTheDocument()
    expect(screen.getByText(/no run summary yet/i)).toBeInTheDocument()
  })

  it('a non-pricing / output-less run renders a clean summary, not a crash', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
    // A run whose output is NOT the daily-pricing shape (or absent) must still render
    // a header + empty-summary rather than throwing — robustness as more workflows land.
    mockLivePath('GET', `/v1/runs/${RUN_ID}`, {
      status: 200,
      body: { ...SERVER_RUN, workflowId: 'some.other-workflow', output: null },
    })

    renderWithProviders(runHarness(RUN_ID))

    await waitFor(() => expect(screen.getByText(RUN_ID)).toBeInTheDocument())
    // No rich tiles (no pricing output) — but the page stood up, no white screen.
    expect(screen.queryByText('Products analyzed')).not.toBeInTheDocument()
    expect(screen.getByText(/no run summary yet/i)).toBeInTheDocument()
  })
})
