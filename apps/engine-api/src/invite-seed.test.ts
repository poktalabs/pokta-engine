import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Wave 1 INVITE SEED coverage (D7 — env is a ONE-TIME insert-only bootstrap, the DB
 * is the source of truth). Two halves:
 *
 *   (A) parseInviteEmails / validateInviteEmails — pure helpers: comma-split, trim,
 *       LOWERCASE, drop blanks, dedupe; validate rejects a non-email-shaped entry.
 *   (B) seedTenantInvites — every invite bind is INSERT-ONLY (onConflictDoNothing,
 *       status='pending'); a re-seed adds no duplicate and NEVER updates/revokes an
 *       existing row; an unset env binds nothing (no wipe, no revoke).
 *
 * Hermetic: @godin-engine/db throws without DATABASE_URL on import, so it is MOCKED.
 * The mock records WHICH conflict strategy each engine_tenant_invites insert used so
 * we can prove it is insert-only (never an upsert that could overwrite/revoke).
 * drizzle-orm is mocked structurally. The workflows/integrations packages stay REAL
 * for the unrelated seed validators (not exercised here).
 */

type Row = Record<string, unknown>
const writes: {
  inviteInserts: Array<{ tenantId: string; email: string; status: string; onConflict: string }>
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
          onConflictDoNothing: async () => {
            writes.inviteInserts.push({
              tenantId: v.tenantId as string,
              email: v.email as string,
              status: v.status as string,
              onConflict: 'doNothing',
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

import { parseInviteEmails, validateInviteEmails, seedTenantInvites, type TenantSeed } from './seed-tenants'

function seed(overrides: Partial<TenantSeed> = {}): TenantSeed {
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
// (A) parseInviteEmails / validateInviteEmails
// ─────────────────────────────────────────────────────────────────────────────
describe('parseInviteEmails — split/trim/lowercase/dedupe', () => {
  it('splits on comma, trims, lowercases, drops blanks, dedupes', () => {
    expect(
      parseInviteEmails(' Alice@Example.com , bob@x.io ,, alice@example.com '),
    ).toEqual(['alice@example.com', 'bob@x.io'])
  })

  it('unset / blank → []', () => {
    expect(parseInviteEmails(undefined)).toEqual([])
    expect(parseInviteEmails('   ')).toEqual([])
  })
})

describe('validateInviteEmails — rejects a non-email-shaped entry', () => {
  it('passes valid addresses', () => {
    expect(() => validateInviteEmails(['a@b.co', 'x.y@sub.example.org'])).not.toThrow()
  })

  it('throws on an address missing a domain dot / at-sign', () => {
    expect(() => validateInviteEmails(['not-an-email'])).toThrow(/not a valid email/)
    expect(() => validateInviteEmails(['missing@domain'])).toThrow(/not a valid email/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (B) seedTenantInvites — insert-only bootstrap (D7)
// ─────────────────────────────────────────────────────────────────────────────
describe('seedTenantInvites — INSERT-ONLY bootstrap (never update/revoke)', () => {
  it('inserts a pending row per parsed email with onConflictDoNothing', async () => {
    process.env.MIPASE_INVITE_EMAILS = 'a@b.co, c@d.co'
    await seedTenantInvites(undefined, [seed()])
    expect(writes.inviteInserts).toEqual([
      { tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', onConflict: 'doNothing' },
      { tenantId: 'mi-pase', email: 'c@d.co', status: 'pending', onConflict: 'doNothing' },
    ])
  })

  it('lowercases the email it inserts (no mixed-case row)', async () => {
    process.env.MIPASE_INVITE_EMAILS = 'Owner@Mi-Pase.MX'
    await seedTenantInvites(undefined, [seed()])
    expect(writes.inviteInserts[0]?.email).toBe('owner@mi-pase.mx')
  })

  it('RE-SEED is idempotent — same insert-only statements, no update/revoke path', async () => {
    process.env.MIPASE_INVITE_EMAILS = 'a@b.co'
    await seedTenantInvites(undefined, [seed()])
    writes.inviteInserts.length = 0
    await seedTenantInvites(undefined, [seed()])
    expect(writes.inviteInserts).toEqual([
      { tenantId: 'mi-pase', email: 'a@b.co', status: 'pending', onConflict: 'doNothing' },
    ])
    // every write is insert-only — there is NO update/revoke write shape in the seed.
    expect(writes.inviteInserts.every((w) => w.onConflict === 'doNothing')).toBe(true)
  })

  it('unset env → binds NOTHING (no wipe, no revoke)', async () => {
    expect(process.env.MIPASE_INVITE_EMAILS).toBeUndefined()
    await seedTenantInvites(undefined, [seed()])
    expect(writes.inviteInserts).toHaveLength(0)
  })

  it('a tenant with a null secretPrefix is skipped', async () => {
    await seedTenantInvites(undefined, [seed({ secretPrefix: null })])
    expect(writes.inviteInserts).toHaveLength(0)
  })

  it('a malformed env email fails the seed loudly (validate)', async () => {
    process.env.MIPASE_INVITE_EMAILS = 'good@x.co, garbage'
    await expect(seedTenantInvites(undefined, [seed()])).rejects.toThrow(/not a valid email/)
  })
})
