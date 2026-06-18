import { describe, expect, it, vi, beforeEach } from 'vitest'
import { listIntegrations } from '@pokta-engine/integrations'

/**
 * INTEGRATION SEED (P5b) — unit-tests the pure seed logic in `seed-tenants.ts`:
 *   - `parseIntegrationSeed`        — env parser (`shopify:enabled,...` → entries),
 *   - `validateIntegrationSeeds`    — registry + status validator (THROWS),
 *   - `seedTenantIntegrations`      — idempotent upsert + disable-not-delete semantics.
 *
 * MOCKING POSTURE (matches the canonical engine-api pattern in
 * {tenants-me,isolation}.test.ts): the @pokta-engine/db client throws on import
 * without DATABASE_URL, so it is ALWAYS mocked — but only to hand back `schema`
 * sentinels (the parser/validator never touch the DB; `seedTenantIntegrations`
 * runs against a SMALL IN-MEMORY FAKE db we pass in explicitly). drizzle-orm is
 * mocked to return inspectable tokens so the fake can interpret the upsert/where
 * clauses without a real Postgres. We DO NOT mock @pokta-engine/integrations — the
 * validator exercises the REAL `listIntegrations()` registry (like tenants-me does
 * for the workflow registry), so "rejects an id not in the registry" and "accepts
 * the real ids" are real assertions, not tautologies.
 */

// ── @pokta-engine/db: only `schema.engineTenantIntegrations` is needed (sentinel) ─
vi.mock('@pokta-engine/db', () => ({
  db: {}, // never used: seedTenantIntegrations always gets an explicit fake db
  schema: {
    engineTenantIntegrations: {
      tenantId: 'tenant_id',
      integrationId: 'integration_id',
      status: 'status',
      connectedAt: 'connected_at',
    },
    // engineTenants is referenced by seedTenants()/validateSeeds() at module load.
    engineTenants: { tenantId: 'tenant_id', members: 'members' },
  },
}))

// ── @pokta-engine/queue: app.ts is not imported here, but keep parity / safe ─────
vi.mock('@pokta-engine/queue', () => ({
  getBoss: async () => ({ send: async () => undefined }),
  QUEUE: 'workflow.run',
}))

/**
 * drizzle-orm helpers → inspectable tokens (no real SQL). The seed code calls:
 *   - sql`...`           — for the connected_at CASE / now() / status=excluded,
 *   - eq(col, val)       — `eq(I.tenantId, t.tenantId)`,
 *   - and(...preds)      — the disable WHERE,
 *   - inArray(col, vals) — `inArray(I.integrationId, toDisable)`.
 * The fake db's `where()` interprets `{ eq }` / `{ and: [...] }` to pick rows.
 */
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...x: unknown[]) => ({ and: x }),
  inArray: (col: unknown, vals: unknown) => ({ inArray: [col, vals] }),
  sql: Object.assign((s: TemplateStringsArray, ...vals: unknown[]) => ({ sql: s.join('?'), vals }), {
    raw: () => ({}),
  }),
}))

// Import AFTER the mocks.
import type { TenantSeed } from './seed-tenants'
const { parseIntegrationSeed, validateIntegrationSeeds, seedTenantIntegrations } =
  await import('./seed-tenants')

// ── A tiny in-memory fake db modeling engine_tenant_integrations ─────────────────
type IntegrationRow = {
  tenantId: string
  integrationId: string
  status: 'enabled' | 'pending' | 'disabled'
  connectedAt: Date | null
}

type WherePred = { eq?: [unknown, unknown]; and?: unknown[]; inArray?: [unknown, unknown] }

/**
 * Captures inserts/updates the way the real upsert intends. The fake honors:
 *   - insert().values(v).onConflictDoUpdate() — upsert keyed (tenant_id, integration_id),
 *     with connected_at "set once on first enabled" semantics modeled in JS,
 *   - select().from().where(eq(tenant_id, X)) — read existing rows for a tenant,
 *   - update().set({status:'disabled'}).where(and(eq(tenant_id,X), inArray(integration_id, [...]))).
 */
