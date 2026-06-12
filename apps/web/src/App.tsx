import { Suspense, lazy } from 'react'
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useRouteError,
} from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import { AccessDenied } from '@/components/auth/AccessDenied'
import { useTenantContext } from '@/providers/TenantProvider'

/**
 * Route tree (PR2b W4). The tenant-agnostic Shell mounts under `/:tenant`;
 * surfaces are lazy-loaded behind `<Suspense>`. The tenant segment is DISPLAY /
 * deep-link only — the SERVER (`/v1/tenants/me`, via TenantProvider) is the tenant
 * authority. The root `/` redirect derives from the SERVER tenant id (waiting for
 * the query), never a static default; AppShell redirects a `/:tenant` segment that
 * disagrees with the server.
 */

/**
 * Root `/` redirect (W4) — derives the landing URL from the SERVER tenant, never a
 * static `DEFAULT_TENANT`. Waits for `/v1/tenants/me`; fail-closed on 403.
 */
function RootRedirect() {
  const { tenant, status, refetch } = useTenantContext()
  const { logout } = usePrivy()
  if (status === 'loading') return <LoadingState label="Loading workspace…" />
  // Transparent auto-provision (tenant-invites Wave 2): a brief "setting up" state
  // while the single-shot claim binds this DID to its tenant, instead of an
  // access-denied flash. A claim failure resolves to 'access-denied' below.
  if (status === 'provisioning') return <LoadingState label="Setting up your workspace…" />
  if (status === 'access-denied') return <AccessDenied />
  if (status === 'error' || !tenant) {
    // Offer a sign-out escape hatch: a persistent tenant-load failure that "Try
    // again" can't fix must not strand the user (the bug they hit pre-#22 — no
    // recovery without clearing cookies).
    return (
      <ErrorState
        title="Could not load your workspace"
        onRetry={refetch}
        onSignOut={() => void logout()}
      />
    )
  }
  return <Navigate to={`/${tenant.id}/approvals`} replace />
}
/**
 * Route-level error backstop (D3 — defense in depth). React Router renders this
 * `errorElement` when a CHILD surface THROWS during render — the realistic failure
 * mode when the SPA is wired to a young backend that returns a 200 with a malformed
 * payload (a kind-tagged-but-incomplete run output, a batch-envelope artifact where
 * a row was expected, etc.). The per-surface narrows already degrade those cleanly;
 * this boundary is the systemic catch-all so a render throw degrades to a recoverable
 * ErrorState inside the shell instead of unmounting the whole app to a white screen.
 * (Query isPending/isError states are handled per-surface; only THROWS reach here.)
 */
function RouteErrorBoundary() {
  const err = useRouteError()
  return (
    <section className="space-y-6 py-8">
      <ErrorState
        title="Something went wrong on this page"
        error={{
          code: 'SKILL_EXEC_ERROR',
          message:
            err instanceof Error
              ? err.message
              : 'This page hit an unexpected error. Try reloading.',
          retryable: true,
        }}
        onRetry={() => window.location.reload()}
      />
    </section>
  )
}

const AppShell = lazy(() =>
  import('@/components/shell/AppShell').then((m) => ({ default: m.AppShell })),
)
const Approvals = lazy(() => import('@/pages/Approvals'))
const Workflows = lazy(() => import('@/pages/workflows/WorkflowsList'))
const WorkflowDetail = lazy(() => import('@/pages/workflows/DailyPricingDetail'))
const RunDetail = lazy(() => import('@/pages/runs/RunDetail'))
const Integrations = lazy(() => import('@/pages/integrations/Integrations'))
const Reports = lazy(() => import('@/pages/reports/ReportsPage'))
const ReportDetail = lazy(() => import('@/pages/reports/ReportDetailPage'))
const Settings = lazy(() => import('@/pages/settings'))
const NotFound = lazy(() => import('@/pages/NotFound'))

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootRedirect />,
  },
  {
    path: '/:tenant',
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="approvals" replace /> },
      { path: 'approvals', element: <Approvals /> },
      { path: 'workflows', element: <Workflows /> },
      { path: 'workflows/:id', element: <WorkflowDetail /> },
      { path: 'runs/:id', element: <RunDetail /> },
      { path: 'integrations', element: <Integrations /> },
      { path: 'reports', element: <Reports /> },
      { path: 'reports/:id', element: <ReportDetail /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  {
    path: '*',
    element: <NotFound />,
  },
])

/** The router root, nested as the innermost element by `AppProviders`. */
export function AppRouter() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RouterProvider router={router} />
    </Suspense>
  )
}
