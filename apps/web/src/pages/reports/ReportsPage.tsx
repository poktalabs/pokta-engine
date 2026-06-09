import { FileBarChart } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ErrorEnvelope } from '@godin-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { ApiError } from '@/lib/api'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Pill } from '@/components/ui/pill'
import type { ReportMetric, ReportSummary } from '@/mocks/reports'
import { useReports } from './use-reports'

/**
 * Reports index (M2 P4-B).
 *
 * Lists the engine-produced reports for the active tenant — Mi Pase (daily
 * pricing impact, competitor metadata research) or Vino (CEO brief, pipeline
 * health, stale leads) — driven by TenantProvider, on mock data behind
 * `VITE_USE_MOCKS`. Renders the full state matrix (loading / empty / error +
 * 403 / loaded). Each card opens its report at `reports/:id`.
 *
 * Self-contained so it can be mounted by the route tree (P1-B owns App.tsx) when
 * the placeholder is swapped for this surface.
 */

function ReportDate({ iso }: { iso: string }) {
  // Locale-aware once P7 wires the user locale; en-US is the English-first default.
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
  return <time dateTime={iso}>{formatted}</time>
}

function HeadlineMetric({ metric }: { metric: ReportMetric }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-sans text-base font-semibold leading-none text-[var(--foreground)]">
        {metric.tone ? (
          <Pill status={metric.tone} className="align-middle">
            {metric.value}
          </Pill>
        ) : (
          metric.value
        )}
      </span>
      <span className="kicker text-[var(--muted-foreground)]">{metric.label}</span>
    </div>
  )
}

function ReportRow({ report }: { report: ReportSummary }) {
  return (
    <li className="bg-[var(--surface)]">
      <Link
        to={report.id}
        className="block px-6 py-5 transition-colors hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)]"
      >
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 space-y-1">
            <h2 className="font-serif text-xl leading-tight text-[var(--foreground)]">
              {report.title}
            </h2>
            <p className="max-w-[68ch] text-sm leading-relaxed text-[var(--foreground-soft)]">
              {report.description}
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              <ReportDate iso={report.generatedAt} />
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-start justify-end gap-x-8 gap-y-3">
            {report.headline.map((m) => (
              <HeadlineMetric key={m.label} metric={m} />
            ))}
          </div>
        </div>
      </Link>
    </li>
  )
}

export default function ReportsPage() {
  const tenant = useTenant()
  const { data, isPending, isError, error, refetch } = useReports(tenant.id)

  const header = (
    <header className="space-y-1">
      <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Reports</h1>
      <p className="text-sm text-[var(--foreground-soft)]">
        Impact, research and pipeline-health summaries your agents produced for {tenant.name}.
      </p>
    </header>
  )

  let body: React.ReactNode
  if (isPending) {
    body = <LoadingState label="Loading reports…" />
  } else if (isError) {
    const envelope: ErrorEnvelope | undefined =
      error instanceof ApiError ? error.envelope : undefined
    body = <ErrorState error={envelope} onRetry={() => void refetch()} />
  } else if (data.reports.length === 0) {
    body = (
      <EmptyState
        Icon={FileBarChart}
        title="No reports yet"
        description="When your workflows finish a run, the reports they produce show up here."
      />
    )
  } else {
    body = (
      <ul className="grid gap-px border border-[var(--rule)] bg-[var(--rule)]">
        {data.reports.map((report) => (
          <ReportRow key={report.id} report={report} />
        ))}
      </ul>
    )
  }

  return (
    <section className="space-y-6">
      {header}
      {body}
    </section>
  )
}
