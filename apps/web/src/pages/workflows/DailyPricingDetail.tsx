import { Link, useParams } from 'react-router-dom'
import {
  AlertOctagon,
  ArrowLeft,
  CheckCircle2,
  History,
  Loader2,
  Play,
  Sparkles,
} from 'lucide-react'
import type { ErrorEnvelope, RunListItem, RunStatus } from '@godin-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { Button } from '@/components/ui/button'
import { Pill, type PillStatus } from '@/components/ui/pill'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { useWorkflowRuns } from './use-workflows'
import { useRerunWorkflow } from '@/pages/runs/use-run-detail'

/**
 * Workflow detail surface (P5b-wired).
 *
 * Wires the worked workflow example to REAL run data (GET /v1/workflows/:id/runs)
 * via `useWorkflowRuns`, and the Run-now action to the real dispatch
 * (POST /v1/workflows/:id/runs) via `useRerunWorkflow`. The display state is
 * DERIVED from the latest run's status (running / failed / applied) instead of a
 * hand-authored fixture state — so the surface is honest about what the backend
 * actually reports. Mock-shaped extras that the read model does NOT provide
 * (outcome breakdowns, the schedule editor, the pipeline graphic) are dropped
 * rather than fabricated.
 *
 * Graceful degradation (D3): loading / empty (never run) / error states are all
 * rendered cleanly; a 404/500 never white-screens.
 *
 * Brand: Source Serif headings, hairline frames, exactly one amber primary
 * (Run now), status by pill (icon + label, never color alone).
 */

/** Derived lifecycle state from the latest run (or `never` when there are none). */
type DerivedState = 'running' | 'held' | 'failed' | 'applied' | 'never'

/** A pending price-review gate may be encoded on the run output; read it defensively. */
function pendingApprovalCount(run: RunListItem | undefined): number {
  const output = run?.output
  if (output && typeof output === 'object' && 'needsReviewCount' in output) {
    const n = (output as { needsReviewCount?: unknown }).needsReviewCount
    if (typeof n === 'number' && n > 0) return n
  }
  return 0
}

function deriveState(latest: RunListItem | undefined): DerivedState {
  if (!latest) return 'never'
  if (latest.status === 'running' || latest.status === 'queued') return 'running'
  if (latest.status === 'failed') return 'failed'
  // succeeded — held at the gate when its output still flags items for review.
  return pendingApprovalCount(latest) > 0 ? 'held' : 'applied'
}

const RUN_STATUS_PILL: Record<RunStatus, { status: PillStatus; label: string }> = {
  succeeded: { status: 'ok', label: 'Applied' },
  failed: { status: 'fail', label: 'Failed' },
  running: { status: 'warn', label: 'Running' },
  queued: { status: 'idle', label: 'Queued' },
}

function formatRunAt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

