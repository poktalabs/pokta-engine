import type { ReactNode } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { LoadingState } from '@/components/ui/LoadingState'
import { LoginScreen } from '@/components/auth/LoginScreen'
import { AuthTokenBridge } from '@/providers/AuthTokenBridge'

/**
 * Login gate (PR2b W2). Sits INSIDE `<PrivyProvider>` and ABOVE everything else
 * (Query/Language/Tenant + the router). Branching here is what guarantees NO query
 * — and therefore no `/v1` call — mounts before the user is authenticated:
 *
 *   - `!ready`        → Privy SDK still booting → a loading state (never a flash of
 *                       the login screen, then the app).
 *   - `!authenticated`→ the login screen (Privy's `login()` modal). `children`
 *                       (Query/Tenant/router) are NOT rendered, so `/tenants/me`
 *                       and every mocked surface stay unmounted.
 *   - authenticated   → pass-through: render `children`. Only now does
 *                       TenantProvider mount and fetch `/v1/tenants/me`.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy()

  if (!ready) return <LoadingState label="Loading…" />
  if (!authenticated) return <LoginScreen />
  // Authenticated: register the token getter (W3) THEN mount the app. The bridge
  // sits above the children so `getAuthToken()` is wired before any query fires.
  return (
    <>
      <AuthTokenBridge />
      {children}
    </>
  )
}
