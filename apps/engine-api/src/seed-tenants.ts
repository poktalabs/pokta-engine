import { and, eq, inArray, sql } from 'drizzle-orm'
import { db as defaultDb, schema } from '@godin-engine/db'
import { listManifests } from '@godin-engine/workflows'
import { listIntegrations } from '@godin-engine/integrations'
import { addTenantMember, MemberDidCollisionError } from './tenants'

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
function unionMemberDids(a: string[], b: string[]): string[] {
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
 * Pre-validate the FULL set of member DIDs that `seedTenants` is about to bind —
 * the static seed `members` UNION the env DIDs (`${secretPrefix}_MEMBER_DIDS`) per
 * tenant — for a cross-tenant duplicate BEFORE any row is written. The membership
 * table's `UNIQUE(did)` makes a cross-tenant double-bind a hard error; without this
 * gate, `seedTenants`' per-DID `addTenantMember` would throw MID-LOOP, AFTER the
 * colliding tenant's row was already upserted — a partially-applied seed / hard
 * deploy abort. Throwing ONE aggregated error here keeps the seed all-or-nothing:
 * a shared DID fails the deploy fast, names the DID and BOTH tenants, and writes
 * nothing. Resolution is unchanged for any valid (collision-free) set.
 */
export function validateMemberDids(
  seeds: TenantSeed[],
  envDids: (secretPrefix: string | null) => string[] = envMemberDids,
): void {
  const owner = new Map<string, string>() // did → first tenant that claimed it
  for (const t of seeds) {
    const dids = unionMemberDids(t.members, envDids(t.secretPrefix))
    for (const did of dids) {
      const prior = owner.get(did)
      if (prior && prior !== t.tenantId) {
        throw new Error(
          `member DID '${did}' is bound to more than one tenant ('${prior}' and '${t.tenantId}'); ` +
            `a DID may belong to exactly one tenant (UNIQUE(did)) — reconcile the seed/env before deploying`,
        )
      }
      owner.set(did, t.tenantId)
    }
  }
}

/**
 * Seed (idempotent upsert) the validated tenants into engine_tenants. Re-running
 * keeps config-managed columns in sync (name/status/branding/allow-list/prefix)
 * while bumping `updated_at`. `created_at` is untouched.
 *
 * MEMBER DIDs (PR2b B1 / Wave 0 D9) are ADDITIVE and never wiped. Membership now
 * lives in `engine_tenant_members` (NOT a column here): after upserting the tenant
 * row, each DID — the static seed `t.members` UNION the env DIDs
 * (`${secretPrefix}_MEMBER_DIDS`) — is bound via `addTenantMember(..., source='seed')`
 * with INSERT-ONLY semantics (`ON CONFLICT (tenant_id, did) DO NOTHING`). So a
 * re-deploy ADDS any new DIDs while preserving rows already present (incl. ones
 * added out-of-band); an empty/unset env binds nothing (no wipe → no lockout). The
 * `UNIQUE(did)` guard makes a cross-tenant double-bind a `MemberDidCollisionError`
 * (surfaced loudly rather than silently mis-binding).
 */
export async function seedTenants(db: typeof defaultDb = defaultDb, seeds: TenantSeed[] = TENANT_SEEDS): Promise<void> {
  validateSeeds(seeds)
  // Reject a cross-tenant duplicate DID BEFORE any row write so the seed is
  // all-or-nothing (never a partial state on a mid-loop UNIQUE(did) collision).
  validateMemberDids(seeds)
  for (const t of seeds) {
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
          updatedAt: sql`now()`,
        },
      })

    // Bind member DIDs into the membership table (insert-only, additive). Static
    // seed members UNION env DIDs, deduped; each is an idempotent ON CONFLICT DO
    // NOTHING insert tagged source='seed'.
    const memberDids = unionMemberDids(t.members, envMemberDids(t.secretPrefix))
    for (const did of memberDids) {
      try {
        await addTenantMember(t.tenantId, did, db, 'seed')
      } catch (e) {
        // validateMemberDids should have caught any cross-tenant duplicate above;
        // this is a belt-and-suspenders map of a UNIQUE(did) violation (e.g. a row
        // bound out-of-band to another tenant since validation) to an actionable,
        // DID-naming seed error rather than a raw driver error.
        if (e instanceof MemberDidCollisionError) {
          throw new Error(
            `seed: member DID '${did}' (tenant '${t.tenantId}') is already bound to another tenant; ` +
              `reconcile membership before re-seeding`,
            { cause: e },
          )
        }
        throw e
      }
    }
  }
}

