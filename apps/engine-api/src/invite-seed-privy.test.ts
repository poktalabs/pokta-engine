import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@privy-io/server-auth'

/**
 * Wave 1 — invite SEED + Privy verified-email SEAM, three concerns in one hermetic
 * file (model: app.test.ts mocks @godin-engine/db; privy-user.test.ts builds a fake
 * Privy User; invite-seed.test.ts captures the insert strategy):
 *
 *   (1) parseInviteEmails / validateInviteEmails — pure helpers: lowercase, trim,
 *       dedupe; validate THROWS on a malformed address.
 *   (2) seedTenantInvites is INSERT-ONLY — a re-seed binds the same status='pending'
 *       row via onConflictDoNothing and NEVER takes an update/revoke write path
 *       (proven by a capturing db mock that records the conflict strategy).
 *   (3) resolvePrivyEmails extraction — verifiedEmailsOf returns ONLY Privy-verified
 *       addresses (primary email + verified email/google_oauth linked accounts),
 *       lowercased+deduped, IGNORING unverified/other-type accounts; and a resolver
 *       built around an INJECTED getUser fails CLOSED (`[]`) when getUser THROWS — no
 *       network is ever hit (the getUser seam is a stub).
 *
 * Hermetic: @godin-engine/db throws without DATABASE_URL on import, so it is MOCKED;
 * the mock records each engine_tenant_invites insert's conflict strategy. drizzle-orm
 * is mocked structurally. The Privy User is a hand-built fixture and getUser is a stub
 * — no @privy-io network call.
 */

// ── (2) capturing db mock: records the conflict strategy of every invite insert ──
type Row = Record<string, unknown>
const writes: {
  inviteInserts: Array<{ tenantId: string; email: string; status: string; onConflict: 'doNothing' | 'doUpdate' }>
} = { inviteInserts: [] }

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x.filter(Boolean) }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  desc: (x: unknown) => ({ desc: x }),
  ne: (a: unknown, b: unknown) => ({ ne: [a, b] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ sql: { strings, vals } }),
    { raw: (s: unknown) => ({ raw: s }) },
  ),
}))

vi.mock('@godin-engine/db', () => {
  const insert = (table: { __table?: string } | undefined) => {
    if (table?.__table === 'engine_tenant_invites') {
      return {
        values: (v: Row) => ({
          // The ONLY shape the invite seed is allowed to use. A capturing record
          // tagged 'doNothing' so a re-seed can be asserted to never overwrite/revoke.
          onConflictDoNothing: async () => {
            writes.inviteInserts.push({
              tenantId: v.tenantId as string,
              email: v.email as string,
              status: v.status as string,
              onConflict: 'doNothing',
            })
            return undefined
          },
          // Present but tagged so a regression that switched to an UPSERT (which could
          // silently revive a revoked / overwrite a claimed row) would surface as a
          // 'doUpdate' record and fail the insert-only assertion below.
          onConflictDoUpdate: async () => {
            writes.inviteInserts.push({
              tenantId: v.tenantId as string,
              email: v.email as string,
              status: v.status as string,
              onConflict: 'doUpdate',
            })
            return undefined
          },
        }),
      }
    }
    // engine_tenants / engine_tenant_members upserts are not exercised here.
    return {
      values: () => ({
        onConflictDoUpdate: async () => undefined,
        onConflictDoNothing: async () => undefined,
      }),
    }
  }
  return {
    db: { insert },
    schema: {
      engineTenantInvites: { __table: 'engine_tenant_invites', tenantId: 'V.tenant_id', email: 'V.email' },
    },
  }
})

const { parseInviteEmails, validateInviteEmails, seedTenantInvites } = await import('./seed-tenants')
type TenantSeedT = import('./seed-tenants').TenantSeed
const { verifiedEmailsOf } = await import('./privy-user')

function seed(overrides: Partial<TenantSeedT> = {}): TenantSeedT {
  return {
    tenantId: 'mi-pase',
    name: 'Mi Pase',
    status: 'active',
    currency: 'MXN',
    locale: 'es-MX',
    branding: { name: 'Mi Pase' },
    allowedWorkflows: [],
    members: [],
    secretPrefix: 'MIPASE',
    ...overrides,
  }
}

// Minimal Privy User builder — only the fields verifiedEmailsOf reads. Cast through
// unknown since the real User shape is large.
function privyUser(partial: Partial<User>): User {
  return { id: 'did:privy:x', linkedAccounts: [], ...partial } as unknown as User
}

/**
 * A getUser-backed resolver mirroring buildDefaultPrivyEmailResolver's try/catch,
 * but built around an INJECTED getUser stub so no network is hit. A getUser throw
 * (unknown DID / network / SDK error) MUST fail closed to `[]`.
 */
function resolverFrom(getUser: (did: string) => Promise<User>): (did: string) => Promise<string[]> {
  return async (did: string) => {
    try {
      return verifiedEmailsOf(await getUser(did))
    } catch {
      return []
    }
  }
}

