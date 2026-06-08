/**
 * Local money / delta formatting for the run-detail surface.
 *
 * P7 introduces tenant-derived `Intl.NumberFormat` currency (`i18n-currency`).
 * Until that lands this module keeps the run-detail surface self-contained: it
 * formats MXN (the Mi Pase tenant currency) via `Intl.NumberFormat` directly so
 * the numbers read correctly today and the swap to the shared helper is a
 * one-line change later.
 */

const MXN = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})

/** Format an amount as MXN (no decimals — Mi Pase shelf prices are whole pesos). */
export function formatMXN(amount: number): string {
  return MXN.format(amount)
}

/** Format a signed percent delta, e.g. `+38.9%` / `−5.8%` / `No change`. */
export function formatDelta(deltaPct: number): string {
  if (deltaPct === 0) return 'No change'
  const sign = deltaPct > 0 ? '+' : '−'
  return `${sign}${Math.abs(deltaPct).toFixed(1)}%`
}

/** Compact integer formatting (e.g. `1,284`). */
const INT = new Intl.NumberFormat('en-US')
export function formatCount(value: number): string {
  return INT.format(value)
}
