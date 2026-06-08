import type { ReactNode } from 'react'

/**
 * i18n boundary — STUB for P0 (passthrough). Filled in P7 with `useLanguage()`
 * + `useContent()` (EN primary / ES-MX), localStorage persistence (`godin-locale`).
 * Lives between Query and Tenant so content can be locale-aware while currency
 * still derives from the tenant below it.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
