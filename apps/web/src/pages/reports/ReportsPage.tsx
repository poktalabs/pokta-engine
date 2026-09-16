import { FileBarChart } from 'lucide-react'
import { ComingSoon } from '@/components/ui/ComingSoon'
import { useLocale } from '@/i18n'

/**
 * Reports index.
 *
 * Reports has no backend read model yet (`GET /v1/reports*` is deferred), so this
 * stays an honest ComingSoon for every tenant. Localized via `useLocale` (es-MX
 * strings are DRAFT, pending native review).
 */

const CHROME = {
  en: {
    subtitle: 'Impact and reconciliation summaries your workflows produce.',
    soonTitle: 'No reports yet',
    soonDesc: "When your workflows produce impact and research summaries, they'll show up here.",
  },
  es: {
    subtitle: 'Resúmenes de impacto y conciliación que producen tus flujos.',
    soonTitle: 'Aún no hay reportes',
    soonDesc: 'Cuando tus flujos produzcan resúmenes de impacto e investigación, aparecerán aquí.',
  },
} as const

export default function ReportsPage() {
  const { locale } = useLocale()
  const c = CHROME[locale === 'es-MX' ? 'es' : 'en']

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Reports</h1>
        <p className="text-sm text-[var(--foreground-soft)]">{c.subtitle}</p>
      </header>

      <ComingSoon Icon={FileBarChart} title={c.soonTitle} description={c.soonDesc} />
    </section>
  )
}