function makeFakeDb(initial: IntegrationRow[] = []) {
  const rows: IntegrationRow[] = initial.map((r) => ({ ...r }))
  const find = (tid: string, iid: string) =>
    rows.find((r) => r.tenantId === tid && r.integrationId === iid)

  const matchTenant = (pred: WherePred): string | undefined => {
    if (pred.eq && pred.eq[0] === 'tenant_id') return pred.eq[1] as string
    if (pred.and) {
      for (const p of pred.and) {
        const tid = matchTenant(p as WherePred)
        if (tid) return tid
      }
    }
    return undefined
  }
  const matchInArray = (pred: WherePred): unknown[] | undefined => {
    if (pred.inArray && pred.inArray[0] === 'integration_id') return pred.inArray[1] as unknown[]
    if (pred.and) {
      for (const p of pred.and) {
        const ids = matchInArray(p as WherePred)
        if (ids) return ids
      }
    }
    return undefined
  }

  const db = {
    insert: (_table: unknown) => ({
      values: (v: IntegrationRow) => ({
        onConflictDoUpdate: async (_opts: unknown) => {
          const prior = find(v.tenantId, v.integrationId)
          if (!prior) {
            rows.push({
              tenantId: v.tenantId,
              integrationId: v.integrationId,
              status: v.status,
              // INSERT: connected_at = now() iff status==='enabled', else null.
              connectedAt: v.status === 'enabled' ? (v.connectedAt ?? new Date()) : null,
            })
          } else {
            prior.status = v.status
            // UPDATE: connected_at set-once on first enabled, preserved after;
            // untouched for pending/disabled.
            if (v.status === 'enabled') prior.connectedAt = prior.connectedAt ?? new Date()
          }
        },
      }),
    }),
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: async (pred: WherePred) => {
          const tid = matchTenant(pred)
          return rows
            .filter((r) => r.tenantId === tid)
            .map((r) => ({ integrationId: r.integrationId }))
        },
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: { status?: 'disabled' }) => ({
        where: async (pred: WherePred) => {
          const tid = matchTenant(pred)
          const ids = matchInArray(pred)
          for (const r of rows) {
            if (r.tenantId === tid && ids?.includes(r.integrationId) && patch.status) {
              r.status = patch.status
            }
          }
        },
      }),
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, rows }
}

const REAL_IDS = listIntegrations().map((d) => d.id)

beforeEach(() => {
  // Clean env so a stray ${PREFIX}_INTEGRATIONS never leaks across cases.
  for (const k of Object.keys(process.env)) {
    if (k.endsWith('_INTEGRATIONS')) delete process.env[k]
  }
})

// ── parseIntegrationSeed (pure — always runs, no DB) ─────────────────────────────
describe('parseIntegrationSeed', () => {
  it('parses "shopify:enabled,mercado-libre:pending" into typed entries', () => {
    expect(parseIntegrationSeed('shopify:enabled,mercado-libre:pending')).toEqual([
      { integrationId: 'shopify', status: 'enabled' },
      { integrationId: 'mercado-libre', status: 'pending' },
    ])
  })

  it('trims whitespace around ids and statuses', () => {
    expect(parseIntegrationSeed('  shopify : enabled , mercado-libre : pending ')).toEqual([
      { integrationId: 'shopify', status: 'enabled' },
      { integrationId: 'mercado-libre', status: 'pending' },
    ])
  })

  it('a bare id (no :status) defaults to enabled', () => {
    expect(parseIntegrationSeed('shopify')).toEqual([{ integrationId: 'shopify', status: 'enabled' }])
  })

  it('a trailing colon with empty status defaults to enabled', () => {
    expect(parseIntegrationSeed('shopify:')).toEqual([{ integrationId: 'shopify', status: 'enabled' }])
  })

  it('an unset env → []', () => {
    expect(parseIntegrationSeed(undefined)).toEqual([])
  })

  it('a blank/whitespace env → []', () => {
    expect(parseIntegrationSeed('   ')).toEqual([])
  })

  it('drops empty pairs (leading/trailing/double commas)', () => {
    expect(parseIntegrationSeed(',shopify:enabled,,resend:pending,')).toEqual([
      { integrationId: 'shopify', status: 'enabled' },
      { integrationId: 'resend', status: 'pending' },
    ])
  })

  it('keeps an unknown status string VERBATIM (validator rejects, not the parser)', () => {
    // The parser does NOT validate; it preserves a bad status for the validator.
    expect(parseIntegrationSeed('shopify:bogus')).toEqual([
      { integrationId: 'shopify', status: 'bogus' as never },
    ])
  })

  it('later pairs for the same id win (last-write)', () => {
    expect(parseIntegrationSeed('shopify:pending,shopify:enabled')).toEqual([
      { integrationId: 'shopify', status: 'enabled' },
    ])
  })
})

