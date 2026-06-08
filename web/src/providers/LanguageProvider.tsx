import type { ReactNode } from 'react'
import { LocaleProvider } from '@/i18n'

/**
 * i18n boundary (P7 — fills the P0 stub). Delegates to the `@/i18n`
 * `LocaleProvider`, which owns the active locale, localStorage persistence
 * (`godin-locale`), `<html lang>` sync, and the `useT()` resolver.
 *
 * Stays in its locked position between Query and Tenant: content is locale-aware
 * here, while currency still derives from the tenant below it (see `useCurrency`).
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>
}
