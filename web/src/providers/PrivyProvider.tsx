import type { ReactNode } from 'react'

/**
 * Auth boundary — STUB for P0 (passthrough). Filled in P6 with the real
 * `@privy-io/react-auth` `<PrivyProvider>` (B2B console: embedded-wallet
 * auto-create disabled, no wagmi). It MUST remain the OUTERMOST provider so the
 * Privy access token is readable by everything below it (QueryProvider →
 * apiFetch token injection). Do not reorder.
 */
export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
