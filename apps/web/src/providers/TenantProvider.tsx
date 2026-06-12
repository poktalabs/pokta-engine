import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TenantView } from '@godin-engine/contract'
import { ApiError, apiFetch } from '@/lib/api'

/**
 * Tenant boundary (PR2b W4) — the ACTIVE tenant now comes from the server, not a
 * client-trusted URL segment + hardcoded config. TenantProvider fetches
 * `GET /v1/tenants/me` (a live path even under mocks; see api.ts `LIVE_PATHS`),
 * caches it via React Query, and exposes the server `TenantView`:
 * `branding`/`currency`/`locale`/`allowedWorkflows`.
 *
 * The hardcoded `TENANTS` record is GONE (the server is the single source of
 * truth). `data-tenant` still drives any per-tenant CSS hook, keyed off the
 * server tenant id.
 *
 * Transparent auto-provision (tenant-invites Wave 2, D4): a `403 TENANT_UNKNOWN`
 * is the UNPROVISIONED case. Instead of going straight to ACCESS-DENIED, the
 * provider fires `POST /v1/tenants/claim` ONCE (single-flight, ref-guarded) and
 * surfaces a transient `provisioning` status ("setting up your workspace") while
 * it is in flight. On claim SUCCESS it invalidates + refetches `/v1/tenants/me`
 * (a now-bound tenant resolves → `ready`; but if the refetch is STILL
 * TENANT_UNKNOWN it fails closed to `access-denied`, never a stuck spinner). On
 * claim FAILURE (any error, incl. a 404 when the Wave-1 backend is not yet
 * deployed, or a persistent TENANT_UNKNOWN) it resolves to the terminal
 * `access-denied` screen. The claim fires AT MOST ONCE per mount — a persistent
 * TENANT_UNKNOWN never loops claims.
 *
 * CRITICAL invariant: ONLY `TENANT_UNKNOWN` (403) triggers the claim. A `401
 * UNAUTHENTICATED` is handled INSIDE `apiFetch` (single-shot re-auth → logout) and
 * never reaches here as `TENANT_UNKNOWN`, so the claim path is never taken for a
 * 401.
 *
 * Failure handling (fail closed): the terminal `access-denied` screen (rendered by
 * the router) is reached when a DID is in no tenant AND the claim could not bind
 * one — NEVER a default/other tenant, and NOT the generic mutation toast. Other
 * (non-`TENANT_UNKNOWN`) errors surface as a generic error state with retry.
 *
 * TenantProvider sits ABOVE the router and cannot navigate; the `/:tenant`
 * redirect-on-mismatch guard lives at the router level (AppShell, W4) and reads
 * the resolved tenant id from here.
 */

/** The active tenant ids the SPA knows by route segment. Server is authoritative. */
export type TenantId = 'mi-pase' | 'vino'

/**
 * Canonical default tenant id. NOTE (PR2b harden): this is NOT used to drive any
 * navigation target — the server is the tenant authority, so nav derives the tenant
 * from `/v1/tenants/me` (RootRedirect). Kept only as the canonical-id constant
 * (referenced by the rename regression test); do not reintroduce it into a URL.
 */
export const DEFAULT_TENANT: TenantId = 'mi-pase'

/** Narrow an arbitrary string (e.g. a route param) to a known tenant id. */
export function isTenantId(value: string | undefined): value is TenantId {
  return value === 'mi-pase' || value === 'vino'
}

/** A nav lockup variant — the tenant identity beside the product lockup. */
export interface TenantLockup {
  name: string
  badge?: string
}

/**
 * The view consumers read via `useTenant()`. Projected from the server
 * `TenantView` so existing call sites (`tenant.id/.name/.currency/.locale/.lockup`)
 * keep working, now backed by server truth instead of a hardcoded record.
 */
export interface TenantConfig {
  id: string
  name: string
  currency: string
  locale: string
  lockup: TenantLockup
  /** Workflow ids this tenant may dispatch (server-filtered). */
  allowedWorkflows: string[]
}

/** Project the server `TenantView` into the `TenantConfig` consumers expect. */
function toTenantConfig(view: TenantView): TenantConfig {
  return {
    id: view.id,
    name: view.name,
    currency: view.currency,
    locale: view.locale,
    lockup: { name: view.branding.name, badge: view.branding.badge },
    allowedWorkflows: view.allowedWorkflows,
  }
}

/** React Query key for the authed tenant profile. */
export const TENANT_ME_QUERY_KEY = ['tenant', 'me'] as const

interface TenantContextValue {
  /** The resolved tenant config, or `null` while loading / on error. */
  tenant: TenantConfig | null
  /** Raw server view (null until loaded) for callers that need the full payload. */
  view: TenantView | null
  status: 'loading' | 'ready' | 'access-denied' | 'error' | 'provisioning'
  /** The underlying query error (for the generic error state). */
  error: unknown
  /** Re-run the tenant query (generic error retry only). */
  refetch: () => void
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const query = useQuery<TenantView, ApiError>({
    queryKey: TENANT_ME_QUERY_KEY,
    queryFn: () => apiFetch<TenantView>('/v1/tenants/me'),
    staleTime: 5 * 60_000, // 5m — tenant identity rarely changes within a session.
    // 403 TENANT_UNKNOWN is a terminal fail-closed state, never retried; the 401
    // exclusion lives in the global retry predicate (W5). Default: no retry here.
    retry: false,
  })

