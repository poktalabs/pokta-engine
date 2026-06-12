import { PrivyClient } from '@privy-io/server-auth'
import type { User } from '@privy-io/server-auth'

/**
 * The Privy verified-email seam (Wave 1 / D2, security-critical). Resolves a Privy
 * DID to the set of email addresses Privy has VERIFIED for that user, server-side
 * via `getUser(did)` (`PRIVY_APP_SECRET` lives on engine-api). The invite claim path
 * matches ONLY these addresses against `engine_tenant_invites`, so a self-asserted /
 * unverified email NEVER provisions a tenant.
 *
 * This module mirrors auth.ts's injectable `verifyPrivyToken` seam: the route gets a
 * `ResolvePrivyEmails` function, defaulted to the real `getUser` implementation but
 * OVERRIDABLE in tests (so no network/JWKS is hit). A `getUser` throw or a user with
 * no verified email resolves to `[]` (fail closed → no match → TENANT_UNKNOWN).
 */

/** Injectable seam: DID → the user's Privy-VERIFIED, lowercased+trimmed, deduped emails. */
export type ResolvePrivyEmails = (did: string) => Promise<string[]>

/**
 * Extract ONLY Privy-VERIFIED email addresses from a Privy `User`, lowercased,
 * trimmed and deduped. The verified sources (D2):
 *   - `user.email.address` — the primary linked email (Privy email-OTP verifies it),
 *   - every `linkedAccounts` entry of `type === 'email'` (`.address`) — verified
 *     email accounts,
 *   - every `linkedAccounts` entry of `type === 'google_oauth'` (`.email`) —
 *     provider-verified OAuth email.
 * Self-asserted / unverified accounts (custom JWT email claims, etc.) are NEVER
 * collected. An empty/whitespace address is dropped.
 */
export function verifiedEmailsOf(user: User): string[] {
  const out = new Set<string>()
  const add = (raw: string | undefined | null) => {
    const email = raw?.trim().toLowerCase()
    if (email) out.add(email)
  }

  // The primary linked email (Privy-verified).
  add(user.email?.address)

  // Verified email + Google-OAuth accounts in the linked-accounts list.
  for (const acct of user.linkedAccounts ?? []) {
    if (acct.type === 'email') add(acct.address)
    else if (acct.type === 'google_oauth') add(acct.email)
  }

  return [...out]
}

/**
 * Build the default `getUser`-backed resolver from env (PRIVY_APP_ID/PRIVY_APP_SECRET),
 * mirroring auth.ts's `buildDefaultPrivyVerifier`. Returns `null` when Privy is NOT
 * configured — the route then treats every claim as no-match (fail closed). A
 * `getUser` throw (network / unknown DID) or a user with no verified email → `[]`.
 */
export function buildDefaultPrivyEmailResolver(): ResolvePrivyEmails | null {
  const appId = process.env.PRIVY_APP_ID?.trim()
  const appSecret = process.env.PRIVY_APP_SECRET?.trim()
  if (!appId || !appSecret) return null
  const client = new PrivyClient(appId, appSecret)
  return async (did: string) => {
    try {
      const user = await client.getUser(did)
      return verifiedEmailsOf(user)
    } catch {
      // unknown DID / network / SDK error → fail closed (no verified email).
      return []
    }
  }
}
