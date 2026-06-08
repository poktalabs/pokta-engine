import { Suspense, lazy } from 'react'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'

/**
 * Route tree skeleton (P0). Pages are lazy-loaded behind `<Suspense>`; P0 ships
 * placeholder pages so the shell boots and routing works. P1-B fills the full
 * tenant-scoped tree (Shell + `/:tenant/{workflows,approvals,integrations,...}`)
 * — this file is the route owner from P1-B onward.
 */
const PlaceholderPage = lazy(() => import('@/pages/Placeholder'))

const router = createBrowserRouter([
  {
    path: '/',
    // P1-B replaces this with the tenant default redirect / Shell layout route.
    element: <Navigate to="/approvals" replace />,
  },
  {
    path: '/approvals',
    element: <PlaceholderPage title="Approvals" />,
  },
  {
    path: '/workflows',
    element: <PlaceholderPage title="Workflows" />,
  },
  {
    path: '*',
    element: <PlaceholderPage title="Not found" />,
  },
])

const RouteFallback = () => (
  <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>Loading…</div>
)

/** The router root, nested as the innermost element by `AppProviders`. */
export function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouterProvider router={router} />
    </Suspense>
  )
}
