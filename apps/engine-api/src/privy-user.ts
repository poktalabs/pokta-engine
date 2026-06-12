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
 *
 * VERIFIED = Privy email-OTP channels ONLY (the primary `user.email` + `type:'email'`
 * linked accounts). `google_oauth` is excluded because the server-auth SDK does not
 * expose Google's `email_verified` claim — see `verifiedEmailsOf` below.
 */

/** Injectable seam: DID → the user's Privy-VERIFIED, lowercased+trimmed, deduped emails. */
export type ResolvePrivyEmails = (did: string) => Promise<string[]>

/**
 * Extract ONLY Privy-VERIFIED email addresses from a Privy `User`, lowercased,
 * trimmed and deduped. The accepted sources (D2) are the Privy email-OTP channels:
 *   - `user.email.address` — the primary linked email (Privy email-OTP verifies it),
 *   - every `linkedAccounts` entry of `type === 'email'` (`.address`) — email-OTP
 *     linked accounts.
 *
 * `google_oauth` is DELIBERATELY EXCLUDED (Wave 1 hardening / D2). The server-auth
 * SDK `Google` type is `{ subject, email, name }` (public-DTbbnwMV.d.ts:99) — it does
 * NOT surface Google's `email_verified` ID-token claim, so this code cannot tell a
 * Google-verified email from a Google-UNVERIFIED one (federated / Workspace-delegated
 * / externally-managed accounts can carry an unconfirmed `email`). Trusting it would
 * let a non-OTP-verified address reach the invite match set and auto-join a tenant,
 * violating the 'self-asserted/unverified email NEVER matches' invariant. If Google
 * OAuth is ever needed for invite matching, fetch `email_verified` from Privy's
 * identity-token / raw OAuth claims and require it `=== true` before adding the email.
 *
 * TRUST BOUNDARY CAVEAT (D2 / operator path): `type:'email'` presence equals VERIFIED
 * only under normal email-OTP login/link. Privy's import/create API
 * (`privy.users().create({ linked_accounts: [{ type:'email', address }] })`) attaches
 * an email account WITHOUT an OTP round-trip, and such an imported account is
 * indistinguishable here from an OTP-verified one. That is a PRIVILEGED path (it
 * requires `PRIVY_APP_SECRET` / the import flow), accepted as a deliberate
 * operator-trust boundary — there is no remote-attacker exposure as deployed (Mi Pase
 * seeds invites, it does not import Privy users). If user import/migration is ever
 * enabled, gate on a verification signal rather than mere `type:'email'` presence.
 *
 * Self-asserted / unverified accounts (custom JWT email claims, wallet, phone, OAuth
 * providers, etc.) are NEVER collected. An empty/whitespace address is dropped.
 */
export function verifiedEmailsOf(user: User): string[] {
  const out = new Set<string>()
  const add = (raw: string | undefined | null) => {
    const email = raw?.trim().toLowerCase()
    if (email) out.add(email)
  }

  // The primary linked email (Privy email-OTP verified).
  add(user.email?.address)

  // Email-OTP linked accounts only. google_oauth is excluded — see docstring (the SDK
  // does not expose Google's email_verified claim, so it cannot be trusted as verified).
  for (const acct of user.linkedAccounts ?? []) {
    if (acct.type === 'email') add(acct.address)
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
