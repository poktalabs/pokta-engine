import { describe, expect, it } from 'vitest'
import type { User } from '@privy-io/server-auth'
import { verifiedEmailsOf, buildDefaultPrivyEmailResolver } from './privy-user'

/**
 * Wave 1 PRIVY VERIFIED-EMAIL seam (D2, security-critical). The extraction must
 * return ONLY Privy-VERIFIED emails — the primary linked email, verified email
 * linked-accounts, and provider-verified google_oauth emails — lowercased, trimmed,
 * deduped. A self-asserted / unverified account NEVER contributes. The default
 * resolver is null when Privy is unconfigured (no network in tests).
 */

// Minimal User builder — only the fields verifiedEmailsOf reads. Cast through unknown
// since we omit the rest of the (large) Privy User shape.
function user(partial: Partial<User>): User {
  return { id: 'did:privy:x', linkedAccounts: [], ...partial } as unknown as User
}

describe('verifiedEmailsOf — verified-only extraction', () => {
  it('collects the primary linked email (user.email.address), lowercased+trimmed', () => {
    const u = user({ email: { address: '  Owner@Example.COM ' } as User['email'] })
    expect(verifiedEmailsOf(u)).toEqual(['owner@example.com'])
  })

  it('collects verified email + google_oauth linked accounts', () => {
    const u = user({
      linkedAccounts: [
        { type: 'email', address: 'A@b.co' },
        { type: 'google_oauth', email: 'GOOG@gmail.com' },
      ] as unknown as User['linkedAccounts'],
    })
    expect(verifiedEmailsOf(u).sort()).toEqual(['a@b.co', 'goog@gmail.com'])
  })

  it('dedupes across the primary email and a linked email account', () => {
    const u = user({
      email: { address: 'dup@x.io' } as User['email'],
      linkedAccounts: [{ type: 'email', address: 'DUP@x.io' }] as unknown as User['linkedAccounts'],
    })
    expect(verifiedEmailsOf(u)).toEqual(['dup@x.io'])
  })

  it('IGNORES non-verified account types (wallet, phone, custom JWT)', () => {
    const u = user({
      linkedAccounts: [
        { type: 'wallet', address: '0xabc' },
        { type: 'phone', number: '+1555' },
        { type: 'custom_auth', customUserId: 'x' },
      ] as unknown as User['linkedAccounts'],
    })
    expect(verifiedEmailsOf(u)).toEqual([])
  })

  it('a user with no email linked → []', () => {
    expect(verifiedEmailsOf(user({}))).toEqual([])
  })
})

describe('buildDefaultPrivyEmailResolver — null when unconfigured', () => {
  it('returns null when PRIVY_APP_ID/SECRET are unset (fail closed → no match)', () => {
    const id = process.env.PRIVY_APP_ID
    const secret = process.env.PRIVY_APP_SECRET
    delete process.env.PRIVY_APP_ID
    delete process.env.PRIVY_APP_SECRET
    try {
      expect(buildDefaultPrivyEmailResolver()).toBeNull()
    } finally {
      if (id !== undefined) process.env.PRIVY_APP_ID = id
      if (secret !== undefined) process.env.PRIVY_APP_SECRET = secret
    }
  })
})