// ── validateIntegrationSeeds (pure — always runs, real registry) ─────────────────
describe('validateIntegrationSeeds', () => {
  it('ACCEPTS the real registry ids (shopify, mercado-libre, notion, resend)', () => {
    expect(REAL_IDS).toEqual(expect.arrayContaining(['shopify', 'mercado-libre', 'notion', 'resend']))
    expect(() =>
      validateIntegrationSeeds([
        { integrationId: 'shopify', status: 'enabled' },
        { integrationId: 'mercado-libre', status: 'pending' },
        { integrationId: 'notion', status: 'disabled' },
        { integrationId: 'resend', status: 'enabled' },
      ]),
    ).not.toThrow()
  })

  it('THROWS on an integration_id NOT in listIntegrations() (e.g. coppel)', () => {
    expect(() => validateIntegrationSeeds([{ integrationId: 'coppel', status: 'enabled' }])).toThrow(
      /unknown integration 'coppel'/,
    )
  })

  it('THROWS on an invalid status', () => {
    expect(() =>
      validateIntegrationSeeds([{ integrationId: 'shopify', status: 'bogus' as never }]),
    ).toThrow(/invalid status 'bogus'/)
  })

  it('THROWS on the FIRST violation — unknown id before a later invalid status', () => {
    expect(() =>
      validateIntegrationSeeds([
        { integrationId: 'coppel', status: 'enabled' },
        { integrationId: 'shopify', status: 'bogus' as never },
      ]),
    ).toThrow(/unknown integration 'coppel'/)
  })

  it('accepts an empty entry list (a tenant desiring nothing)', () => {
    expect(() => validateIntegrationSeeds([])).not.toThrow()
  })

  it('the validator is driven by the LIVE registry, not a hardcoded list', () => {
    // Every real id validates; a sentinel obviously-not-registered id throws.
    for (const id of REAL_IDS) {
      expect(() => validateIntegrationSeeds([{ integrationId: id, status: 'enabled' }])).not.toThrow()
    }
    expect(() =>
      validateIntegrationSeeds([{ integrationId: 'definitely-not-real', status: 'enabled' }]),
    ).toThrow(/unknown integration/)
  })
})

// ── seedTenantIntegrations (hermetic, in-memory fake db — no Postgres) ────────────
const MIPASE_SEED: TenantSeed = {
  tenantId: 'mi-pase',
  name: 'Mi Pase',
  status: 'active',
  currency: 'MXN',
  locale: 'es-MX',
  branding: { name: 'Mi Pase' },
  allowedWorkflows: ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged'],
  members: [],
  secretPrefix: 'MIPASE',
}

const NOPREFIX_SEED: TenantSeed = {
  ...MIPASE_SEED,
  tenantId: 'noprefix',
  secretPrefix: null,
}