/** A per-state banner: tone + copy keyed to the derived lifecycle state. */
function StateBanner({ state, pendingCount }: { state: DerivedState; pendingCount: number }) {
  switch (state) {
    case 'held':
      return (
        <Banner
          tone="warn"
          title={`${pendingCount} price ${pendingCount === 1 ? 'change' : 'changes'} need your review`}
          body="The agent finished the latest run and held the flagged changes at the approval gate. Review and apply them in Approvals."
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
          body="The pricing run stopped early before it could finish. Try running it again — if it keeps failing, contact support."
        />
      )
    case 'never':
      return (
        <Banner
          tone="idle"
          icon={<Sparkles className="size-5" aria-hidden="true" />}
          title="Not run yet"
          body="This workflow hasn’t run. Run it now to see today’s suggested price changes, or wait for the daily schedule."
        />
      )
    case 'applied':
    default:
      return (
        <Banner
          tone="ok"
          icon={<CheckCircle2 className="size-5" aria-hidden="true" />}
          title="All caught up"
          body="The latest run is complete and there’s nothing waiting on you."
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

/** Real run-history table built only from contract `RunListItem` fields. */
function RunHistory({ runs, runsBase }: { runs: RunListItem[]; runsBase: string }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        Icon={History}
        title="No runs yet"
        description="Run history appears here after this workflow runs for the first time."
      />
    )
  }
  return (
    <div className="overflow-x-auto border border-[var(--rule)] bg-[var(--surface)]">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <caption className="sr-only">Run history</caption>
        <thead>
          <tr className="border-b border-[var(--rule)] text-left">
            <th
              scope="col"
              className="px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]"
            >
              Run
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]"
            >
              Finished
            </th>
            <th
              scope="col"
              className="px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]"
            >
              Outcome
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {runs.map((run) => {
            const meta = RUN_STATUS_PILL[run.status]
            return (
              <tr key={run.runId} className="transition-colors hover:bg-[var(--surface-2)]">
                <td className="px-4 py-3">
                  <Link
                    to={`${runsBase}/${encodeURIComponent(run.runId)}`}
                    className="font-mono text-xs text-[var(--foreground)] underline-offset-2 hover:text-[var(--accent-text)] hover:underline"
                  >
                    {run.runId}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--foreground-soft)]">
                  {formatRunAt(run.finishedAt ?? run.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <Pill status={meta.status} showTick>
                    {meta.label}
                  </Pill>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function WorkflowDetail() {
  const tenant = useTenant()
  const params = useParams()
  const workflowId = params.id ?? ''

  const { data, isPending, isError, error, refetch } = useWorkflowRuns(workflowId)
  const rerun = useRerunWorkflow()

  const workflowsBase = `/${tenant.id}/workflows`
  const runsBase = `/${tenant.id}/runs`
  const approvalsHref = `/${tenant.id}/approvals`

  const backLink = (
    <Link
      to={workflowsBase}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Workflows
    </Link>
  )

  if (isPending) {
    return (
      <section className="space-y-6">
        {backLink}
        <LoadingState label="Loading workflow…" />
      </section>
    )
  }

  if (isError) {
    const envelope: ErrorEnvelope | undefined = error?.envelope
    return (
      <section className="space-y-6">
        {backLink}
        <ErrorState error={envelope} onRetry={() => void refetch()} />
      </section>
    )
  }

  // Runs come back most-recent-first from the read model; derive the headline run.
  const runs = data.runs
  const latest = runs[0]
  const state = rerun.isPending ? 'running' : deriveState(latest)
  const pendingCount = pendingApprovalCount(latest)
  const isRunning = state === 'running'

  return (
    <section className="space-y-8">
      <header className="space-y-4">
        {backLink}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
                {workflowId}
              </h1>
              {latest && (
                <Pill status={RUN_STATUS_PILL[latest.status].status} showTick>
                  {RUN_STATUS_PILL[latest.status].label}
                </Pill>
              )}
            </div>
            <p className="text-sm font-medium text-[var(--foreground)]">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                Latest run{' · '}
              </span>
              {latest ? formatRunAt(latest.finishedAt ?? latest.createdAt) : 'Never run'}
            </p>
          </div>

          {/* Exactly one amber primary per decision point: Run now. */}
          <Button
            onClick={() => rerun.mutate({ workflowId })}
            disabled={isRunning || rerun.isPending}
            className="shrink-0"
          >
            {isRunning || rerun.isPending ? (
              <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            {isRunning || rerun.isPending ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </header>

      {/* Re-run failure surfaces inline rather than throwing to a blank page. */}
      {rerun.isError && (
        <ErrorState
          error={rerun.error?.envelope}
          onRetry={() => rerun.mutate({ workflowId })}
        />
      )}

      <StateBanner state={state} pendingCount={pendingCount} />

      {/* Held → a direct path to the approvals queue. */}
      {state === 'held' && pendingCount > 0 && (
        <div>
          <Button asChild variant="secondary" size="sm">
            <Link to={approvalsHref}>Review {pendingCount} flagged changes</Link>
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-serif text-xl leading-tight text-[var(--foreground)]">
          Run history
        </h2>
        <RunHistory runs={runs} runsBase={runsBase} />
      </div>
    </section>
  )
}
