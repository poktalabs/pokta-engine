import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  renderWithProviders,
  setPrivyState,
} from '@/test'
import type {
  ApprovalView,
  ApproveResponse,
  ErrorEnvelope,
  RejectResponse,
  TenantView,
} from '@pokta-engine/contract'
import Approvals from './Approvals'

/**
 * APPROVALS LIVE-WIRE (P5b Wave 2).
 *
 * The Approvals surface is now wired off the Wave-1 read model: it lists
 * `GET /v1/approvals` and POSTs `/v1/approvals/:id/approve | /reject` per decided
 * id, branching on `ApiError.code` so a denied/already-decided item degrades into
 * a per-item partial failure instead of a thrown crash.
 *
 * These tests bind to the LIVE half of `api.ts`: the spine added `/v1/approvals`
 * (exact) and `^/v1/approvals/[^/]+/(approve|reject)$` (pattern) to `LIVE_PATHS`,
 * so even under the jsdom `VITE_USE_MOCKS=true` pin these paths bypass the mock
 * registry and hit `global.fetch`. We therefore stub `fetch` (NOT the mock
 * registry) via `mockLivePath` and assert against `capturedRequests` — exactly
 * the reauth/tenant-provider pattern.
 *
 * Renderer choice: the page selects its renderer from the items' `workflowId`
 * domain (`mipase*` → the virtualized batch grid, else → the focused single-action
 * card). We use `vino.*` items so the single-action renderer mounts — its per-card
 * Approve/Reject buttons map 1:1 to a single approval id, which is what lets us
 * assert that one click fires exactly one POST against that id's live path.
 *
 * IMPORTANT (no-mock-render guard): this file imports NO `MOCK_*` value from
 * `@/mocks` — the fixtures below are hand-built from `@pokta-engine/contract`
 * types. The production page carries no mock value-import either (that is the
 * point of the spine).
 */

// Privy cannot boot in jsdom — replace the SDK with the shared controllable mock.
vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

/** TenantProvider hydrates from this live `/v1/tenants/me` (renderWithProviders mounts it). */
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
 * Two pending single-action (`vino.*`) approvals. The artifact shape matches what
 * `SingleActionRenderer` narrows (`kind` / `what` / `where` / `risk` / `preview`),
 * so each renders a focused card with its own Approve/Reject buttons.
 */
function vinoApproval(approvalId: string, what: string): ApprovalView {
  return {
    approvalId,
    sourceRunId: `run-${approvalId}`,
    workflowId: 'vino.email-send',
    state: 'pending',
    createdAt: '2026-06-01T12:00:00.000Z',
    artifact: {
      kind: 'vino.email-send',
      what,
      where: 'Gmail · studio inbox',
      risk: 'medium',
      preview: 'Hi — following up on your kitchen remodel estimate…',
    },
  }
}

const APPROVALS: ApprovalView[] = [
  vinoApproval('apr-1', 'Send follow-up email'),
  vinoApproval('apr-2', 'Send proposal reminder'),
]

/** Build the REAL wrapped wire error body `{ error: { code, message, retryable } }` (mirrors reauth.test.tsx). */
function errBody(
  code: ErrorEnvelope['code'],
  message: string = code,
  retryable = false,
): { error: ErrorEnvelope } {
  return { error: { code, message, retryable } }
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'test-privy-jwt' })
  // TenantProvider's live /v1/tenants/me — present in every case so the provider
  // resolves and the page mounts. Each test registers its own /v1/approvals* routes.
  mockLivePath('GET', '/v1/tenants/me', { status: 200, body: MI_PASE_VIEW })
})

/** Filter the captured live requests down to a single METHOD + exact pathname. */
function liveCalls(method: string, pathname: string) {
  return capturedRequests.filter(
    (r) => r.method === method && (r.path.split('?')[0] ?? r.path) === pathname,
  )
}

