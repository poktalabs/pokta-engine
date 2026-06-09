import { Toaster } from 'sonner'
import { AppRouter } from '@/App'
import { PrivyAuthProvider } from '@/providers/PrivyProvider'
import { AuthGate } from '@/providers/AuthGate'
import { QueryProvider } from '@/providers/QueryProvider'
import { LanguageProvider } from '@/providers/LanguageProvider'
import { TenantProvider } from '@/providers/TenantProvider'

/**
 * Canonical provider composition (M2 P0 sub-decision #2 + PR2b W2). The nesting
 * order is LOCKED:
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
 * toasts have a render target.
 */
export function AppProviders() {
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
