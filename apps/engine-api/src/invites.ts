import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { db as defaultDb, schema } from '@godin-engine/db'
import { addTenantMember, getTenant, isActive, MemberDidCollisionError } from './tenants'

/**
 * The invite ACCESSOR (Wave 1) — the single raw path for `engine_tenant_invites`.
 * This module is allowlisted in scripts/check-scoped-db.sh, but its raw db footprint
 * is intentionally TINY and audited by a targeted grep test: it touches ONLY
 * `engine_tenant_invites` here, plus the ONE membership write that goes through
 * `addTenantMember` (tenants.ts) — never any other engine_* table.
 *
 * `engine_tenant_invites` is the email-preauthorized first-login layer (D1/D8): an
 * operator seeds verified emails per tenant; the claim path matches a Privy-verified
 * email to the (globally-unique, non-revoked) invite and binds the DID into the
 * tenant in ONE transaction. The partial unique index `tenant_invites_active_email`
 * (email WHERE status != 'revoked') makes a verified email map to exactly one tenant.
 *
 * `db` is injectable so tests pass a mock client; prod passes the real one.
 */

type DbLike = typeof defaultDb

/** An invite row as stored. */
export type InviteRow = typeof schema.engineTenantInvites.$inferSelect

/**
 * The typed outcome of an admin `addInvite` (Wave 3, operator-gated):
 *   - `'added'` — a NEW pending invite row was inserted,
 *   - `'reactivated'` — an existing `revoked` row was flipped back to `pending`,
 *   - `'already-pending'` — the email was already a pending invite for this tenant
 *     (idempotent no-op),
 *   - `'already-claimed'` — the email is a `claimed` invite for this tenant; LEFT AS
 *     IS (un-claiming would orphan the bound member — deprovision is the only path
 *     that removes a claim, see deprovision-invite.ts),
 *   - `'conflict-other-tenant'` — the email is ACTIVE (non-revoked) for a DIFFERENT
 *     tenant; the partial unique index `tenant_invites_active_email` rejects the
 *     write, mapped here rather than thrown as a 500.
 */
export type AdminInviteOutcome =
  | 'added'
  | 'reactivated'
  | 'already-pending'
  | 'already-claimed'
  | 'conflict-other-tenant'

/**
 * The Postgres unique-violation SQLSTATE. The partial unique index on
 * (email) WHERE status != 'revoked' raises this when an email is already ACTIVE for
 * a different tenant. We detect it structurally (code on the error or its `cause`)
 * so the route returns a clean 409 instead of a 500.
 */
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code ?? (e as { cause?: { code?: unknown } })?.cause?.code
  return code === '23505'
}

/**
 * The typed outcome of a claim attempt:
 *   - `{ ok: true, tenantId }` — the DID is (now) bound to the tenant (incl. the
 *     idempotent re-claim by the SAME did),
 *   - `'collision'` — the invite is claimed by a DIFFERENT did, or binding the
 *     member hit the cross-tenant `UNIQUE(did)` guard (rolled back),
 *   - `'inactive'` — the target tenant is not `active` (gated BEFORE any mutation),
 *   - `'not-found'` — the invite is revoked or otherwise unclaimable.
 * The route collapses every non-ok outcome into ONE identical TENANT_UNKNOWN envelope
 * (anti-enumeration); the distinction here is for server-side ops logging only.
 */
export type ClaimOutcome =
  | { ok: true; tenantId: string }
  | 'collision'
  | 'inactive'
  | 'not-found'

/**
 * findInviteForEmails(emails) — resolve the single ACTIVE (status != 'revoked')
 * invite whose email is in the (already lowercased) input set. The partial unique
 * index guarantees at most one active invite per email, but a defense-in-depth check
 * remains: if the matched rows span MORE THAN ONE distinct tenant, return `undefined`
 * (fail closed / ambiguous) rather than guess. No input emails → `undefined`.
 */
export async function findInviteForEmails(
  emails: string[],
  db: DbLike = defaultDb,
): Promise<InviteRow | undefined> {
  const lowered = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (lowered.length === 0) return undefined

  const V = schema.engineTenantInvites
  const rows = (await db
    .select()
    .from(V)
    .where(and(inArray(V.email, lowered), ne(V.status, 'revoked')))
    .limit(2)) as InviteRow[]

  if (rows.length === 0 || !rows[0]) return undefined
  // More than one ACTIVE tenant for the verified email set → ambiguous → fail closed.
  // (The partial unique index makes >1 row PER EMAIL unwritable, but a user with
  // TWO verified emails each invited by a DIFFERENT tenant could still match two
  // rows; we refuse to pick a tenant.)
  const firstTenant = rows[0].tenantId
  if (rows.some((r) => r.tenantId !== firstTenant)) return undefined
  return rows[0]
}

/**
 * claimInvite({ email, did }) — bind a DID to the invite's tenant, atomically (D-2 /
 * Codex). ONE transaction: SELECT the invite row FOR UPDATE; gate the tenant on
 * `active` BEFORE any mutation (the FK proves existence, not active status); then:
 *   - revoked / missing under lock → `'not-found'`,
 *   - claimed by THIS did → `{ ok, tenantId }` (idempotent re-claim, no rewrite),
 *   - claimed by ANOTHER did → `'collision'`,
 *   - pending → mark claimed (+ claimed_by_did/at, updated_at) AND addTenantMember(
 *     tenantId, did, tx, 'claim'); a `MemberDidCollisionError` (the DID is already a
 *     member of another tenant — the UNIQUE(did) guard) ROLLS BACK the tx → `'collision'`.
 * A crash between the two writes leaves the invite pending + no member (consistent;
 * re-claimable), never a half-claimed lockout.
 */
