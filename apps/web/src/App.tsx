import { Suspense, lazy } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { LoadingState } from '@/components/ui/LoadingState'
import { DEFAULT_TENANT } from '@/providers/TenantProvider'

/**
 * Route tree (P1-B owns this file). The tenant-agnostic Shell mounts under
 * `/:tenant`; surfaces are lazy-loaded behind `<Suspense>`. The tenant segment
 * scopes the URL — the active TenantProvider (in AppProviders) drives config /
 * theming. M2 defaults to Mi Pase; flipping the provider swaps lockup + nav with
 * zero CSS change (P4-Z).
 *
 * P2 Approvals, P3 Workflows/Runs, and P4 Integrations/Reports/Settings now
 * mount their real surfaces (from `pages/<surface>/*`) behind `<Suspense>`.
 */
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
    element: <Navigate to={`/${DEFAULT_TENANT}/approvals`} replace />,
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