  /**
   * Transparent auto-provision claim phase (D4). Combined with the query state to
   * compute the exposed status:
   *   - 'idle'     — no claim attempted (or not applicable).
   *   - 'claiming' — POST /v1/tenants/claim is in flight → exposed as 'provisioning'.
   *   - 'resolved' — the claim succeeded (200); we invalidated /me. A now-bound
   *                  tenant resolves to 'ready'. If the post-claim refetch is STILL
   *                  TENANT_UNKNOWN (read-after-write lag, a bind /me can't see, the
   *                  split-brain guard rejecting), this is TERMINAL → 'access-denied'
   *                  (NOT a permanent 'provisioning' spinner — the single-flight ref
   *                  blocks a second claim, so there is no other escape).
   *   - 'failed'   — the claim rejected (incl. 404 / claim itself TENANT_UNKNOWN) →
   *                  the TENANT_UNKNOWN query error resolves to 'access-denied'.
   * Only the in-flight 'claiming' phase maps to 'provisioning'; every completed
   * claim ('resolved' / 'failed') that is still TENANT_UNKNOWN fails closed to the
   * terminal 'access-denied' screen — there is no non-terminal hang.
   */
  const [claimPhase, setClaimPhase] = useState<'idle' | 'claiming' | 'resolved' | 'failed'>(
    'idle',
  )

  /**
   * SINGLE-FLIGHT guard (★ no-loop regression). Set true BEFORE the claim fires so a
   * re-render or a persistent TENANT_UNKNOWN can NEVER fire a second claim. A claim
   * is attempted AT MOST ONCE per mount. A 401 never reaches here as TENANT_UNKNOWN
   * (apiFetch routes it to re-auth/logout), so this never fires for a 401.
   */
  const claimAttempted = useRef(false)

  // The unprovisioned case requires the CANONICAL 403 TENANT_UNKNOWN, not just the
  // envelope code. parseError trusts the body `code` over the HTTP status, so an
  // out-of-contract 401-with-TENANT_UNKNOWN-body (a misbehaving proxy/WAF fabricating
  // the engine's envelope) would otherwise fire the claim on what was physically a
  // 401 — the masked-401 the invariant forbids. Gating on status === 403 keeps the
  // claim strictly on the real unprovisioned (403) path; a 401 stays UNAUTHENTICATED.
  const isTenantUnknown =
    query.isError &&
    query.error instanceof ApiError &&
    query.error.code === 'TENANT_UNKNOWN' &&
    query.error.status === 403

  useEffect(() => {
    // Fire the claim exactly once, and only for the unprovisioned (TENANT_UNKNOWN)
    // case. The ref guard makes a persistent TENANT_UNKNOWN fire at most one claim.
    if (!isTenantUnknown) return
    if (claimAttempted.current) return
    claimAttempted.current = true
    setClaimPhase('claiming')
    apiFetch<TenantView>('/v1/tenants/claim', { method: 'POST' })
      .then(() => {
        // Bound now (or about to be) — refetch /me. A resolved tenant → 'ready'.
        // (Ignore the claim body; /me is the single source of truth.) Mark the claim
        // RESOLVED: if the refetch is still TENANT_UNKNOWN the single-flight ref blocks
        // a re-claim, so 'resolved' makes that terminal (access-denied) instead of a
        // permanent 'provisioning' spinner.
        setClaimPhase('resolved')
        void queryClient.invalidateQueries({ queryKey: TENANT_ME_QUERY_KEY })
      })
      .catch(() => {
        // Any failure (404 when Wave-1 not deployed, collision, persistent
        // TENANT_UNKNOWN, network) → terminal access-denied. Never a white-screen,
        // never an unhandled throw (D3 graceful degradation).
        setClaimPhase('failed')
      })
  }, [isTenantUnknown, queryClient])

  const value = useMemo<TenantContextValue>(() => {
    const view = query.data ?? null
    let status: TenantContextValue['status']
    if (query.isPending) status = 'loading'
    else if (isTenantUnknown) {
      // The unprovisioned case: show the transient provisioning state ONLY while the
      // single-shot claim is in flight ('claiming') or about to fire on the next tick
      // ('idle'). Once the claim has COMPLETED — whether it failed OR succeeded but /me
      // is STILL TENANT_UNKNOWN ('resolved') — fail closed to the terminal access-denied
      // screen. The single-flight ref blocks any re-claim, so 'provisioning' must never
      // be a terminal state (no permanent spinner).
      status =
        claimPhase === 'failed' || claimPhase === 'resolved' ? 'access-denied' : 'provisioning'
    } else if (query.isError) {
      status = 'error'
    } else status = 'ready'

    return {
      tenant: view ? toTenantConfig(view) : null,
      view,
      status,
      error: query.error,
      refetch: () => void query.refetch(),
    }
  }, [
    query.data,
    query.isPending,
    query.isError,
    query.error,
    query.refetch,
    isTenantUnknown,
    claimPhase,
  ])

  return (
    <TenantContext.Provider value={value}>
      <div data-tenant={value.tenant?.id ?? 'unknown'} className="contents">
        {children}
      </div>
    </TenantContext.Provider>
  )
}

/** Read the full tenant context (status/view/error). Throws outside the provider. */
export function useTenantContext(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenantContext must be used within <TenantProvider>')
  return ctx
}

/**
 * Read the active tenant config. Throws if used outside the provider OR before the
 * tenant has resolved — call sites under the workspace shell only render once the
 * router gate (AppShell) has confirmed `status==='ready'`, so this is safe there.
 */
export function useTenant(): TenantConfig {
  const ctx = useTenantContext()
  if (!ctx.tenant) {
    throw new Error('useTenant called before the tenant resolved (gate on useTenantContext().status)')
  }
  return ctx.tenant
}
