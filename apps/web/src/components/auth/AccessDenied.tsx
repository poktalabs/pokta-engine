import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'
import { BrandLockup } from '@/components/shell/BrandLockup'

/**
 * Access-denied screen (PR2b W4 / ISOLATION ★). Rendered when `GET /v1/tenants/me`
 * returns `403 TENANT_UNKNOWN` — i.e. the authenticated Privy DID is in no
 * tenant's `members[]`. This is the fail-closed terminal state: the SPA NEVER
 * falls back to a default/other tenant, and this is NOT the generic toast/refetch
 * path. The only action is to sign out (and contact ops to be provisioned).
 */
export function AccessDenied() {
  const { logout } = usePrivy()

  return (
    <main
      role="main"
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 text-center"
    >
      <BrandLockup size="lg" />
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-funnel text-2xl font-semibold text-[var(--foreground)]">
          No workspace access
        </h1>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          Your account is not provisioned for any workspace. Ask your administrator to
          add you, then sign in again.
        </p>
      </div>
      <Button onClick={() => void logout()} variant="secondary" size="lg">
        Sign out
      </Button>
    </main>
  )
}
