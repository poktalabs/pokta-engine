import { Suspense, lazy } from 'react'
import { Toaster } from 'sonner'
import { AppRouter } from '@/App'
import { PrivyAuthProvider } from '@/providers/PrivyProvider'
import { AuthGate } from '@/providers/AuthGate'
import { QueryProvider } from '@/providers/QueryProvider'
import { LanguageProvider } from '@/providers/LanguageProvider'
import { TenantProvider } from '@/providers/TenantProvider'
import { LoadingState } from '@/components/ui/LoadingState'

/**
 * The PUBLIC demo (`/demo`) lives OUTSIDE the auth tree — no Privy, no login, no
 * tenant query — because it drives the engine's OPEN `demo` tenant via the
 * unauthenticated `/demo/api/*` surface. Lazy so it stays out of the authenticated
 * app's bundle. Selected pre-router by raw path, mirroring how `LoginScreen` reads
 * `window.location.pathname` (the router below only mounts for the authed app).
 */
const DemoPage = lazy(() => import('@/pages/demo/DemoPage'))

function isDemoPath(): boolean {
  return (
    window.location.pathname === '/demo' || window.location.pathname.startsWith('/demo/')
  )
}

/**
 * Canonical provider composition (M2 P0 sub-decision #2 + PR2b W2). The AUTHED
 * nesting order is LOCKED:
 *
 *   <PrivyProvider>          // outermost — the Privy access token is readable below
 *     <AuthGate>             // W2 — login gate; NOTHING below mounts until authed
 *       <QueryProvider>      // real (TanStack)
 *         <LanguageProvider> // i18n
 *           <TenantProvider> // fetches /v1/tenants/me (W4)
 *             <RouterProvider/>
 *
 * `AuthGate` sits between Privy and Query so no query — and therefore no `/v1`
 * call — can mount before the user is authenticated. `main.tsx` imports ONLY this
 * component. `<Toaster>` is mounted here so the global MutationCache.onError
 * toasts have a render target. The public `/demo` branch is a sibling ABOVE this
 * locked tree and does not alter it.
 */
export function AppProviders() {
  if (isDemoPath()) {
    return (
      <Suspense fallback={<LoadingState />}>
        <DemoPage />
      </Suspense>
    )
  }
  return (
    <PrivyAuthProvider>
      <AuthGate>
        <QueryProvider>
          <LanguageProvider>
            <TenantProvider>
              <AppRouter />
              <Toaster position="bottom-right" />
            </TenantProvider>
          </LanguageProvider>
        </QueryProvider>
      </AuthGate>
    </PrivyAuthProvider>
  )
}