const ENV_KEYS = ['MIPASE_INVITE_EMAILS', 'VINO_INVITE_EMAILS']
function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k]
}

beforeEach(() => {
  writes.inviteInserts.length = 0
  clearEnv()
})
afterEach(clearEnv)

// ─────────────────────────────────────────────────────────────────────────────
// (1) parseInviteEmails / validateInviteEmails
// ─────────────────────────────────────────────────────────────────────────────
describe('parseInviteEmails — lowercase / trim / dedupe; validate rejects malformed', () => {
  it('lowercases, trims, drops blanks, and dedupes case-insensitively', () => {
    expect(parseInviteEmails('  Owner@Mi-Pase.MX , ops@x.io ,, OWNER@mi-pase.mx ,   ')).toEqual([
      'owner@mi-pase.mx',
      'ops@x.io',
    ])
  })

  it('validateInviteEmails passes valid addresses and THROWS on a bad one', () => {
    expect(() => validateInviteEmails(['a@b.co', 'x.y@sub.example.org'])).not.toThrow()
    expect(() => validateInviteEmails(['good@x.co', 'not-an-email'])).toThrow(/not a valid email/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (2) seedTenantInvites — INSERT-ONLY (a re-seed never updates/revokes)
// ─────────────────────────────────────────────────────────────────────────────
describe('seedTenantInvites — INSERT-ONLY, no update/revoke on re-seed', () => {
  it('a re-seed re-issues the same pending insert via onConflictDoNothing (never doUpdate)', async () => {
    process.env.MIPASE_INVITE_EMAILS = 'owner@x.co'

    await seedTenantInvites(undefined, [seed()])
    expect(writes.inviteInserts).toEqual([
      { tenantId: 'mi-pase', email: 'owner@x.co', status: 'pending', onConflict: 'doNothing' },
    ])

    // Re-seed (idempotent bootstrap): identical insert-only statement, no upsert.
    writes.inviteInserts.length = 0
    await seedTenantInvites(undefined, [seed()])
    expect(writes.inviteInserts).toEqual([
      { tenantId: 'mi-pase', email: 'owner@x.co', status: 'pending', onConflict: 'doNothing' },
    ])
    // The whole seed has NO update/revoke write shape — every invite write is doNothing.
    expect(writes.inviteInserts.every((w) => w.onConflict === 'doNothing')).toBe(true)
  })

  it('an unset env binds nothing — no wipe, no revoke', async () => {
    expect(process.env.MIPASE_INVITE_EMAILS).toBeUndefined()
    await seedTenantInvites(undefined, [seed()])
    expect(writes.inviteInserts).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (3) resolvePrivyEmails extraction — verified-only, fail closed on getUser throw
// ─────────────────────────────────────────────────────────────────────────────
describe('Privy verified-email extraction (verifiedEmailsOf)', () => {
  it('returns ONLY verified addresses — primary + verified email + google_oauth, ignoring others', () => {
    const u = privyUser({
      email: { address: 'Primary@Example.COM ' } as User['email'],
      linkedAccounts: [
        { type: 'email', address: 'Verified@b.co', verifiedAt: new Date() },
        { type: 'google_oauth', email: 'GOOG@gmail.com', verifiedAt: new Date() },
        // Self-asserted / non-email account types MUST be ignored.
        { type: 'wallet', address: '0xabc' },
        { type: 'phone', number: '+1555' },
        { type: 'custom_auth', customUserId: 'jwt-claim@evil.com' },
      ] as unknown as User['linkedAccounts'],
    })
    expect(verifiedEmailsOf(u).sort()).toEqual(['goog@gmail.com', 'primary@example.com', 'verified@b.co'])
  })
})

describe('resolvePrivyEmails (getUser-backed) — fail closed', () => {
  it('resolves a DID to its verified emails via the injected getUser stub (no network)', async () => {
    const getUser = vi.fn(async (_did: string) =>
      privyUser({
        linkedAccounts: [
          { type: 'email', address: 'A@b.co', verifiedAt: new Date() },
        ] as unknown as User['linkedAccounts'],
      }),
    )
    const resolve = resolverFrom(getUser)
    expect(await resolve('did:privy:abc')).toEqual(['a@b.co'])
    expect(getUser).toHaveBeenCalledWith('did:privy:abc')
  })

  it('a getUser THROW (unknown DID / network) → [] (fail closed → no match)', async () => {
    const getUser = vi.fn(async (_did: string): Promise<User> => {
      throw new Error('unknown DID')
    })
    const resolve = resolverFrom(getUser)
    expect(await resolve('did:privy:ghost')).toEqual([])
  })

  it('a user with NO verified email → [] (fail closed)', async () => {
    const getUser = vi.fn(async (_did: string) =>
      privyUser({
        linkedAccounts: [{ type: 'wallet', address: '0xabc' }] as unknown as User['linkedAccounts'],
      }),
    )
    const resolve = resolverFrom(getUser)
    expect(await resolve('did:privy:walletonly')).toEqual([])
  })
})
