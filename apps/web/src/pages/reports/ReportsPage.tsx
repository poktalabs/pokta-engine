import { FileBarChart } from 'lucide-react'
import { ComingSoon } from '@/components/ui/ComingSoon'
import { useTenant } from '@/providers/TenantProvider'
import { useLocale } from '@/i18n'
import { MIPASE_REPORTS } from '@/data/mipase-reports'
import { ReportCard } from './ReportCard'

/**
 * Reports index.
 *
 * Reports has no backend read model yet (`GET /v1/reports*` is deferred), so for
 * most tenants this stays an honest ComingSoon. The `mi-pase` tenant has curated
 * delivery artifacts shipped as static bundle data — rendered as download cards.
 * Localized via `useLocale` (es-MX strings are DRAFT, pending native review).
 */

const CHROME = {
  en: {
    subtitle: 'Impact and reconciliation summaries your workflows produce.',
    download: 'Download',
    generated: 'Generated',
    soonTitle: 'No reports yet',
    soonDesc: "When your workflows produce impact and research summaries, they'll show up here.",
  },
  es: {
    subtitle: 'Resúmenes de impacto y conciliación que producen tus flujos.',
    download: 'Descargar',
    generated: 'Generado',
    soonTitle: 'Aún no hay reportes',
    soonDesc: 'Cuando tus flujos produzcan resúmenes de impacto e investigación, aparecerán aquí.',
  },
} as const

export default function ReportsPage() {
  const tenant = useTenant()
  const { locale } = useLocale()
  const c = CHROME[locale === 'es-MX' ? 'es' : 'en']

  const reports = tenant.id === 'mi-pase' ? MIPASE_REPORTS : []

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Reports</h1>
        <p className="text-sm text-[var(--foreground-soft)]">{c.subtitle}</p>
      </header>

      {reports.length === 0 ? (
        <ComingSoon Icon={FileBarChart} title={c.soonTitle} description={c.soonDesc} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              locale={locale}
              labels={{ download: c.download, generated: c.generated }}
            />
          ))}
        </div>
      )}
    </section>
  )
}
