import { Suspense, lazy } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
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
  if (status === 'loading') return <LoadingState label="Loading workspace…" />
  if (status === 'access-denied') return <AccessDenied />
  if (status === 'error' || !tenant) {
    return <ErrorState title="Could not load your workspace" onRetry={refetch} />
  }
  return <Navigate to={`/${tenant.id}/approvals`} replace />
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
