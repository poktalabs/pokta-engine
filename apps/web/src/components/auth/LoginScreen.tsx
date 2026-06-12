import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'

/**
 * Login screen (PR2b W2). Rendered by `AuthGate` when Privy is ready but the user
 * is unauthenticated. The single CTA opens Privy's hosted login modal via
 * `login()`; on success Privy flips `authenticated`, AuthGate re-renders, and the
 * workspace (Query/Tenant/router) mounts for the first time.
 *
 * Branded entry (tenant-invites Wave 2, D3 — UX ONLY): the login screen renders
 * PRE-router (AuthGate is above the router/TenantProvider), so a branded variant is
 * selected from `window.location.pathname`, not a route param. `/mi-pase` shows
 * Mi-Pase-branded copy; every other path shows the generic Godinez copy.
 *
 * This is PURELY COSMETIC: it passes NOTHING into the claim/auth flow, sets no
 * TenantProvider state, and is not a tenant hint or trust input. The SAME
 * `usePrivy().login()` CTA runs regardless of path.
 *
 * Intentionally minimal — this is a B2B console entry, not a marketing surface.
 */

interface LoginBrand {
  heading: string
  subcopy: string
}

/**
 * Pure, unit-testable brand selector. `/mi-pase` (and its sub-paths) → Mi-Pase
 * branding; anything else → the generic Godinez branding. UX only — derives copy,
 * never authorization.
 */
export function brandForPath(pathname: string): LoginBrand {
  if (pathname === '/mi-pase' || pathname.startsWith('/mi-pase/')) {
    return {
      heading: 'Mi Pase',
      subcopy: 'Sign in to your Mi Pase workspace.',
    }
  }
  return {
    heading: 'Godinez Workspace',
    subcopy:
      'Sign in to access your workspace. Access is limited to provisioned team members.',
  }
}

export function LoginScreen() {
  const { login } = usePrivy()
  // PRE-router: there is no route param yet, so read the raw browser path.
  const { heading, subcopy } = brandForPath(window.location.pathname)

  return (
    <main
      role="main"
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 text-center"
    >
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-funnel text-2xl font-semibold text-[var(--foreground)]">
          {heading}
        </h1>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">{subcopy}</p>
      </div>
      <Button onClick={() => login()} size="lg">
        Sign in
      </Button>
    </main>
  )
}
