import { and, eq, sql } from 'drizzle-orm'
import { db as defaultDb, schema } from '@pokta-engine/db'
import { removeTenantMember } from './tenants'

/**
 * Ops DEPROVISION / RESET script (Wave 1 / D5, D7) — the REAL deprovision path. Given
 * a (tenantId, email), in ONE transaction: set the invite `status='revoked'`
 * (+ updated_at=now()) AND, if it was claimed, `removeTenantMember(tenantId,
 * claimed_by_did)`. This revokes both the invite AND the bound membership so the
 * DID can no longer resolve to the tenant; the email is then free to be re-invited
 * (the partial unique index excludes revoked rows). Deprovisioning is a DB op — env
 * never does it (D7). After this, the DID resolves to no tenant → TENANT_UNKNOWN.
 *
 * This module is allowlisted in scripts/check-scoped-db.sh (it writes only
 * engine_tenant_invites + the membership delete via tenants.ts) and is guarded by
 * import.meta.url so importing it (tests) never connects to the DB.
 */

export interface DeprovisionResult {
  /** True iff a non-revoked invite row was found and revoked. */
  revoked: boolean
  /** The DID whose membership was removed (the invite's claimed_by_did), if any. */
  removedMember: string | null
}

/**
 * deprovisionInvite(tenantId, email, db) — revoke the invite + remove the claimed
 * member, atomically. Idempotent: a missing or already-revoked invite returns
 * `{ revoked: false, removedMember: null }` (and removes no member). `email` is
 * lowercased to match the stored (lowercased) value.
 */
export async function deprovisionInvite(
  tenantId: string,
  email: string,
  db: typeof defaultDb = defaultDb,
): Promise<DeprovisionResult> {
  const normalizedEmail = email.trim().toLowerCase()
  const V = schema.engineTenantInvites

  return db.transaction(async (tx) => {
    // Lock + read the live (non-revoked) invite so a concurrent claim serializes.
    const locked = (await tx.execute(
      sql`select claimed_by_did, status
          from engine_tenant_invites
          where tenant_id = ${tenantId} and email = ${normalizedEmail}
          for update`,
    )) as unknown as Array<{ claimed_by_did: string | null; status: string }>

    const row = locked[0]
    if (!row || row.status === 'revoked') {
      return { revoked: false, removedMember: null }
    }

    await tx
      .update(V)
      .set({ status: 'revoked', updatedAt: sql`now()` })
      .where(and(eq(V.tenantId, tenantId), eq(V.email, normalizedEmail)))

    const claimedBy = row.claimed_by_did
    if (claimedBy) {
      await removeTenantMember(tenantId, claimedBy, tx as unknown as typeof defaultDb)
    }
    return { revoked: true, removedMember: claimedBy ?? null }
  })
}

/** Deploy/ops entrypoint: `tsx apps/engine-api/src/deprovision-invite.ts <tenantId> <email>`. */
async function main(): Promise<void> {
  const [tenantId, email] = process.argv.slice(2)
  if (!tenantId || !email) {
    // eslint-disable-next-line no-console
    console.error('usage: tsx apps/engine-api/src/deprovision-invite.ts <tenantId> <email>')
    process.exit(2)
  }
  const result = await deprovisionInvite(tenantId, email)
  // eslint-disable-next-line no-console
  console.log(
    `[deprovision-invite] tenant=${tenantId} email=${email} revoked=${result.revoked} removedMember=${result.removedMember ?? '(none)'}`,
  )
}

// Only run when invoked as the script entrypoint (importing for tests must NOT
// connect to the DB). tsx sets import.meta.url to the run file's URL.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[deprovision-invite] failed', e)
      process.exit(1)
    })
}
