import { Download, FileText, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { downloadText } from '@/lib/download'
import { localizeReport, type DownloadReport } from '@/data/mipase-reports'
import type { Locale } from '@/i18n'

/**
 * Download card for one curated Mi Pase report — pop-card chrome (matches
 * IntegrationCard): ink border + hard-offset stamp, serif title, headline stats,
 * and a Download button that streams the bundled file via a Blob (no network).
 */

const ICON = {
  reconciliation: FileText,
  pricing: TrendingDown,
} as const

export interface ReportCardProps {
  report: DownloadReport
  locale: Locale
  /** "Download", "Generated" — passed in so the page owns the localized chrome. */
  labels: { download: string; generated: string }
}

export function ReportCard({ report, locale, labels }: ReportCardProps) {
  const r = localizeReport(report, locale)
  const Icon = ICON[report.icon]
  const headingId = `report-${report.id}`

  return (
    <article
      aria-labelledby={headingId}
      className="btn flex h-full flex-col items-stretch justify-start gap-4 bg-[var(--surface)] p-5 text-left"
    >
      <header className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center border border-[var(--rule)] bg-[var(--background)]"
        >
          <Icon className="size-4 text-[var(--accent-text)]" />
        </span>
        <div className="space-y-1">
          <h3 id={headingId} className="font-serif text-lg leading-tight text-[var(--foreground)]">
            {r.titleText}
          </h3>
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
            {labels.generated} {report.generatedAt}
          </p>
        </div>
      </header>

      <p className="text-sm leading-relaxed text-[var(--foreground-soft)]">{r.descriptionText}</p>

      <div className="flex flex-wrap items-center gap-2">
        {r.stats.map((s) => (
          <Pill key={s.labelText} status={s.tone ?? 'idle'} iconLabel={s.labelText} showTick={false}>
            <span className="font-semibold">{s.value}</span>
            <span className="ml-1 text-[var(--foreground-soft)]">{s.labelText}</span>
          </Pill>
        ))}
      </div>

      <div className="mt-auto pt-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => downloadText(report.download.filename, report.download.content, report.download.mime)}
        >
          <Download className="size-4" aria-hidden="true" />
          {labels.download}
        </Button>
      </div>
    </article>
  )
}