describe('APPROVALS LIVE — GET /v1/approvals real list (no mock registry)', () => {
  it('renders the pending items fetched from the live read model', async () => {
    const listResponse = { approvals: APPROVALS }
    mockLivePath('GET', '/v1/approvals', { status: 200, body: listResponse })

    renderWithProviders(<Approvals />)

    // The two server-fed cards render (single-action renderer).
    await waitFor(() => {
      expect(screen.getByText('Send follow-up email')).toBeInTheDocument()
    })
    expect(screen.getByText('Send proposal reminder')).toBeInTheDocument()

    // The list hit the network as a LIVE path — NOT served from the mock registry.
    const listCalls = liveCalls('GET', '/v1/approvals')
    expect(listCalls.length).toBeGreaterThanOrEqual(1)
    // Tenant authority is the JWT only — no ?tenant= leaks onto the live path.
    expect(listCalls[0]?.path).not.toContain('tenant=')
    expect(listCalls[0]?.headers.authorization).toBe('Bearer test-privy-jwt')
    expect(listCalls[0]?.headers['x-service-key']).toBeUndefined()
  })

  it('renders the empty state when the live list resolves to no approvals', async () => {
    mockLivePath('GET', '/v1/approvals', { status: 200, body: { approvals: [] } })

    renderWithProviders(<Approvals />)

    await waitFor(() => {
      expect(screen.getByText(/nothing to approve/i)).toBeInTheDocument()
    })
    // Still came from the live path (not the mock registry).
    expect(liveCalls('GET', '/v1/approvals').length).toBeGreaterThanOrEqual(1)
  })

  it('renders the error state when the live list fails', async () => {
    // A NON-retryable failure so it's terminal on the first attempt (a retryable
    // 5xx would be re-sent by apiFetch's own backoff budget before surfacing).
    mockLivePath('GET', '/v1/approvals', {
      status: 404,
      body: errBody('SKILL_NOT_FOUND', 'no approvals route', false),
    })

    renderWithProviders(<Approvals />)

    // ErrorState surfaces (useApprovals is retry:false so a failure is terminal) —
    // the loading spinner is replaced by the error heading.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    })
    expect(screen.queryByText(/loading approvals/i)).not.toBeInTheDocument()
  })
})

describe('APPROVALS LIVE — a mipase batch-envelope artifact does not white-screen the queue', () => {
  it('a mipase.* approval whose artifact is the BATCH ENVELOPE (not a flat row) renders an honest cell, not a crash', async () => {
    // The page selects the batch renderer purely by `workflowId` domain (mipase*),
    // with NO artifact-shape check. The backend serves the raw draft output as the
    // approval artifact — for daily-pricing that is the BATCH ENVELOPE
    // `{kind, target, rows}`, NOT the flattened single row the renderer expects.
    // A blind `artifact as BatchPricingRow` + `row.product.length` would
    // `undefined.length` → throw → white screen. The hardened `rowOf` narrows and
    // renders an "Unrecognized artifact" cell instead; the surface stays mounted.
    const envelopeApproval: ApprovalView = {
      approvalId: 'apr_mipase_batch_001',
      sourceRunId: 'run_pricing_draft_9001',
      workflowId: 'mipase.daily-pricing',
      state: 'pending',
      createdAt: '2026-06-08T12:00:00.000Z',
      artifact: {
        kind: 'mipase.daily-pricing',
        target: { channel: 'shopify', store: 'mi-pase-test', testStore: true },
        analyzedCount: 1284,
        autoAppliedCount: 248,
        rows: [{ id: 'row-1', product: 'Apple iPhone 15 Pro', currentPrice: 25999 }],
      },
    }
    mockLivePath('GET', '/v1/approvals', {
      status: 200,
      body: { approvals: [envelopeApproval] },
    })

    renderWithProviders(<Approvals />)

    // The batch renderer mounted (mipase domain) and the page did NOT throw. The
    // batch action bar (rendered unconditionally, OUTSIDE the windowed `Virtuoso`
    // body) proves the page stood up on a malformed envelope artifact. NOTE: the
    // per-ROW crash guard (`BatchRow` on a non-row artifact) is exercised directly
    // in BatchApprovalRenderer.unrecognized.test.tsx — `Virtuoso` does not lay out
    // rows in jsdom, so the row body can't be asserted through the page here.
    await waitFor(() => {
      expect(screen.getByText(/flagged rows selected/i)).toBeInTheDocument()
    })
    // The surface itself is still mounted (no thrown render → no white screen).
    expect(screen.getByRole('heading', { name: /approvals/i })).toBeInTheDocument()
    // It came from the live path, not the mock registry.
    expect(liveCalls('GET', '/v1/approvals').length).toBeGreaterThanOrEqual(1)
  })
})

