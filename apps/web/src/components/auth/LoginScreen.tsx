import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'

/**
 * Login screen (PR2b W2). Rendered by `AuthGate` when Privy is ready but the user
 * is unauthenticated. The single CTA opens Privy's hosted login modal via
 * `login()`; on success Privy flips `authenticated`, AuthGate re-renders, and the
 * workspace (Query/Tenant/router) mounts for the first time.
 *
 * Intentionally minimal — this is a B2B console entry, not a marketing surface.
 */
export function LoginScreen() {
  const { login } = usePrivy()

  return (
    <main
      role="main"
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 text-center"
    >
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-funnel text-2xl font-semibold text-[var(--foreground)]">
          Godinez Workspace
        </h1>
        <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
          Sign in to access your workspace. Access is limited to provisioned team members.
        </p>
      </div>
      <Button onClick={() => login()} size="lg">
        Sign in
      </Button>
    </main>
  )
}
