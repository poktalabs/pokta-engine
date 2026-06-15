import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'
import { BrandLockup } from '@/components/shell/BrandLockup'

/**
 * Login screen (PR2b W2). Rendered by `AuthGate` when Privy is ready but the user
 * is unauthenticated. The single CTA opens Privy's hosted login modal via
 * `login()`; on success Privy flips `authenticated`, AuthGate re-renders, and the
 * workspace (Query/Tenant/router) mounts for the first time.
 *
 * Branded entry (tenant-invites Wave 2, D3 — UX ONLY): the login screen renders
 * PRE-router (AuthGate is above the router/TenantProvider), so a branded variant is
 * selected from `window.location.pathname`, not a route param. The PoktaEngine
 * product lockup is always shown; `/mi-pase` adds Mi-Pase-specific copy beneath it,
 * every other path shows the generic workspace copy.
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
 * copy; anything else → the generic workspace copy. The PoktaEngine product
 * lockup is rendered above this regardless of path. UX only — derives copy,
 * never authorization.
 */
export function brandForPath(pathname: string): LoginBrand {
  if (pathname === '/mi-pase' || pathname.startsWith('/mi-pase/')) {
    return {
      heading: 'Sign in to Mi Pase',
      subcopy: 'Access your Mi Pase workspace. Sign in with your authorized email.',
    }
  }
  return {
    heading: 'Sign in to your workspace',
    subcopy:
      'Access is limited to provisioned team members. Sign in with your authorized email.',
  }
}

/**
 * Public demo URL (the engine-api's server-rendered `/demo`). Prefer an explicit
 * `VITE_DEMO_URL` (e.g. a future demo.pokta.xyz); otherwise derive it from the API
 * base. Empty when neither is set (mock-only local dev) → the link is hidden.
 */
export function resolveDemoUrl(): string {
  const explicit = import.meta.env.VITE_DEMO_URL as string | undefined
  if (explicit) return explicit.replace(/\/$/, '')
  const api = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
  return api ? `${api}/demo` : ''
}

export function LoginScreen() {
  const { login } = usePrivy()
  // PRE-router: there is no route param yet, so read the raw browser path.
  const { heading, subcopy } = brandForPath(window.location.pathname)
  const demoUrl = resolveDemoUrl()

  return (
    <main
      role="main"
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 text-center"
    >
      <BrandLockup size="lg" />
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-funnel text-2xl font-semibold text-[var(--foreground)]">
          {heading}
        </h1>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">{subcopy}</p>
      </div>
      <div className="flex flex-col items-center gap-4">
        <Button onClick={() => login()} size="lg">
          Sign in
        </Button>
        {demoUrl && (
          // No account? See the engine run end-to-end on a sample workspace.
          <a
            href={demoUrl}
            className="text-sm font-medium text-[var(--accent-text)] underline-offset-4 hover:underline"
          >
            Check the demo →
          </a>
        )}
      </div>
    </main>
  )
}
