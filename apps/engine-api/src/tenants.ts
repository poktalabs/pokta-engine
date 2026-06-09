import { eq, sql } from 'drizzle-orm'
import { db as defaultDb, schema } from '@godin-engine/db'
import { listManifests } from '@godin-engine/workflows'
import { listIntegrations } from '@godin-engine/integrations'
import type { TenantView, TenantStatus } from '@godin-engine/contract'

/**
 * The tenant REGISTRY accessor (PR2) — the single read path for `engine_tenants`,
 * shared by engine-api (resolveTenant, GET /v1/tenants/me, allow-list) AND the
 * worker (secret_prefix + split-brain guard). Each process holds its OWN ~60s
 * in-process TTL cache; a cache miss is exactly one indexed primary-key row read.
 *
 * This module is NOT an engine_runs-class scoped surface: `engine_tenants` is the
 * tenancy CONFIG table, not tenant DATA, so it is read directly here (and listed
 * in scripts/check-scoped-db.sh's allowlist). It exposes no cross-tenant DATA
 * read — only the registry rows used to decide WHO a principal is and WHAT it may
 * do. All authz decisions (active-status, membership, allow-list) are made by the
 * callers from the row this returns; this module stays a pure, cacheable reader.
 */

export type TenantRow = typeof schema.engineTenants.$inferSelect

/** A registry-row db handle: only the engine_tenants reads this module performs. */
type DbLike = typeof defaultDb

/** TTL for a cached tenant row (ms). One read per id per window; see plan §3.2. */
export const TENANT_CACHE_TTL_MS = 60_000

interface CacheEntry {
  /** The row, or `null` to negatively cache a known-absent id (still TTL-bounded). */
  row: TenantRow | null
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

/** Injectable clock so cache-expiry tests are deterministic (defaults to Date.now). */
let now: () => number = () => Date.now()

/**
 * Reset the in-process cache (and optionally the clock). FOR TESTS ONLY — keeps
 * the cache resettable between cases so a stale entry never leaks across tests.
 */
export function __resetTenantCache(clock?: () => number): void {
  cache.clear()
  now = clock ?? (() => Date.now())
}

/**
 * getTenant(id) — load one tenant row by its primary key (`tenant_id == consumer_id`),
 * memoized for ~60s. A cache miss reads the single indexed PK row; both presence
 * and absence are cached (absence still TTL-bounded so a newly-seeded tenant shows
 * up within the window). Returns `undefined` for an unknown id.
 *
 * NOTE: this returns the row regardless of status — STATUS-gating is the caller's
 * job (resolveTenant / tenants/me), so the worker's split-brain guard can also see
 * a now-disabled tenant and refuse it.
 */
export async function getTenant(id: string, db: DbLike = defaultDb): Promise<TenantRow | undefined> {
  if (!id) return undefined
  const hit = cache.get(id)
  if (hit && hit.expiresAt > now()) return hit.row ?? undefined

  const row = await db.query.engineTenants.findFirst({
    where: eq(schema.engineTenants.tenantId, id),
  })
  cache.set(id, { row: row ?? null, expiresAt: now() + TENANT_CACHE_TTL_MS })
  return row
}

/**
 * findTenantByMember(did) — resolve the tenant a Privy principal acts as: the
 * (unique) tenant whose `members[]` contains this DID. NOT cached by DID (the
 * membership index is the cheap path, and DID→tenant must reflect membership
 * edits promptly). Returns:
 *   - the row when exactly ONE tenant lists the DID,
 *   - `undefined` when NONE do, or
 *   - `{ ambiguous: true }` when MORE THAN ONE does (a misconfiguration → the
 *     caller fails closed with TENANT_UNKNOWN rather than guessing a tenant).
 */
export async function findTenantByMember(
  did: string,
  db: DbLike = defaultDb,
): Promise<TenantRow | undefined | { ambiguous: true }> {
  if (!did) return undefined
  // `members @> ARRAY[did]` — array-contains, served by tenants_members_idx.
  const rows = (await db
    .select()
    .from(schema.engineTenants)
    .where(sql`${schema.engineTenants.members} @> ARRAY[${did}]::text[]`)
    .limit(2)) as TenantRow[]
  if (rows.length === 0) return undefined
  if (rows.length > 1) return { ambiguous: true }
  return rows[0]
}

/** True iff this tenant row may resolve/dispatch (only `'active'`). */
export function isActive(row: Pick<TenantRow, 'status'>): boolean {
  return row.status === 'active'
}

/** The tenant's status as the contract enum type (display/authz hint). */
export function tenantStatusOf(row: Pick<TenantRow, 'status'>): TenantStatus {
  return row.status as TenantStatus
}

/**
 * The tenant's allow-list, intersected with the LIVE workflow registry. A
 * configured id that no longer exists in the registry is dropped (defensive: the
 * SPA / dispatch gate never references a workflow the engine cannot run).
 */
export function allowedWorkflowsFor(row: Pick<TenantRow, 'allowedWorkflows'>): string[] {
  const live = new Set(listManifests().map((m) => m.id))
  return row.allowedWorkflows.filter((id) => live.has(id))
}

/**
 * toTenantView(row, allowedWorkflowsFiltered) — project a registry row into the
 * shared `TenantView` (`@godin-engine/contract`). `branding` is coerced to the
 * typed `{ name; badge? }` shape; `allowedWorkflows` is the caller-supplied,
 * already-filtered set (defaults to `allowedWorkflowsFor(row)`); `integrations`
 * is intentionally derived from the LIVE integration registry (validated +
 * enriched) — PR2 has no per-tenant integration column yet, so a tenant surfaces
 * the integrations the engine actually ships. Server-only fields (`members`,
 * `secretPrefix`) are never included.
 */
export function toTenantView(row: TenantRow, allowedWorkflowsFiltered?: string[]): TenantView {
  const branding = (row.branding ?? {}) as { name?: string; badge?: string }
  const integrations = listIntegrations().map((d) => d.id)
  return {
    id: row.tenantId,
    name: row.name,
    status: tenantStatusOf(row),
    currency: row.currency,
    locale: row.locale,
    branding: {
      name: branding.name ?? row.name,
      ...(branding.badge ? { badge: branding.badge } : {}),
    },
    allowedWorkflows: allowedWorkflowsFiltered ?? allowedWorkflowsFor(row),
    integrations,
  }
}
