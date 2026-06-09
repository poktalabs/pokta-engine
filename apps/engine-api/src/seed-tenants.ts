import { sql } from 'drizzle-orm'
import { db as defaultDb, schema } from '@godin-engine/db'
import { listManifests } from '@godin-engine/workflows'

/**
 * Tenant registry SEED + validation (PR2 T8). Idempotent: an `ON CONFLICT` upsert
 * keyed on `tenant_id`, safe to run on every deploy (chained after `db:migrate` in
 * the engine-api preDeployCommand). It seeds the two known tenants and ENFORCES
 * the registry invariants before any write so a bad row never reaches the table:
 *
 *   - every `allowedWorkflows` id MUST exist in the live workflow registry
 *     (`listManifests()`),
 *   - `secretPrefix` MUST match `^[A-Z][A-Z0-9_]*$` (the env-var prefix charset),
 *   - `secretPrefix` MUST be UNIQUE across the seeded tenants.
 *
 * This module is NOT a /v1 tenant-data surface — it writes the tenancy CONFIG
 * table at deploy time (allowlisted in scripts/check-scoped-db.sh, like
 * tenants.ts). It performs no cross-tenant DATA read/write.
 */

/** A tenant to seed. Mirrors the engine_tenants insert shape (PR2 §4). */
export interface TenantSeed {
  tenantId: string
  name: string
  status: 'active' | 'pending' | 'disabled'
  currency: string
  locale: string
  branding: { name: string; badge?: string }
  allowedWorkflows: string[]
  members: string[]
  secretPrefix: string | null
}

const SECRET_PREFIX_RE = /^[A-Z][A-Z0-9_]*$/

/**
 * Read the ops-owned member DIDs for a tenant from env (PR2b B1). The env var is
 * `${secretPrefix}_MEMBER_DIDS` (e.g. `MIPASE_MEMBER_DIDS`), a comma-separated
 * list of Privy DIDs. Split on comma, trim, drop empties, and DEDUPE. An
 * unset/blank env (or a null secretPrefix) → `[]` (a no-op union below).
 *
 * Members are ops-owned and env-seeded: NO DID literal ever lives in source or a
 * commit (the values come from Railway/`.env.local`); `.env.example` carries only
 * a placeholder. The merge is strictly ADDITIVE (§3.6) — see `seedTenants`.
 */
export function envMemberDids(secretPrefix: string | null): string[] {
  if (!secretPrefix) return []
  const raw = process.env[`${secretPrefix}_MEMBER_DIDS`]
  if (!raw?.trim()) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const did = part.trim()
    if (did) seen.add(did)
  }
  return [...seen]
}

/** Union two DID lists, preserving order (a first, then new b entries), deduped. */
function unionDids(a: string[], b: string[]): string[] {
  const seen = new Set(a)
  const out = [...a]
  for (const did of b) {
    if (!seen.has(did)) {
      seen.add(did)
      out.push(did)
    }
  }
  return out
}

/**
 * The seed set (PR2 §4):
 *   - mi-pase  — ACTIVE (the first paid client; real Shopify dev creds).
 *   - vino     — PENDING (no real creds until PR3; must NOT resolve/dispatch yet).
 * The allowedWorkflows ids are the REAL M1 / Vino manifest ids; `validateSeeds`
 * cross-checks them against listManifests() so a workflow rename fails the deploy
 * loudly rather than silently seeding a dead allow-list entry.
 */
export const TENANT_SEEDS: TenantSeed[] = [
  {
    tenantId: 'mi-pase',
    name: 'Mi Pase',
    status: 'active',
    currency: 'MXN',
    locale: 'es-MX',
    branding: { name: 'Mi Pase', badge: 'Shopify test store' },
    allowedWorkflows: ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged'],
    members: [], // Privy DIDs added in PR2b
    secretPrefix: 'MIPASE',
  },
  {
    tenantId: 'vino',
    name: 'Vino Design Build',
    status: 'pending', // NOT active — no real creds until PR3
    currency: 'USD',
    locale: 'en',
    branding: { name: 'Vino Design Build' },
    allowedWorkflows: ['call-intake', 'proposal-step', 'send-step'],
    members: [],
    secretPrefix: 'VINO',
  },
]

