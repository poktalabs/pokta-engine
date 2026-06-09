import { useCallback } from 'react'
import { useTenant } from '@/providers/TenantProvider'
import { useLocale } from './i18n'
import type { Locale } from './catalog'

/**
 * Per-tenant currency + locale-aware number formatting (P7).
 *
 * Design rule (M2 §P7): the CURRENCY is derived from the TENANT (Mi Pase → MXN,
 * Vino → USD), never from the user's display-language preference. The LOCALE
 * (digit grouping, decimal mark) follows the user pref. So a Mi Pase operator
 * viewing the app in English still sees MXN, formatted with en-US grouping.
 */

const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-US',
  'es-MX': 'es-MX',
}

export interface MoneyOptions {
  /** Override the tenant currency (rare; e.g. competitor-ref in another currency). */
  currency?: 'MXN' | 'USD'
  /** Hide fraction digits for whole-peso displays. */
  maximumFractionDigits?: number
  minimumFractionDigits?: number
}

/**
 * Returns formatters bound to the active tenant currency + user locale.
 * `getFormattedPrice(1234.5)` → `"$1,234.50"` (MXN, en) / `"$1,234.50"` (es-MX).
 */
export function useCurrency() {
  const tenant = useTenant()
  const { locale } = useLocale()
  const intlLocale = INTL_LOCALE[locale]

  const getFormattedPrice = useCallback(
    (amount: number, opts: MoneyOptions = {}): string =>
      new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: opts.currency ?? tenant.currency,
        minimumFractionDigits: opts.minimumFractionDigits,
        maximumFractionDigits: opts.maximumFractionDigits,
      }).format(amount),
    [intlLocale, tenant.currency],
  )

  const getFormattedNumber = useCallback(
    (value: number, opts?: Intl.NumberFormatOptions): string =>
      new Intl.NumberFormat(intlLocale, opts).format(value),
    [intlLocale],
  )

  return { currency: tenant.currency, locale, getFormattedPrice, getFormattedNumber }
}
