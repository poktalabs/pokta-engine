import type { ReportChart } from '@/mocks/reports'
import { cn } from '@/lib/utils'

/**
 * A simple horizontal bar chart for the opened report (M2 P4-B).
 *
 * Deliberately dependency-free and on-brand: hairline frame, square ticks, status
 * tones from `status-tokens.css`, radius 0. Bars are sized as a percentage of the
 * series max. The chart is exposed to assistive tech as a small data table-like
 * list (each bar carries its numeric value as text — never meaning by color
 * alone, matching the pill/risk brand rule).
 */

const TONE_BG: Record<NonNullable<ReportChart['bars'][number]['tone']>, string> = {
  ok: 'bg-[var(--status-ok)]',
  warn: 'bg-[var(--status-warn)]',
  fail: 'bg-[var(--status-fail)]',
  idle: 'bg-[var(--status-idle)]',
}

export function ReportBarChart({ chart }: { chart: ReportChart }) {
  const max = Math.max(...chart.bars.map((b) => b.value), 0)
  return (
    <figure className="border border-[var(--rule)] bg-[var(--surface)] p-6">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="font-serif text-lg leading-tight text-[var(--foreground)]">
          {chart.title}
        </span>
        {chart.unit && (
          <span className="kicker text-[var(--muted-foreground)]">{chart.unit}</span>
        )}
      </figcaption>
      <ul className="mt-5 space-y-3">
        {chart.bars.map((bar) => {
          const pct = max > 0 ? Math.max((bar.value / max) * 100, 2) : 0
          const tone = bar.tone ?? 'idle'
          return (
            <li key={bar.label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3">
              <span className="truncate font-sans text-sm text-[var(--foreground-soft)]" title={bar.label}>
                {bar.label}
              </span>
              <span
                className="h-3 bg-[var(--surface-2)]"
                role="img"
                aria-label={`${bar.label}: ${bar.value} ${chart.unit ?? ''}`.trim()}
              >
                <span
                  className={cn('block h-full', TONE_BG[tone])}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="text-right font-sans text-sm font-semibold tabular-nums text-[var(--foreground)]">
                {bar.value}
              </span>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}
