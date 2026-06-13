/**
 * SEAT-CAP CLAIM-STRADDLE RACE ★ (admin-roles Wave A / D3 hardening) — a REAL
 * Postgres-backed concurrency regression for the seat cap.
 *
 * THE RACE (the finding this test pins): `addInvite` serializes seat-CONSUMING adds
 * under a per-tenant advisory lock (`withTenantSeatLock`), so two concurrent adds can
 * never both pass the 5-check. But `claimInvite` deliberately does NOT take that lock
 * (claim is "seat-neutral": one pending=counted flips to claimed=not-counted + one
 * member=counted, net 0). If `seatCount` computed the denominator as TWO separately-
 * awaited SELECTs, then under Postgres READ COMMITTED each SELECT takes a FRESH
 * snapshot, and a concurrent claim could COMMIT in the inter-statement gap:
 *
 *   State: 4 members + 1 pending (X) = 5 seats (AT cap).
 *   addInvite(Y) holds the seat lock and counts:
 *     (1) SELECT members → 4 (claim not yet committed)
 *     (2) claimInvite(X) COMMITS → now 5 members, 0 pending
 *     (3) SELECT pending → 0
 *     computed seats = 4 + 0 = 4 < 5 → INSERT Y as the 6th seat.
 *   Final committed state = 5 members + 1 pending = 6 > cap.
 *
 * THE FIX (roles.ts seatCount): sum both sub-counts in ONE statement, so a concurrent
 * claim is observed as either (M, P) or (M+1, P-1) — both summing to the true total.
 * The straddle is then impossible and the at-cap add is correctly rejected TEAM_FULL.
 *
 * This test builds the at-cap state and races an `addInvite(Y)` against the claim of
 * the pending invite (X) over real PG, many times, asserting the INVARIANT every
 * iteration: the committed seat count NEVER exceeds the cap. The in-memory cap test
 * (admin-roles-cap.test.ts) cannot exercise snapshot straddling — only real PG can.
 *
 * SKIPS its body (like the worker pricing-chain integration test) when the dev
 * Postgres is not reachable — that is expected/green on a machine without the
 * `godin-engine-pg` dev container up.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The dev container the services share (see docker-compose.yml / .env.example).
const DEFAULT_DEV_DB = 'postgresql://postgres:postgres@localhost:5434/godin_engine'
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = DEFAULT_DEV_DB

// A unique tenant per run so we never collide with seeded data or a parallel run.
const TENANT = `cap-race-${randomUUID().slice(0, 8)}`

let db: typeof import('@godin-engine/db')['db']
let schema: typeof import('@godin-engine/db')['schema']
let sql: typeof import('@godin-engine/db')['sql']
let drizzle: typeof import('drizzle-orm')
let roles: typeof import('./roles')
let invites: typeof import('./invites')
let pgUp = false

async function probePg(): Promise<boolean> {
  try {
    const mod = await import('@godin-engine/db')
    await mod.sql`select 1`
    db = mod.db
    schema = mod.schema
    sql = mod.sql
    drizzle = await import('drizzle-orm')
    roles = await import('./roles')
    invites = await import('./invites')
    return true
  } catch (e) {
    console.warn(`[admin-roles-cap-race] skipping — dev Postgres not reachable: ${(e as Error).message}`)
    return false
  }
}

/** Re-seed the AT-CAP membership: 4 members + 1 pending invite = 5 seats (the cap). */
async function seedAtCap(pendingEmail: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await db.insert(schema.engineTenantMembers).values({
      tenantId: TENANT,
      did: `${TENANT}:member:${i}`,
      source: 'seed',
      role: i === 0 ? 'admin' : 'member',
    })
  }
  await db.insert(schema.engineTenantInvites).values({
    tenantId: TENANT,
    email: pendingEmail,
    status: 'pending',
    role: 'member',
  })
}

/** Tear the tenant's members + invites down between iterations (tenant row stays). */
async function clearTenant(): Promise<void> {
  const { eq } = drizzle
  await db.delete(schema.engineTenantInvites).where(eq(schema.engineTenantInvites.tenantId, TENANT))
  await db.delete(schema.engineTenantMembers).where(eq(schema.engineTenantMembers.tenantId, TENANT))
}

beforeAll(async () => {
  pgUp = await probePg()
  if (!pgUp) return
  // Create the tenant row ONCE for the suite; members/invites are reset per iteration.
  await db.insert(schema.engineTenants).values({
    tenantId: TENANT,
    name: TENANT,
    status: 'active',
    currency: 'MXN',
    locale: 'es-MX',
    branding: {},
    allowedWorkflows: [],
  })
})

afterAll(async () => {
  if (!pgUp) return
  const { eq } = drizzle
  await db.delete(schema.engineTenantInvites).where(eq(schema.engineTenantInvites.tenantId, TENANT))
  await db.delete(schema.engineTenantMembers).where(eq(schema.engineTenantMembers.tenantId, TENANT))
  await db.delete(schema.engineTenants).where(eq(schema.engineTenants.tenantId, TENANT))
  await sql.end({ timeout: 5 })
})

describe.skipIf(!process.env.DATABASE_URL)('★ seat cap — claim-straddle race over real PG', () => {
  it('a claim committing mid-addInvite can NEVER push the tenant over the 5-cap', async () => {
    if (!pgUp) {
      console.warn('[admin-roles-cap-race] DATABASE_URL set but PG unreachable — skipping body')
      return
    }

    // Run the race many times to surface the inter-statement straddle window. With the
    // single-snapshot seatCount the add is always observed as at-cap (whether the claim
    // commits before or after it counts) → TEAM_FULL; the final seat count is ALWAYS ≤ 5.
    const ITERATIONS = 40
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const pendingEmail = `claimer-${iter}@x.co`
      const newEmail = `newcomer-${iter}@x.co`
      const claimerDid = `${TENANT}:claimer:${iter}`

      await clearTenant()
      await seedAtCap(pendingEmail)

      // 5 seats now (4 members + 1 pending). Race: add a NEW email vs claim the pending.
      const addP = invites
        .addInvite(TENANT, newEmail, 'member', `${TENANT}:member:0`)
        .catch((e: unknown) => {
          // TEAM_FULL is the expected, correct rejection — swallow it, fail only on others.
          if ((e as { code?: string })?.code === 'TEAM_FULL') return 'team-full' as const
          throw e
        })
      const claimP = invites.claimInvite({ email: pendingEmail, did: claimerDid })

      await Promise.all([addP, claimP])

      // THE INVARIANT: regardless of interleaving, the committed seat count is ≤ 5.
      const seats = await roles.seatCount(TENANT)
      expect(seats, `iteration ${iter}: committed seats must never exceed the cap`).toBeLessThanOrEqual(5)
    }
  })
})
