import { Toaster } from 'sonner'
import { AppRouter } from '@/App'
import { PrivyAuthProvider } from '@/providers/PrivyProvider'
import { QueryProvider } from '@/providers/QueryProvider'
import { LanguageProvider } from '@/providers/LanguageProvider'
import { TenantProvider } from '@/providers/TenantProvider'

/**
 * Canonical provider composition (M2 P0 sub-decision #2). The nesting order is
 * LOCKED — later lanes fill provider bodies in their own files, never restructure
 * this tree:
 *
 *   <PrivyProvider>        // P6 — outermost so the access token is readable below
 *     <QueryProvider>      // P0 (real)
 *       <LanguageProvider> // P7
 *         <TenantProvider> // P1
 *           <RouterProvider/>
 *
 * `main.tsx` imports ONLY this component. `<Toaster>` is mounted here so the
 * global MutationCache.onError toasts have a render target.
 */
export function AppProviders() {
  return (
    <PrivyAuthProvider>
      <QueryProvider>
        <LanguageProvider>
          <TenantProvider>
            <AppRouter />
            <Toaster position="bottom-right" />
          </TenantProvider>
        </LanguageProvider>
      </QueryProvider>
    </PrivyAuthProvider>
  )
}
