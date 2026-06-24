import reconciliationMd from './reports/mi-pase/data-reconciliation.md?raw'
import pricingCsv from './reports/mi-pase/pricing-recommendations.csv?raw'
import type { PillStatus } from '@/components/ui/pill'
import type { Locale } from '@/i18n'

/**
 * Curated Mi Pase reports, shipped as static data in the app bundle.
 *
 * These are hand-produced delivery artifacts (a one-time catalog↔cost data
 * reconciliation + a recommend-mode pricing snapshot), not engine-generated
 * yet — the Reports backend read model (`GET /v1/reports*`) is deferred. They
 * render as download cards in the LOGIN-GATED workspace for the `mi-pase` tenant
 * only. NOTE: the bundle is still publicly fetchable; this data is commercially
 * sensitive (supplier cost + competitor refs), so real isolation needs an authed
 * download endpoint scoped to the Privy tenant — track that before client #2.
 *
 * es-MX copy below is a DRAFT pending native review (repo P7-D rule) — do not
 * treat the Spanish strings as final client-facing copy.
 */

/** A short bilingual string (en is canonical; es-MX is a draft). */
export interface Bilingual {
  en: string
  es: string
}

const pick = (b: Bilingual, locale: Locale): string => (locale === 'es-MX' ? b.es : b.en)

/** A headline stat shown on the report card. */
export interface ReportStat {
  label: Bilingual
  value: string
  tone?: PillStatus
}

/** One downloadable report card. */
export interface DownloadReport {
  id: string
  /** Drives the card icon (mapped to a lucide glyph in the card). */
  icon: 'reconciliation' | 'pricing'
  title: Bilingual
  description: Bilingual
  /** ISO 8601 — when this artifact was produced (display only). */
  generatedAt: string
  /** Up to three headline stats. */
  stats: ReportStat[]
  /** The downloaded file. */
  download: { filename: string; mime: string; content: string }
}

export const MIPASE_REPORTS: DownloadReport[] = [
  {
    id: 'mipase-data-reconciliation',
    icon: 'reconciliation',
    title: {
      en: 'Data reconciliation report',
      es: 'Reporte de conciliación de datos',
    },
    description: {
      en: 'Cross-check of the cost/margin file against the live Shopify store before any pricing run — match coverage, gaps and data-quality issues.',
      es: 'Cruce del archivo de costos/márgenes contra la tienda Shopify en vivo antes de cualquier corrida de precios — cobertura, faltantes y problemas de calidad de datos.',
    },
    generatedAt: '2026-06-24',
    stats: [
      { label: { en: 'CSV SKUs', es: 'SKUs en CSV' }, value: '602' },
      { label: { en: 'Active in store', es: 'Activos en tienda' }, value: '59' },
      { label: { en: 'Ready to price', es: 'Listos para precio' }, value: '47', tone: 'ok' },
    ],
    download: {
      filename: 'mi-pase-data-reconciliation.md',
      mime: 'text/markdown',
      content: reconciliationMd,
    },
  },
  {
    id: 'mipase-pricing-recommendations',
    icon: 'pricing',
    title: {
      en: 'Daily pricing recommendations',
      es: 'Recomendaciones de precio diarias',
    },
    description: {
      en: 'Recommend-mode pricing over the active, costed catalog at a 15% margin floor: per-SKU decision, suggested price and change vs. the live store price.',
      es: 'Precios en modo recomendación sobre el catálogo activo con costo, piso de margen 15%: decisión por SKU, precio sugerido y cambio vs. el precio en vivo.',
    },
    generatedAt: '2026-06-24',
    stats: [
      { label: { en: 'SKUs priced', es: 'SKUs evaluados' }, value: '54' },
      { label: { en: 'Lower price', es: 'Bajar precio' }, value: '11', tone: 'warn' },
      { label: { en: 'Net change (MXN)', es: 'Cambio neto (MXN)' }, value: '-$65,086', tone: 'warn' },
    ],
    download: {
      filename: 'mi-pase-pricing-recommendations.csv',
      mime: 'text/csv',
      content: pricingCsv,
    },
  },
]

/** Localized title/description/stat labels for rendering. */
export function localizeReport(report: DownloadReport, locale: Locale) {
  return {
    ...report,
    titleText: pick(report.title, locale),
    descriptionText: pick(report.description, locale),
    stats: report.stats.map((s) => ({ ...s, labelText: pick(s.label, locale) })),
  }
}