// ── Per-tenant integration seed (P5b) ────────────────────────────────────────

/** A connection status as stored in `engine_tenant_integrations.status`. */
export type IntegrationSeedStatus = 'enabled' | 'pending' | 'disabled'

/** One desired integration connection for a tenant (parsed from env). */
export interface IntegrationSeedEntry {
  integrationId: string
  status: IntegrationSeedStatus
}

const INTEGRATION_STATUSES: readonly IntegrationSeedStatus[] = ['enabled', 'pending', 'disabled']

/**
 * Parse a tenant's `${secretPrefix}_INTEGRATIONS` env value (P5b, mirrors
 * `envMemberDids`). Format: comma-separated `id:status` pairs, e.g.
 * `shopify:enabled,mercado-libre:pending`. A bare `id` (no `:status`) defaults to
 * `'enabled'`. Trims, drops empty pairs. Does NOT validate against the registry
 * (that is `validateIntegrationSeeds`) — a pair whose status string is not a known
 * status is kept VERBATIM here so the validator can reject it loudly.
 *
 * An unset/blank env → `[]`. Later pairs for the same id WIN (last-write).
 */
export function parseIntegrationSeed(raw: string | undefined): IntegrationSeedEntry[] {
  if (!raw?.trim()) return []
  const out = new Map<string, IntegrationSeedStatus>()
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(':')
    const integrationId = (idx === -1 ? trimmed : trimmed.slice(0, idx)).trim()
    if (!integrationId) continue
    const statusRaw = idx === -1 ? 'enabled' : trimmed.slice(idx + 1).trim()
    out.set(integrationId, (statusRaw || 'enabled') as IntegrationSeedStatus)
  }
  return [...out].map(([integrationId, status]) => ({ integrationId, status }))
}

/**
 * Validate parsed integration seed entries. THROWS on the FIRST violation (fail
 * the deploy loudly — never silently skip):
 *   - every `integrationId` MUST exist in the live integration registry
 *     (`listIntegrations()`),
 *   - every `status` MUST be one of enabled | pending | disabled.
 */
export function validateIntegrationSeeds(
  entries: IntegrationSeedEntry[],
  integrationIds: string[] = listIntegrations().map((d) => d.id),
): void {
  const known = new Set(integrationIds)
  for (const e of entries) {
    if (!known.has(e.integrationId)) {
      throw new Error(
        `integration seed references unknown integration '${e.integrationId}' (not in listIntegrations())`,
      )
    }
    if (!INTEGRATION_STATUSES.includes(e.status)) {
      throw new Error(
        `integration seed for '${e.integrationId}' has invalid status '${e.status}' (must be ${INTEGRATION_STATUSES.join(' | ')})`,
      )
    }
  }
}

/**
 * Seed (idempotent upsert) per-tenant integration connections from env
 * (`${secretPrefix}_INTEGRATIONS`). For each tenant with a non-null secretPrefix:
 *
 *   1) UPSERT each desired (tenant_id, integration_id): set status from the seed,
 *      bump updated_at; `connected_at` is set ONCE on the first 'enabled' (then
 *      preserved, untouched for pending/disabled).
 *   2) Any EXISTING row for the tenant whose integration_id is NOT in the desired
 *      set is flipped to status='disabled' (NEVER deleted — keep the audit row).
 *
 * A tenant with an unset/blank `${secretPrefix}_INTEGRATIONS` desires nothing →
 * its existing rows are all disabled (no rows inserted). Raw db access is fine
 * here (this module is allowlisted in scripts/check-scoped-db.sh).
 */
