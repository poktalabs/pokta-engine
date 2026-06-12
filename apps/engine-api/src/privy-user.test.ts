import { describe, expect, it } from 'vitest'
import type { User } from '@privy-io/server-auth'
import { verifiedEmailsOf, buildDefaultPrivyEmailResolver } from './privy-user'

/**
 * Wave 1 PRIVY VERIFIED-EMAIL seam (D2, security-critical). The extraction must
 * return ONLY Privy email-OTP-verified emails — the primary linked email and
 * `type:'email'` linked-accounts — lowercased, trimmed, deduped. `google_oauth` is
 * NOT trusted (the SDK exposes no `email_verified` claim). A self-asserted / unverified
 * account NEVER contributes. The default resolver is null when Privy is unconfigured
 * (no network in tests).
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

  it('collects email-OTP linked accounts, lowercased+trimmed', () => {
    const u = user({
      linkedAccounts: [
        { type: 'email', address: 'A@b.co' },
      ] as unknown as User['linkedAccounts'],
    })
    expect(verifiedEmailsOf(u)).toEqual(['a@b.co'])
  })

  it('DROPS google_oauth emails — SDK exposes no email_verified, so they are not trusted (D2)', () => {
    // Hardening regression (Wave 1 finding #1): a google_oauth account whose `email`
    // is an invited-but-unclaimed address must NOT reach the match set, because Privy's
    // Google type cannot prove Google verified that email. The OTP-verified email is
    // still collected; the google_oauth one is not.
    const u = user({
      email: { address: 'otp@verified.com' } as User['email'],
      linkedAccounts: [
        { type: 'google_oauth', email: 'attacker-controlled@victim.com' },
      ] as unknown as User['linkedAccounts'],
    })
    expect(verifiedEmailsOf(u)).toEqual(['otp@verified.com'])
  })

  it('a user whose ONLY email source is google_oauth → [] (no verified email)', () => {
    const u = user({
      linkedAccounts: [
        { type: 'google_oauth', email: 'GOOG@gmail.com' },
      ] as unknown as User['linkedAccounts'],
    })
    expect(verifiedEmailsOf(u)).toEqual([])
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
