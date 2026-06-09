import type { ReactNode } from 'react'
import { PrivyProvider, type PrivyClientConfig } from '@privy-io/react-auth'

/**
 * Auth boundary (PR2b W1) — the REAL `@privy-io/react-auth` `<PrivyProvider>`,
 * configured as a B2B console:
 *
 *   - NO embedded-wallet auto-create. Bound to the installed 3.29.2 config shape
 *     (`embeddedWallets.ethereum.createOnLogin` / `.solana.createOnLogin`), both
 *     set to `'off'` (the SDK default is already `'off'`, but we pin it explicitly
 *     so a server-config change can never silently start minting wallets on login).
 *   - NO wagmi / external-wallet connectors — this app authenticates people into a
 *     workspace; it never signs transactions.
 *
 * It MUST remain the OUTERMOST provider (above QueryProvider) so the Privy access
 * token is readable by everything below it — W3 registers `getAccessToken` into
 * the api.ts token bridge from a component mounted under here. Do not reorder.
 *
 * `VITE_PRIVY_APP_ID` is build-time env (placeholder in `.env.example`; the real
 * id is env-only, never committed). The login UI itself is driven by `AuthGate`
 * (W2), which sits just inside this provider.
 */
const PRIVY_CONFIG: PrivyClientConfig = {
  embeddedWallets: {
    // B2B console: never auto-provision a wallet on login.
    ethereum: { createOnLogin: 'off' },
    solana: { createOnLogin: 'off' },
  },
}

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const appId = import.meta.env.VITE_PRIVY_APP_ID ?? ''
  return (
    <PrivyProvider appId={appId} config={PRIVY_CONFIG}>
      {children}
    </PrivyProvider>
  )
}