export async function claimInvite(
  { email, did }: { email: string; did: string },
  db: DbLike = defaultDb,
): Promise<ClaimOutcome> {
  const normalizedEmail = email.trim().toLowerCase()
  const V = schema.engineTenantInvites

  try {
    return await db.transaction(async (tx) => {
      // Lock the invite row so two concurrent claims serialize on it.
      const locked = (await tx.execute(
        sql`select tenant_id, email, status, claimed_by_did
            from engine_tenant_invites
            where email = ${normalizedEmail} and status != 'revoked'
            for update`,
      )) as unknown as Array<{
        tenant_id: string
        email: string
        status: string
        claimed_by_did: string | null
      }>

      const invite = locked[0]
      if (!invite) return 'not-found' as const

      const tenantId = invite.tenant_id

      // INACTIVE-TENANT GATE (before any mutation): the FK proves the tenant exists,
      // not that it is active. Binding into a pending/disabled tenant must fail here.
      const tenant = await getTenant(tenantId, db, { forceFresh: true })
      if (!tenant || !isActive(tenant)) return 'inactive' as const

      if (invite.status === 'claimed') {
        // Idempotent: the SAME did re-claiming is a no-op success.
        if (invite.claimed_by_did === did) return { ok: true as const, tenantId }
        // A DIFFERENT did already owns this invite — one-time claim, ops reset (D5).
        return 'collision' as const
      }

      // status === 'pending' → claim it AND bind the member in this tx.
      await tx
        .update(V)
        .set({
          status: 'claimed',
          claimedByDid: did,
          claimedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(V.tenantId, tenantId), eq(V.email, normalizedEmail)))

      // Bind the DID into the tenant. A cross-tenant UNIQUE(did) violation throws
      // MemberDidCollisionError → we rethrow to roll the whole tx back (the claim
      // is undone) and map it to 'collision' below.
      try {
        await addTenantMember(tenantId, did, tx as unknown as DbLike, 'claim')
      } catch (e) {
        if (e instanceof MemberDidCollisionError) throw new ClaimCollisionRollback(tenantId)
        throw e
      }

      return { ok: true as const, tenantId }
    })
  } catch (e) {
    if (e instanceof ClaimCollisionRollback) return 'collision'
    throw e
  }
}

/**
 * addInvite(tenantId, email, db) — operator-gated upsert of a `pending` invite
 * (Wave 3). Lowercases + trims the email. In ONE transaction, reads the current
 * (tenant_id, email) row (same table) and acts on its status:
 *   - no row → INSERT `pending` → `'added'`,
 *   - `revoked` → UPDATE back to `pending` (+ updated_at) → `'reactivated'`,
 *   - `pending` → no-op → `'already-pending'`,
 *   - `claimed` → LEFT AS IS (never un-claim → never orphan the member) → `'already-claimed'`.
 * An INSERT/UPDATE that activates an email already ACTIVE for ANOTHER tenant trips
 * the partial unique index (23505) → caught → `'conflict-other-tenant'` (not a 500).
 * The tenant FK is enforced on INSERT; a non-existent tenant rejects there (the
 * route surfaces it as a clean error, not a raw 500).
 */
export async function addInvite(
  tenantId: string,
  email: string,
  db: DbLike = defaultDb,
): Promise<AdminInviteOutcome> {
  const normalizedEmail = email.trim().toLowerCase()
  const V = schema.engineTenantInvites

  try {
    return await db.transaction(async (tx) => {
      const existing = (await tx
        .select()
        .from(V)
        .where(and(eq(V.tenantId, tenantId), eq(V.email, normalizedEmail)))
        .limit(1)) as InviteRow[]

      const row = existing[0]
      if (!row) {
        await tx.insert(V).values({ tenantId, email: normalizedEmail, status: 'pending' })
        return 'added' as const
      }
      if (row.status === 'pending') return 'already-pending' as const
      if (row.status === 'claimed') return 'already-claimed' as const
      // status === 'revoked' → reactivate to pending.
      await tx
        .update(V)
        .set({ status: 'pending', updatedAt: sql`now()` })
        .where(and(eq(V.tenantId, tenantId), eq(V.email, normalizedEmail)))
      return 'reactivated' as const
    })
  } catch (e) {
    // Email already ACTIVE for another tenant (partial unique index) → 409, not 500.
    if (isUniqueViolation(e)) return 'conflict-other-tenant'
    throw e
  }
}

/**
 * listInvites(tenantId, db) — every invite row for the tenant (pending/claimed/
 * revoked) ordered by email, for operator visibility (Wave 3). Same-table read.
 */
export async function listInvites(tenantId: string, db: DbLike = defaultDb): Promise<InviteRow[]> {
  const V = schema.engineTenantInvites
  return (await db
    .select()
    .from(V)
    .where(eq(V.tenantId, tenantId))
    .orderBy(V.email)) as InviteRow[]
}

/**
 * Internal sentinel: thrown inside the claim tx on a cross-tenant member collision
 * so the transaction ROLLS BACK (undoing the just-written claim) and the outer catch
 * can map it to the `'collision'` outcome. Not exported — it never escapes this module.
 */
class ClaimCollisionRollback extends Error {
  constructor(public readonly tenantId: string) {
    super('claim rolled back: cross-tenant member collision')
    this.name = 'ClaimCollisionRollback'
  }
}