/**
 * Validate the seed set against the registry invariants. Throws on the FIRST
 * violation (fail the deploy) with an actionable message. Exposed for unit tests.
 */
export function validateSeeds(seeds: TenantSeed[], manifestIds: string[] = listManifests().map((m) => m.id)): void {
  const known = new Set(manifestIds)
  const seenPrefix = new Map<string, string>() // prefix → first tenant that used it

  for (const t of seeds) {
    // 1) allowed workflows must all exist in the live registry.
    for (const id of t.allowedWorkflows) {
      if (!known.has(id)) {
        throw new Error(
          `tenant '${t.tenantId}': allowedWorkflows references unknown workflow '${id}' (not in listManifests())`,
        )
      }
    }
    // 2) secret_prefix charset (when set).
    if (t.secretPrefix !== null) {
      if (!SECRET_PREFIX_RE.test(t.secretPrefix)) {
        throw new Error(
          `tenant '${t.tenantId}': secretPrefix '${t.secretPrefix}' must match ${SECRET_PREFIX_RE} (^[A-Z][A-Z0-9_]*$)`,
        )
      }
      // 3) secret_prefix uniqueness across tenants.
      const prior = seenPrefix.get(t.secretPrefix)
      if (prior) {
        throw new Error(
          `secretPrefix '${t.secretPrefix}' is not unique — used by both '${prior}' and '${t.tenantId}'`,
        )
      }
      seenPrefix.set(t.secretPrefix, t.tenantId)
    }
  }
}

/**
 * Seed (idempotent upsert) the validated tenants into engine_tenants. Re-running
 * keeps config-managed columns in sync (name/status/branding/allow-list/prefix)
 * while bumping `updated_at`. `created_at` is untouched.
 *
 * MEMBER DIDs (PR2b B1) are ADDITIVE and never wiped:
 *   - the INSERTed `members` is the seed's static `members` UNION the env DIDs
 *     (`${secretPrefix}_MEMBER_DIDS`), deduped;
 *   - on CONFLICT we set `members` to the UNION of the EXISTING column and the
 *     env-derived insert values (`array(select distinct unnest(existing || excluded))`).
 *     So a re-deploy ADDS any new env DIDs while preserving DIDs added out-of-band
 *     — it can never wipe `members` (an empty/unset env is a no-op: the union with
 *     `excluded.members={}` returns the existing set unchanged).
 */
export async function seedTenants(db: typeof defaultDb = defaultDb, seeds: TenantSeed[] = TENANT_SEEDS): Promise<void> {
  validateSeeds(seeds)
  for (const t of seeds) {
    const members = unionDids(t.members, envMemberDids(t.secretPrefix))
    await db
      .insert(schema.engineTenants)
      .values({
        tenantId: t.tenantId,
        name: t.name,
        status: t.status,
        currency: t.currency,
        locale: t.locale,
        branding: t.branding,
        allowedWorkflows: t.allowedWorkflows,
        members,
        secretPrefix: t.secretPrefix,
      })
      .onConflictDoUpdate({
        target: schema.engineTenants.tenantId,
        set: {
          name: t.name,
          status: t.status,
          currency: t.currency,
          locale: t.locale,
          branding: t.branding,
          allowedWorkflows: t.allowedWorkflows,
          secretPrefix: t.secretPrefix,
          // ADDITIVE union: keep every existing DID, add the env-derived ones.
          members: sql`(
            select coalesce(array(
              select distinct unnest(${schema.engineTenants.members} || excluded.members)
            ), '{}')
          )`,
          updatedAt: sql`now()`,
        },
      })
  }
}

/** Deploy entrypoint: `tsx apps/engine-api/src/seed-tenants.ts`. */
async function main(): Promise<void> {
  await seedTenants()
  // eslint-disable-next-line no-console
  console.log(`[seed-tenants] upserted ${TENANT_SEEDS.length} tenant(s): ${TENANT_SEEDS.map((t) => t.tenantId).join(', ')}`)
}

// Only run when invoked as the script entrypoint (importing for tests must NOT
// connect to the DB or seed). tsx sets import.meta.url to the run file's URL.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[seed-tenants] failed', e)
      process.exit(1)
    })
}