describe('APPROVALS LIVE — approve fires POST /v1/approvals/:id/approve', () => {
  it('clicking a card Approve POSTs the live approve path for that id (real mutation, not the mock registry)', async () => {
    // Both pending ids are approve-able; register both POST routes so whichever the
    // frame includes in the decision resolves. The invariant under test is that
    // Approve fires the LIVE approve mutation — proven via capturedRequests.
    mockLivePath('GET', '/v1/approvals', { status: 200, body: { approvals: APPROVALS } })
    const approve1: ApproveResponse = { approvalId: 'apr-1', state: 'approved', runId: 'run-child-1' }
    const approve2: ApproveResponse = { approvalId: 'apr-2', state: 'approved', runId: 'run-child-2' }
    mockLivePath('POST', '/v1/approvals/apr-1/approve', { status: 200, body: approve1 })
    mockLivePath('POST', '/v1/approvals/apr-2/approve', { status: 200, body: approve2 })

    const user = userEvent.setup()
    renderWithProviders(<Approvals />)

    await waitFor(() => expect(screen.getByText('Send follow-up email')).toBeInTheDocument())

    // The first card's Approve button (per-card single-action affordance).
    const approveButtons = await screen.findAllByRole('button', { name: /^approve/i })
    await user.click(approveButtons[0]!)

    // The live approve mutation fired for apr-1 (the clicked card) …
    await waitFor(() => {
      expect(liveCalls('POST', '/v1/approvals/apr-1/approve')).toHaveLength(1)
    })
    // … carrying the JWT bearer, never the machine X-Service-Key (browser is JWT-only).
    const call = liveCalls('POST', '/v1/approvals/apr-1/approve')[0]!
    expect(call.headers.authorization).toBe('Bearer test-privy-jwt')
    expect(call.headers['x-service-key']).toBeUndefined()
  })
})

describe('APPROVALS LIVE — reject fires POST /v1/approvals/:id/reject', () => {
  it('a single card Reject POSTs the live reject path for exactly that id', async () => {
    mockLivePath('GET', '/v1/approvals', { status: 200, body: { approvals: APPROVALS } })
    const rejectBody: RejectResponse = { approvalId: 'apr-1', state: 'rejected' }
    mockLivePath('POST', '/v1/approvals/apr-1/reject', { status: 200, body: rejectBody })

    const user = userEvent.setup()
    renderWithProviders(<Approvals />)

    await waitFor(() => expect(screen.getByText('Send follow-up email')).toBeInTheDocument())

    const rejectButtons = await screen.findAllByRole('button', { name: /^reject/i })
    await user.click(rejectButtons[0]!)

    await waitFor(() => {
      expect(liveCalls('POST', '/v1/approvals/apr-1/reject')).toHaveLength(1)
    })
    // No approve was issued, and apr-2 was untouched.
    expect(liveCalls('POST', '/v1/approvals/apr-1/approve')).toHaveLength(0)
    expect(liveCalls('POST', '/v1/approvals/apr-2/reject')).toHaveLength(0)
  })
})

