import type { ReactNode } from 'react'

/**
 * Tenant boundary — STUB for P0 (passthrough). Filled in P1 with the active
 * tenant id (hardcoded `mipase`) + a per-tenant config object
 * `{ name, currency, locale, lockup, integrations[] }`, applied via a
 * `data-tenant` attribute (NOT a per-tenant CSS theme — light base is locked for
 * all tenants). Innermost data provider so routes can read tenant config.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
