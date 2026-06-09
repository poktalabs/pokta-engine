import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, FileBarChart } from 'lucide-react'
import type { ErrorEnvelope } from '@godin-engine/contract'
import { ApiError } from '@/lib/api'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Pill } from '@/components/ui/pill'
import { HairlineGrid } from '@/components/ui/HairlineGrid'
import { StatTile } from '@/components/ui/StatTile'
import type { ReportDetail, ReportMetric } from '@/mocks/reports'
import { useReport } from './use-reports'
import { ReportTable } from './ReportTable'
import { ReportBarChart } from './ReportBarChart'

/**
 * Report detail (M2 P4-B) — one opened report.
 *
 * Summary prose + headline stat tiles + an optional hairline table + an optional
 * simple bar chart, on mock data behind `VITE_USE_MOCKS`. Renders the full state
 * matrix (loading / empty / error + 403 / loaded). Reads the report id from the
 * `:id` route param (the route tree, owned by P1-B, mounts this at
 * `reports/:id`).
 */

/** Clamp the stat-tile grid columns to a sensible 2–4 for the metric count. */
function metricCols(count: number): 2 | 3 | 4 {
  if (count >= 4) return 4
  if (count === 3) return 3
  return 2
}

/** Map a metric tone to a stat-tile detail pill (icon + label, never color alone). */
function MetricDetail({ metric }: { metric: ReportMetric }) {
  if (!metric.tone) return null
  return <Pill status={metric.tone}>{metric.tone === 'idle' ? 'Note' : metric.tone}</Pill>
}

function Loaded({ report }: { report: ReportDetail }) {
  const generated = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(report.generatedAt))

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
          {report.title}
        </h1>
        <p className="text-xs text-[var(--muted-foreground)]">
          Generated <time dateTime={report.generatedAt}>{generated}</time> · run{' '}
          <span className="font-sans tabular-nums">{report.sourceRunId}</span>
        </p>
      </header>

      <section className="max-w-[72ch] space-y-4">
        {report.summary.map((para, i) => (
          <p key={i} className="text-base leading-relaxed text-[var(--foreground-soft)]">
            {para}
          </p>
        ))}
      </section>

      {report.metrics.length > 0 && (
        <HairlineGrid cols={metricCols(report.metrics.length)}>
          {report.metrics.map((metric, i) => (
            <StatTile
              key={metric.label}
              index={i + 1}
              label={metric.label}
              value={metric.value}
              detail={<MetricDetail metric={metric} />}
            />
          ))}
        </HairlineGrid>
      )}

      {report.table && (
        <ReportTable
          title={report.table.title}
          columns={report.table.columns}
          rows={report.table.rows}
        />
      )}

      {report.chart && <ReportBarChart chart={report.chart} />}
    </article>
  )
}

export default function ReportDetailPage() {
  const { id } = useParams()
  const { data, isPending, isError, error, refetch } = useReport(id)

  const back = (
    <Link
      to=".."
      relative="path"
      className="inline-flex items-center gap-1.5 text-sm text-[var(--foreground-soft)] transition-colors hover:text-[var(--foreground)]"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      All reports
    </Link>
  )

  let body: React.ReactNode
  if (isPending) {
    body = <LoadingState label="Loading report…" />
  } else if (isError) {
    const envelope: ErrorEnvelope | undefined =
      error instanceof ApiError ? error.envelope : undefined
    // A not-found report (or any non-403 failure) renders an actionable error;
    // 403 collapses to the forbidden variant via the shared ErrorState.
    body = envelope ? (
      <ErrorState error={envelope} onRetry={() => void refetch()} />
    ) : (
      <EmptyState
        Icon={FileBarChart}
        title="Report not found"
        description="This report may have been removed or the link is out of date."
      />
    )
  } else {
    body = <Loaded report={data} />
  }

  return (
    <section className="space-y-6">
      {back}
      {body}
    </section>
  )
}
