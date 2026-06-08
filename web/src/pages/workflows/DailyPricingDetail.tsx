import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertOctagon,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Play,
  Sparkles,
} from 'lucide-react'
import { useTenant } from '@/providers/TenantProvider'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { ScheduleEditor } from '@/components/workflows/ScheduleEditor'
import { PipelineFlow } from '@/components/workflows/PipelineFlow'
import { RunHistoryTable } from '@/components/workflows/RunHistoryTable'
import {
  MOCK_DAILY_PRICING_BY_STATE,
  type WorkflowDetail,
  type WorkflowDetailState,
} from '@/mocks/workflows'

/**
 * Daily Pricing detail surface (M2 P3-A) — the worked workflow example.
 *
 * Shows today's status, a Run-now PRIMARY action, the ScheduleEditor (daily-time
 * picker + raw-cron, editing disabled), the pipeline-flow graphic with the amber
 * approval-gate node, and the run-history table. Covers all five states:
 * idle / empty / running / held / failed — selectable via `?state=` for the demo
 * (defaults to the fixture's own `held` state). P5b wires this to real run data.
 *
 * Brand: Source Serif headings, hairline frames, exactly one amber primary
 * (Run now) per decision point, status by pill (icon + label, never color alone).
 */

const VALID_STATES: readonly WorkflowDetailState[] = [
  'idle',
  'empty',
  'running',
  'held',
  'failed',
]

function isDetailState(v: string | null): v is WorkflowDetailState {
  return v != null && (VALID_STATES as readonly string[]).includes(v)
}

/** A per-state banner: tone + copy keyed to the lifecycle state. */
function StateBanner({ detail }: { detail: WorkflowDetail }) {
  switch (detail.state) {
    case 'held':
      return (
        <Banner
          tone="warn"
          title={`${detail.pendingCount} price changes need your review`}
          body="The agent finished today’s run and held the flagged changes at the approval gate. Review and apply them in Approvals."
        />
      )
    case 'running':
      return (
        <Banner
          tone="warn"
          icon={<Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />}
          title="Run in progress"
          body="The agent is pricing your catalog against live competitor data. This usually takes a few minutes."
        />
      )
    case 'failed':
      return (
        <Banner
          tone="fail"
          icon={<AlertOctagon className="size-5" aria-hidden="true" />}
          title="Last run failed"
          body="The pricing run stopped early before it could finish. Nothing was applied. Try running it again — if it keeps failing, contact support."
        />
      )
    case 'empty':
      return (
        <Banner
          tone="idle"
          icon={<Sparkles className="size-5" aria-hidden="true" />}
          title="Not run yet"
          body="This workflow hasn’t run. Run it now to see today’s suggested price changes, or wait for the daily schedule."
        />
      )
    case 'idle':
    default:
      return (
        <Banner
          tone="ok"
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          title="All caught up"
          body="Today’s run is complete and there’s nothing waiting on you."
        />
      )
  }
}

const BANNER_TONE: Record<
  'ok' | 'warn' | 'fail' | 'idle',
  { wrap: string; icon: string }
> = {
  ok: {
    wrap: 'border-[var(--status-ok-line)] bg-[var(--status-ok-bg)]',
    icon: 'text-[var(--status-ok)]',
  },
  warn: {
    wrap: 'border-[var(--status-warn-line)] bg-[var(--status-warn-bg)]',
    icon: 'text-[var(--status-warn)]',
  },
  fail: {
    wrap: 'border-[var(--status-fail-line)] bg-[var(--status-fail-bg)]',
    icon: 'text-[var(--status-fail)]',
  },
  idle: {
    wrap: 'border-[var(--border)] bg-[var(--surface-2)]',
    icon: 'text-[var(--muted-foreground)]',
  },
}

function Banner({
  tone,
  title,
  body,
  icon,
}: {
  tone: 'ok' | 'warn' | 'fail' | 'idle'
  title: string
  body: string
  icon?: React.ReactNode
}) {
  const t = BANNER_TONE[tone]
  return (
    <div className={`flex items-start gap-3 border p-5 ${t.wrap}`} role="status">
      <span className={`mt-0.5 shrink-0 ${t.icon}`}>{icon}</span>
      <div className="space-y-1">
        <p className="font-serif text-lg leading-snug text-[var(--foreground)]">{title}</p>
        <p className="text-sm leading-relaxed text-[var(--foreground-soft)]">{body}</p>
      </div>
    </div>
  )
}

export default function DailyPricingDetail() {
  const tenant = useTenant()
  const [searchParams] = useSearchParams()
  const requested = searchParams.get('state')

  const detail = useMemo<WorkflowDetail>(
    () => MOCK_DAILY_PRICING_BY_STATE[isDetailState(requested) ? requested : 'held'],
    [requested],
  )

  // Mock Run-now: flips a local "running" flag for feedback; no network (P5b wires it).
  const [running, setRunning] = useState(false)
  const isRunning = detail.state === 'running' || running

  const workflowsBase = `/${tenant.id}/workflows`
  const runsBase = `/${tenant.id}/runs`
  const approvalsHref = `/${tenant.id}/approvals`

  return (
    <section className="space-y-8">
      {/* Header: back link, title, today's status, Run-now. */}
      <header className="space-y-4">
        <Link
          to={workflowsBase}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Workflows
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
                {detail.name}
              </h1>
              <Pill
                status={detail.state === 'failed' ? 'fail' : detail.state === 'held' || isRunning ? 'warn' : 'idle'}
                showTick
              >
                {detail.trigger.label}
              </Pill>
            </div>
            <p className="max-w-[64ch] text-sm leading-relaxed text-[var(--foreground-soft)]">
              {detail.description}
            </p>
            <p className="text-sm font-medium text-[var(--foreground)]">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                Today{' · '}
              </span>
              {isRunning && detail.state !== 'running'
                ? 'Analyzing catalog…'
                : detail.todayStatus}
            </p>
          </div>

          {/* Exactly one amber primary per decision point: Run now. */}
          <Button
            onClick={() => setRunning(true)}
            disabled={isRunning}
            className="shrink-0"
          >
            {isRunning ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {isRunning ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </header>

      {/* State banner (idle / empty / running / held / failed). */}
      <StateBanner detail={detail} />

      {/* Held → a direct path to the approvals queue. */}
      {detail.state === 'held' && detail.pendingCount > 0 && (
        <div>
          <Button asChild variant="secondary" size="sm">
            <Link to={approvalsHref}>Review {detail.pendingCount} flagged changes</Link>
          </Button>
        </div>
      )}

      {/* Pipeline-flow graphic with the amber approval-gate node. */}
      <div className="space-y-3">
        <h2 className="font-serif text-xl leading-tight text-[var(--foreground)]">
          How it runs
        </h2>
        <PipelineFlow
          nodes={detail.pipeline}
          activeNodeId={isRunning ? 'draft' : detail.activeNodeId}
        />
      </div>

      {/* Schedule editor (editing disabled in M2). */}
      <ScheduleEditor schedule={detail.schedule} />

      {/* Run history. */}
      <div className="space-y-3">
        <h2 className="font-serif text-xl leading-tight text-[var(--foreground)]">
          Run history
        </h2>
        <RunHistoryTable rows={detail.history} runsBasePath={runsBase} />
      </div>
    </section>
  )
}
