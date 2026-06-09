import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
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
 * Failure handling (fail closed): a `403 TENANT_UNKNOWN` (the DID is in no
 * tenant's `members[]`) is surfaced as a dedicated state so the router renders an
 * ACCESS-DENIED screen — NEVER a default/other tenant, and NOT the generic
 * mutation toast. Other errors surface as a generic error state with retry.
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
  status: 'loading' | 'ready' | 'access-denied' | 'error'
  /** The underlying query error (for the generic error state). */
  error: unknown
  /** Re-run the tenant query (generic error retry only). */
  refetch: () => void
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({ children }: { children: ReactNode }) {
  const query = useQuery<TenantView, ApiError>({
    queryKey: TENANT_ME_QUERY_KEY,
    queryFn: () => apiFetch<TenantView>('/v1/tenants/me'),
    staleTime: 5 * 60_000, // 5m — tenant identity rarely changes within a session.
    // 403 TENANT_UNKNOWN is a terminal fail-closed state, never retried; the 401
    // exclusion lives in the global retry predicate (W5). Default: no retry here.
    retry: false,
  })

  const value = useMemo<TenantContextValue>(() => {
    const view = query.data ?? null
    let status: TenantContextValue['status']
    if (query.isPending) status = 'loading'
    else if (query.isError) {
      status =
        query.error instanceof ApiError && query.error.code === 'TENANT_UNKNOWN'
          ? 'access-denied'
          : 'error'
    } else status = 'ready'

    return {
      tenant: view ? toTenantConfig(view) : null,
      view,
      status,
      error: query.error,
      refetch: () => void query.refetch(),
    }
  }, [query.data, query.isPending, query.isError, query.error, query.refetch])

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
