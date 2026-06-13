import { and, eq } from 'drizzle-orm'
import { db as defaultDb, schema } from '@godin-engine/db'
import { listManifests } from '@godin-engine/workflows'
import type { TenantView, TenantStatus, MemberRole } from '@godin-engine/contract'

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
export async function getTenant(
  id: string,
  db: DbLike = defaultDb,
  opts: { forceFresh?: boolean } = {},
): Promise<TenantRow | undefined> {
  if (!id) return undefined
  if (!opts.forceFresh) {
    const hit = cache.get(id)
    if (hit && hit.expiresAt > now()) return hit.row ?? undefined
  }
  // forceFresh skips the positive cache for a read that gates IRREVERSIBLE side
  // effects (the worker split-brain guard): a tenant disabled <TTL ago must be
  // seen as disabled NOW, not served stale from the ~60s window. The fresh row
  // still REFRESHES the cache so subsequent cached reads are consistent.
  const row = await db.query.engineTenants.findFirst({
    where: eq(schema.engineTenants.tenantId, id),
  })
  cache.set(id, { row: row ?? null, expiresAt: now() + TENANT_CACHE_TTL_MS })
  return row
}

/**
 * listTenants(db) — the registry rows for the superadmin tenant PICKER (admin-roles
 * Wave A). Returns the minimal `{ tenantId, name, status }` identity for every tenant,
 * ordered by name. NOT cached (the picker is a superadmin-only, low-frequency surface);
 * exposes no secrets/config. tenants.ts is the allowlisted engine_tenants reader.
 */
export async function listTenants(
  db: DbLike = defaultDb,
): Promise<Array<{ tenantId: string; name: string; status: TenantStatus }>> {
  const T = schema.engineTenants
  const rows = (await db
    .select({ tenantId: T.tenantId, name: T.name, status: T.status })
    .from(T)
    .orderBy(T.name)) as Array<{ tenantId: string; name: string; status: TenantStatus }>
  return rows
}

/**
 * findTenantByMember(did) — resolve the tenant a Privy principal acts as: the
 * (unique) tenant whose `engine_tenant_members` carries this DID. NOT cached by DID
 * (the membership read is cheap, and DID→tenant must reflect membership edits
 * promptly). The `UNIQUE(did)` guard makes the >1 case structurally unwritable, but
 * the ambiguous branch is KEPT as defense-in-depth (an out-of-band write that
 * somehow violated the guard still fails closed rather than guessing a tenant).
 * Returns:
 *   - the joined tenant row when exactly ONE membership row carries the DID,
 *   - `undefined` when NONE do, or
 *   - `{ ambiguous: true }` when MORE THAN ONE does (→ caller fails closed).
 */
export async function findTenantByMember(
  did: string,
  db: DbLike = defaultDb,
): Promise<TenantRow | undefined | { ambiguous: true }> {
  if (!did) return undefined
  // Join the membership row to its tenant; UNIQUE(did) → at most one. limit(2) keeps
  // the ambiguous-detection defense even though >1 should be unwritable.
  const rows = (await db
    .select({ tenant: schema.engineTenants })
    .from(schema.engineTenantMembers)
    .innerJoin(
      schema.engineTenants,
      eq(schema.engineTenantMembers.tenantId, schema.engineTenants.tenantId),
    )
    .where(eq(schema.engineTenantMembers.did, did))
    .limit(2)) as Array<{ tenant: TenantRow }>
  if (rows.length === 0 || !rows[0]) return undefined
  if (rows.length > 1) return { ambiguous: true }
  return rows[0].tenant
}

/**
 * A typed outcome distinguishing a member already bound to ANOTHER tenant (the
 * `UNIQUE(did)` collision) from a clean insert. Thrown by `addTenantMember` so a
 * caller (Wave 1 claim) can map a cross-tenant double-bind to a collision instead
 * of a generic DB error.
 */
export class MemberDidCollisionError extends Error {
  constructor(public readonly did: string) {
    super(`did '${did}' is already a member of another tenant`)
    this.name = 'MemberDidCollisionError'
  }
}

/** True iff a thrown DB error is the unique-violation on `tenant_members_did_unique`. */
function isDidUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; constraint?: string; constraint_name?: string; message?: string }
  if (err?.code === '23505') {
    const c = err.constraint ?? err.constraint_name ?? ''
    if (c === 'tenant_members_did_unique') return true
    // Some drivers surface the constraint only in the message.
    if (!c && typeof err.message === 'string') return err.message.includes('tenant_members_did_unique')
    return c === 'tenant_members_did_unique'
  }
  return false
}