describe('APPROVALS LIVE — APPROVAL_DENIED (409) surfaces by ApiError.code, not a crash', () => {
  it('an approve that 409s APPROVAL_DENIED is recorded as a failed item, not thrown — surface survives', async () => {
    // The post-decision refetch of /v1/approvals (invalidateQueries) eventually
    // resets the frame's transient partial-failure state, so the durable invariant
    // we assert is: the denied POST fired exactly once, branched on its envelope
    // CODE (not status), and the page did NOT crash (the Approvals surface is still
    // mounted). A single never-resolving refetch keeps the partial-failure UI long
    // enough to also observe the "Retry failed" affordance deterministically.
    let listCall = 0
    mockLivePath('GET', '/v1/approvals', () => {
      listCall += 1
      // First load returns the worklist; the post-decision refetch never settles
      // (a pending promise) so it cannot clobber the partial-failure UI we assert.
      if (listCall === 1) return { status: 200, body: { approvals: APPROVALS } }
      return new Promise(() => {}) as never
    })
    mockLivePath('POST', '/v1/approvals/apr-1/approve', {
      status: 409,
      body: errBody('APPROVAL_DENIED', 'Already decided.'),
    })
    // The frame's approve decision may include the sibling id (it derives the
    // decision from the full selection); give it a clean route so the unregistered
    // -live-path guard never throws. Only apr-1's denial is the subject here.
    const approve2: ApproveResponse = { approvalId: 'apr-2', state: 'approved', runId: 'run-child-2' }
    mockLivePath('POST', '/v1/approvals/apr-2/approve', { status: 200, body: approve2 })

    const user = userEvent.setup()
    renderWithProviders(<Approvals />)

    await waitFor(() => expect(screen.getByText('Send follow-up email')).toBeInTheDocument())

    const approveButtons = await screen.findAllByRole('button', { name: /^approve/i })
    await user.click(approveButtons[0]!)

    // Durable: the denied id was attempted exactly once on its live path …
    await waitFor(() => {
      expect(liveCalls('POST', '/v1/approvals/apr-1/approve')).toHaveLength(1)
    })
    // … the frame surfaced the universal Retry-failed affordance (partial failure,
    // not a thrown crash) …
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry failed/i })).toBeInTheDocument()
    })
    // … and the Approvals surface itself is still mounted (no error boundary / throw).
    expect(screen.getByRole('heading', { name: /approvals/i })).toBeInTheDocument()
  })
})

describe('APPROVALS LIVE — per-id failures stay isolated (branch on ApiError.code, no cross-contamination)', () => {
  it('a denied reject (409) flags that id as a partial failure while a sibling id still POSTs cleanly', async () => {
    // First load returns the worklist; post-decision refetches hang (pending) so the
    // transient partial-failure UI + the original cards stay observable across both
    // clicks (the production page refetches on every decision via invalidateQueries).
    let listCall = 0
    mockLivePath('GET', '/v1/approvals', () => {
      listCall += 1
      if (listCall === 1) return { status: 200, body: { approvals: APPROVALS } }
      return new Promise(() => {}) as never
    })

    // The page's onDecision POSTs per id and collects failures into a PartialFailure
    // (it branches on ApiError.code, never on status). apr-1's reject is denied
    // (409 APPROVAL_DENIED) → recorded as a failed id, NOT thrown; apr-2's reject is
    // clean. Single-action decisions are per card, so each click is its own decision.
    mockLivePath('POST', '/v1/approvals/apr-1/reject', {
      status: 409,
      body: errBody('APPROVAL_DENIED', 'Already decided.'),
    })
    const okReject: RejectResponse = { approvalId: 'apr-2', state: 'rejected' }
    mockLivePath('POST', '/v1/approvals/apr-2/reject', { status: 200, body: okReject })

    const user = userEvent.setup()
    renderWithProviders(<Approvals />)

    await waitFor(() => expect(screen.getByText('Send follow-up email')).toBeInTheDocument())

    // Reject the failing card first → its denied id degrades to a partial failure.
    const rejectButtons = await screen.findAllByRole('button', { name: /^reject/i })
    await user.click(rejectButtons[0]!)

    await waitFor(() => {
      expect(liveCalls('POST', '/v1/approvals/apr-1/reject')).toHaveLength(1)
    })
    // The denied id surfaced "Retry failed" rather than crashing the surface.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry failed/i })).toBeInTheDocument()
    })
    // The failure did not contaminate the sibling: apr-2 was never POSTed by this click.
    expect(liveCalls('POST', '/v1/approvals/apr-2/reject')).toHaveLength(0)

    // After the page refetches the worklist, the clean sibling id is still reject-able
    // and POSTs its own isolated live path.
    const rejectAfter = await screen.findAllByRole('button', { name: /^reject/i })
    await user.click(rejectAfter[rejectAfter.length - 1]!)
    await waitFor(() => {
      expect(liveCalls('POST', '/v1/approvals/apr-2/reject')).toHaveLength(1)
    })
  })
})
