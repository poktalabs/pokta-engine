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
 * Later phases fill the page bodies (P2 Approvals, P3 Workflows/Runs, P4
 * Integrations/Reports/Settings) — the route shape is frozen here.
 */
const AppShell = lazy(() =>
  import('@/components/shell/AppShell').then((m) => ({ default: m.AppShell })),
)
const Approvals = lazy(() => import('@/pages/Approvals'))
const Workflows = lazy(() => import('@/pages/Workflows'))
const Integrations = lazy(() => import('@/pages/Integrations'))
const Reports = lazy(() => import('@/pages/Reports'))
const Settings = lazy(() => import('@/pages/Settings'))
const DetailPlaceholder = lazy(() => import('@/pages/DetailPlaceholder'))
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
      { path: 'workflows/:id', element: <DetailPlaceholder kind="Workflow" /> },
      { path: 'runs/:id', element: <DetailPlaceholder kind="Run" /> },
      { path: 'integrations', element: <Integrations /> },
      { path: 'reports', element: <Reports /> },
      { path: 'reports/:id', element: <DetailPlaceholder kind="Report" /> },
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