/**
 * addTenantMember(tenantId, did, db, source?, role?) — bind a DID to a tenant,
 * INSERT-ONLY. `ON CONFLICT (tenant_id, did) DO NOTHING` makes re-adding the SAME
 * (tenant, did) an idempotent no-op (it does NOT overwrite the existing role — a role
 * change on an already-bound member goes through setMemberRole). A `UNIQUE(did)`
 * violation (the DID is already a member of ANOTHER tenant) surfaces as a typed
 * `MemberDidCollisionError` so the caller can map it to a collision; any other DB
 * error propagates unchanged. `role` (admin-roles Wave A) defaults to 'member'; the
 * claim path passes the invite's role through (D2).
 */
export async function addTenantMember(
  tenantId: string,
  did: string,
  db: DbLike = defaultDb,
  source: string | null = null,
  role: MemberRole = 'member',
): Promise<void> {
  try {
    await db
      .insert(schema.engineTenantMembers)
      .values({ tenantId, did, source, role })
      .onConflictDoNothing({
        target: [schema.engineTenantMembers.tenantId, schema.engineTenantMembers.did],
      })
  } catch (e) {
    if (isDidUniqueViolation(e)) throw new MemberDidCollisionError(did)
    throw e
  }
}

/**
 * The typed outcome of a setMemberRole call (admin-roles Wave A):
 *   - `'ok'`            — the member's role was updated (or already at the target),
 *   - `'not-a-member'`  — no membership row for (tenantId, did) — nothing to change,
 *   - `'last-admin'`    — refused: demoting this member would leave the tenant with
 *                         ZERO admins (the route maps this to 409 APPROVAL_DENIED).
 */
export type SetMemberRoleOutcome = 'ok' | 'not-a-member' | 'last-admin'

/**
 * setMemberRole(tenantId, did, role, db) — promote/demote an EXISTING member
 * (admin-roles Wave A, superadmin-only at the route). In ONE transaction: count the
 * tenant's current admins under the row's scope; if this would DEMOTE the tenant's
 * ONLY admin (role !== 'admin' AND the target is currently the sole admin) refuse
 * with `'last-admin'` (no lockout — D8). Otherwise UPDATE the member row's role. A
 * missing membership row → `'not-a-member'` (the route maps it to the same anti-enum
 * APPROVAL_DENIED). Promotions and no-op same-role writes always pass.
 */
export async function setMemberRole(
  tenantId: string,
  did: string,
  role: MemberRole,
  db: DbLike = defaultDb,
): Promise<SetMemberRoleOutcome> {
  const M = schema.engineTenantMembers
  return db.transaction(async (tx) => {
    const current = (await tx
      .select({ did: M.did, role: M.role })
      .from(M)
      .where(eq(M.tenantId, tenantId))) as Array<{ did: string; role: MemberRole }>

    const target = current.find((m) => m.did === did)
    if (!target) return 'not-a-member' as const

    // LAST-ADMIN guard (no lockout): block a demotion that empties the admin set.
    if (target.role === 'admin' && role !== 'admin') {
      const adminCount = current.filter((m) => m.role === 'admin').length
      if (adminCount <= 1) return 'last-admin' as const
    }

    if (target.role !== role) {
      await tx
        .update(M)
        .set({ role })
        .where(and(eq(M.tenantId, tenantId), eq(M.did, did)))
    }
    return 'ok' as const
  })
}

/** removeTenantMember(tenantId, did, db) — delete the membership row (idempotent). */
export async function removeTenantMember(
  tenantId: string,
  did: string,
  db: DbLike = defaultDb,
): Promise<void> {
  await db
    .delete(schema.engineTenantMembers)
    .where(
      and(
        eq(schema.engineTenantMembers.tenantId, tenantId),
        eq(schema.engineTenantMembers.did, did),
      ),
    )
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
 * already-filtered set (defaults to `allowedWorkflowsFor(row)`). Integrations are
 * NO LONGER part of this view (D-Codex#4 / P5b) — a tenant's per-integration
 * connection status is its own surface (`GET /v1/integrations`, backed by
 * `engine_tenant_integrations`). Server-only fields (`members`, `secretPrefix`)
 * are never included.
 */
export function toTenantView(row: TenantRow, allowedWorkflowsFiltered?: string[]): TenantView {
  const branding = (row.branding ?? {}) as { name?: string; badge?: string }
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
  }
}
