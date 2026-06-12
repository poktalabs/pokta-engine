import { and, eq, sql } from 'drizzle-orm'
import { db as defaultDb, schema } from '@godin-engine/db'
import type { MemberRole } from '@godin-engine/contract'

/**
 * The ROLE / AUTHZ read layer (admin-roles Wave A) — the single accessor for the
 * three role-bearing tables: `engine_superadmins`, `engine_tenant_members`, and
 * `engine_tenant_invites`. This module is allowlisted in scripts/check-scoped-db.sh
 * and PINNED by a targeted grep test (roles-scope.test.ts) to those THREE tables and
 * NOTHING else — it never reads a runs-class tenant-DATA table, so the broad
 * allowlist exemption cannot hide a cross-tenant data read.
 *
 * It exposes the authz primitives the /v1 role-gated routes need (resolved fresh per
 * request, never cached): superadmin membership, a member's per-tenant role, the
 * per-tenant SEAT count for the 5-cap, and a per-tenant advisory lock so the cap's
 * count+insert serialize race-safely.
 *
 * `db` is injectable so tests pass a mock client; prod passes the real one.
 */

type DbLike = typeof defaultDb

/**
 * A FIXED namespace constant for the two-arg `pg_advisory_xact_lock(key1, key2)`
 * (Codex#9). Using a namespace + `hashtext(tenantId)` — instead of a bare single
 * `hashtext` — keeps the per-tenant seat lock from colliding with any OTHER advisory
 * lock that might hash a different string to the same 32-bit value. The number is an
 * arbitrary-but-stable partition id for "engine seat locks".
 */
export const SEAT_LOCK_NAMESPACE = 0x5ea7 // "seat"

/**
 * isSuperadmin(did) — true iff the DID has a row in `engine_superadmins`. Cross-tenant
 * and independent of any tenant membership. Empty did → false (fail closed).
 */
export async function isSuperadmin(did: string, db: DbLike = defaultDb): Promise<boolean> {
  if (!did) return false
  const S = schema.engineSuperadmins
  const rows = (await db.select({ did: S.did }).from(S).where(eq(S.did, did)).limit(1)) as Array<{
    did: string
  }>
  return rows.length > 0
}

/**
 * tenantRoleOf(tenantId, did) — the caller's role in the tenant: the member row's
 * `role` ('admin' | 'member'), or `null` when the DID is NOT a member of the tenant.
 * Does NOT consider superadmin (that is a separate cross-tenant grant) — a superadmin
 * who is not a tenant member resolves to `null` here. Empty args → null.
 */
export async function tenantRoleOf(
  tenantId: string,
  did: string,
  db: DbLike = defaultDb,
): Promise<MemberRole | null> {
  if (!tenantId || !did) return null
  const M = schema.engineTenantMembers
  const rows = (await db
    .select({ role: M.role })
    .from(M)
    .where(and(eq(M.tenantId, tenantId), eq(M.did, did)))
    .limit(1)) as Array<{ role: MemberRole }>
  return rows[0]?.role ?? null
}

/**
 * seatCount(tenantId) — the tenant's seat usage for the 5-cap (D3):
 *   seats = (count of engine_tenant_members rows for the tenant)
 *         + (count of engine_tenant_invites rows for the tenant WHERE status='pending').
 * A `claimed` invite is NOT double-counted (it already has a member row); `revoked`
 * invites are excluded; superadmins are counted ONLY via their member row (this never
 * reads engine_superadmins — Codex#11). Run this INSIDE the seat lock + tx so the
 * read is consistent with the subsequent insert.
 */
export async function seatCount(tenantId: string, db: DbLike = defaultDb): Promise<number> {
  if (!tenantId) return 0
  const M = schema.engineTenantMembers
  const V = schema.engineTenantInvites

  const memberRows = (await db
    .select({ did: M.did })
    .from(M)
    .where(eq(M.tenantId, tenantId))) as Array<{ did: string }>

  const pendingRows = (await db
    .select({ email: V.email })
    .from(V)
    .where(and(eq(V.tenantId, tenantId), eq(V.status, 'pending')))) as Array<{ email: string }>

  return memberRows.length + pendingRows.length
}

/**
 * withTenantSeatLock(tenantId, tx, fn) — take a per-tenant transaction-scoped advisory
 * lock (`pg_advisory_xact_lock(SEAT_LOCK_NAMESPACE, hashtext(tenantId)::int)`) then run
 * `fn`. The lock is held until the surrounding transaction commits/rolls back, so a
 * concurrent seat add for the SAME tenant serializes behind it — making the cap's
 * count-then-insert race-safe (two adds at 4 cannot both insert → 6). MUST be called
 * with a transaction handle (`tx`), not the pooled db, so the lock is xact-scoped.
 */
export async function withTenantSeatLock<T>(
  tenantId: string,
  tx: DbLike,
  fn: () => Promise<T>,
): Promise<T> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SEAT_LOCK_NAMESPACE}, hashtext(${tenantId})::int)`,
  )
  return fn()
}