describe('seedTenantIntegrations (in-memory)', () => {
  it('inserts desired rows; enabled sets connected_at, pending leaves it null', async () => {
    process.env.MIPASE_INTEGRATIONS = 'shopify:enabled,mercado-libre:pending'
    const { db, rows } = makeFakeDb()
    await seedTenantIntegrations(db, [MIPASE_SEED])

    const shopify = rows.find((r) => r.integrationId === 'shopify')
    const ml = rows.find((r) => r.integrationId === 'mercado-libre')
    expect(shopify).toMatchObject({ tenantId: 'mi-pase', status: 'enabled' })
    expect(shopify?.connectedAt).toBeInstanceOf(Date)
    expect(ml).toMatchObject({ tenantId: 'mi-pase', status: 'pending' })
    expect(ml?.connectedAt).toBeNull()
  })

  it('connected_at is set ONCE on first enabled, then preserved across a re-seed', async () => {
    const firstConnect = new Date('2026-01-01T00:00:00.000Z')
    const { db, rows } = makeFakeDb([
      { tenantId: 'mi-pase', integrationId: 'shopify', status: 'enabled', connectedAt: firstConnect },
    ])
    process.env.MIPASE_INTEGRATIONS = 'shopify:enabled'
    await seedTenantIntegrations(db, [MIPASE_SEED])
    const shopify = rows.find((r) => r.integrationId === 'shopify')
    // Re-seed keeps the original connected_at (not bumped to "now").
    expect(shopify?.connectedAt).toBe(firstConnect)
    expect(shopify?.status).toBe('enabled')
  })

  it('an integration REMOVED from the env is DISABLED, never deleted (audit row stays)', async () => {
    const { db, rows } = makeFakeDb([
      { tenantId: 'mi-pase', integrationId: 'resend', status: 'enabled', connectedAt: new Date() },
    ])
    // Desired set no longer mentions resend → it must flip to disabled, not vanish.
    process.env.MIPASE_INTEGRATIONS = 'shopify:enabled'
    await seedTenantIntegrations(db, [MIPASE_SEED])

    const resend = rows.find((r) => r.integrationId === 'resend')
    expect(resend).toBeDefined() // NOT deleted
    expect(resend?.status).toBe('disabled')
    // And the newly-desired one is present + enabled.
    expect(rows.find((r) => r.integrationId === 'shopify')?.status).toBe('enabled')
  })

  it('an unset env desires nothing → all existing rows for the tenant are disabled', async () => {
    const { db, rows } = makeFakeDb([
      { tenantId: 'mi-pase', integrationId: 'shopify', status: 'enabled', connectedAt: new Date() },
      { tenantId: 'mi-pase', integrationId: 'resend', status: 'pending', connectedAt: null },
    ])
    delete process.env.MIPASE_INTEGRATIONS
    await seedTenantIntegrations(db, [MIPASE_SEED])
    expect(rows.every((r) => r.status === 'disabled')).toBe(true)
    expect(rows).toHaveLength(2) // nothing deleted
  })

  it('a tenant with a null secretPrefix is skipped (no env read, no rows written)', async () => {
    const { db, rows } = makeFakeDb()
    await seedTenantIntegrations(db, [NOPREFIX_SEED])
    expect(rows).toHaveLength(0)
  })

  it('THROWS (fails the deploy) on an unknown integration id in the env', async () => {
    process.env.MIPASE_INTEGRATIONS = 'coppel:enabled'
    const { db } = makeFakeDb()
    await expect(seedTenantIntegrations(db, [MIPASE_SEED])).rejects.toThrow(/unknown integration 'coppel'/)
  })

  it('is idempotent — re-seeding the same desired set yields the same rows', async () => {
    process.env.MIPASE_INTEGRATIONS = 'shopify:enabled,mercado-libre:pending'
    const { db, rows } = makeFakeDb()
    await seedTenantIntegrations(db, [MIPASE_SEED])
    await seedTenantIntegrations(db, [MIPASE_SEED])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.integrationId === 'shopify')?.status).toBe('enabled')
    expect(rows.find((r) => r.integrationId === 'mercado-libre')?.status).toBe('pending')
  })
})