export async function seedTenantIntegrations(
  db: typeof defaultDb = defaultDb,
  seeds: TenantSeed[] = TENANT_SEEDS,
): Promise<void> {
  const I = schema.engineTenantIntegrations
  for (const t of seeds) {
    if (t.secretPrefix === null) continue
    const desired = parseIntegrationSeed(process.env[`${t.secretPrefix}_INTEGRATIONS`])
    validateIntegrationSeeds(desired)

    for (const e of desired) {
      await db
        .insert(I)
        .values({
          tenantId: t.tenantId,
          integrationId: e.integrationId,
          status: e.status,
          connectedAt: e.status === 'enabled' ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [I.tenantId, I.integrationId],
          set: {
            status: sql`excluded.status`,
            updatedAt: sql`now()`,
            // connected_at: set ONCE on first 'enabled', preserved after, untouched
            // for pending/disabled.
            connectedAt: sql`case when excluded.status = 'enabled' then coalesce(${I.connectedAt}, now()) else ${I.connectedAt} end`,
          },
        })
    }

    // Disable (never delete) any existing row not in the desired set — audit row stays.
    const desiredIds = desired.map((e) => e.integrationId)
    const existing = await db
      .select({ integrationId: I.integrationId })
      .from(I)
      .where(eq(I.tenantId, t.tenantId))
    const toDisable = existing
      .map((r) => r.integrationId)
      .filter((id) => !desiredIds.includes(id))
    if (toDisable.length > 0) {
      await db
        .update(I)
        .set({ status: 'disabled', updatedAt: sql`now()` })
        .where(and(eq(I.tenantId, t.tenantId), inArray(I.integrationId, toDisable)))
    }
  }
}

// ── Per-tenant invite seed (Wave 1 / D7, insert-only bootstrap) ──────────────

/** A very loose email shape: `something@something.tld`. Not an RFC validator — a typo guard. */
const INVITE_EMAIL_RE = /^.+@.+\..+$/

/**
 * Parse a tenant's `${secretPrefix}_INVITE_EMAILS` env value (Wave 1, mirrors
 * `envMemberDids`). Comma-separated emails. Each is trimmed, LOWERCASED, blanks are
 * dropped, and the set is DEDUPED. NORMALIZATION is lowercase+trim ONLY (no Gmail
 * dot/plus collapsing — not globally safe; Codex). Entries that fail the loose
 * email-shape check are KEPT VERBATIM here so `validateInviteEmails` can reject them
 * loudly; an unset/blank env → `[]`.
 */
export function parseInviteEmails(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const email = part.trim().toLowerCase()
    if (email) seen.add(email)
  }
  return [...seen]
}

/**
 * Validate parsed invite emails — THROWS on the FIRST address that fails the loose
 * shape check (`/.+@.+\..+/`) so a typo in `${secretPrefix}_INVITE_EMAILS` fails the
 * deploy loudly rather than seeding an unmatchable invite row.
 */
export function validateInviteEmails(emails: string[]): void {
  for (const email of emails) {
    if (!INVITE_EMAIL_RE.test(email)) {
      throw new Error(
        `invite seed: '${email}' is not a valid email address (must match ${INVITE_EMAIL_RE})`,
      )
    }
  }
}

/**
 * Seed (INSERT-ONLY bootstrap, D7) per-tenant invites from env
 * (`${secretPrefix}_INVITE_EMAILS`). For each tenant with a non-null secretPrefix,
 * parse + validate the email list and INSERT each as a `status='pending'` row with
 * `ON CONFLICT (tenant_id, email) DO NOTHING`. This NEVER updates, NEVER revokes,
 * and NEVER treats env-absence as a signal: env is a one-time bootstrap, the DB is
 * the source of truth. A claimed/revoked row is left exactly as it is on re-deploy.
 * Deprovisioning is a DB op (deprovision-invite.ts), never an env side effect.
 *
 * Raw db access is fine here (this module is allowlisted in scripts/check-scoped-db.sh).
 */
export async function seedTenantInvites(
  db: typeof defaultDb = defaultDb,
  seeds: TenantSeed[] = TENANT_SEEDS,
): Promise<void> {
  const V = schema.engineTenantInvites
  for (const t of seeds) {
    if (t.secretPrefix === null) continue
    const emails = parseInviteEmails(process.env[`${t.secretPrefix}_INVITE_EMAILS`])
    validateInviteEmails(emails)
    for (const email of emails) {
      await db
        .insert(V)
        .values({ tenantId: t.tenantId, email, status: 'pending' })
        .onConflictDoNothing({ target: [V.tenantId, V.email] })
    }
  }
}

/** Deploy entrypoint: `tsx apps/engine-api/src/seed-tenants.ts`. */
async function main(): Promise<void> {
  await seedTenants()
  await seedTenantIntegrations()
  await seedTenantInvites()
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
