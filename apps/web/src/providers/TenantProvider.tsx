import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

/**
 * Tenant boundary (P1 — fills the P0 stub).
 *
 * Theming mechanism (M2 R3): a `data-tenant` attribute + a per-tenant config
 * object. The light base palette is LOCKED for every tenant — there is no
 * per-tenant CSS theme. Switching tenants swaps the lockup, nav config, currency
 * and integrations purely from config, with zero CSS change (proven by P4-Z).
 */

export type TenantId = 'mipase' | 'vino'

/** A nav lockup variant — the tenant identity that sits beside the Pokta lockup. */
export interface TenantLockup {
  /** Tenant display name, e.g. "Mi Pase". */
  name: string
  /** Optional amber badge text, e.g. "Shopify test store". */
  badge?: string
}

export interface TenantConfig {
  id: TenantId
  name: string
  /** ISO 4217 — drives `Intl.NumberFormat` currency (P7). */
  currency: 'MXN' | 'USD'
  /** Default locale for the tenant (user pref still overrides display locale). */
  locale: 'es-MX' | 'en'
  lockup: TenantLockup
  /** Provider ids surfaced in the Integrations grid for this tenant. */
  integrations: string[]
}

export const TENANTS: Record<TenantId, TenantConfig> = {
  mipase: {
    id: 'mipase',
    name: 'Mi Pase',
    currency: 'MXN',
    locale: 'es-MX',
    lockup: { name: 'Mi Pase', badge: 'Shopify test store' },
    integrations: [
      'shopify',
      'mercadolibre',
      'coppel',
      'elektra',
      'liverpool',
      'amazon-mx',
    ],
  },
  vino: {
    id: 'vino',
    name: 'Vino Design Build',
    currency: 'USD',
    locale: 'en',
    lockup: { name: 'Vino Design Build' },
    integrations: ['gohighlevel', 'jobtread', 'gmail', 'google-calendar', 'smartsuite'],
  },
}

/** Default active tenant for M2 single-tenant delivery. */
export const DEFAULT_TENANT: TenantId = 'mipase'

/** Narrow an arbitrary string (e.g. a route param) to a known tenant id. */
export function isTenantId(value: string | undefined): value is TenantId {
  return value === 'mipase' || value === 'vino'
}

interface TenantContextValue {
  tenant: TenantConfig
  setTenant: (id: TenantId) => void
}

const TenantContext = createContext<TenantContextValue | null>(null)

export function TenantProvider({
  children,
  tenantId = DEFAULT_TENANT,
}: {
  children: ReactNode
  /** Initial active tenant (the `/:tenant` route segment then drives it at runtime). */
  tenantId?: TenantId
}) {
  // Stateful so the `/:tenant` URL segment can switch the active tenant at runtime
  // (TenantProvider sits above the router in the locked nesting, so the shell —
  // which renders under `/:tenant` — syncs the param into here via `useSetTenant`).
  const [activeId, setActiveId] = useState<TenantId>(tenantId)
  const setTenant = useCallback((id: TenantId) => setActiveId(id), [])
  const value = useMemo<TenantContextValue>(
    () => ({ tenant: TENANTS[activeId], setTenant }),
    [activeId, setTenant],
  )
  return (
    <TenantContext.Provider value={value}>
      <div data-tenant={value.tenant.id} className="contents">
        {children}
      </div>
    </TenantContext.Provider>
  )
}

/** Read the active tenant config. Throws if used outside the provider. */
export function useTenant(): TenantConfig {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within <TenantProvider>')
  return ctx.tenant
}

/** Setter to sync the active tenant from the `/:tenant` route segment. */
export function useSetTenant(): (id: TenantId) => void {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useSetTenant must be used within <TenantProvider>')
  return ctx.setTenant
}
