import { Link } from 'react-router-dom'
import { ChevronRight, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Pill, type PillStatus } from '@/components/ui/pill'
import type { RunDetail } from '@pokta-engine/contract'

/**
 * Run-detail header: breadcrumb → serif run title → status pill + Re-run.
 *
 * The status pill maps the run's terminal disposition to a status role:
 *   - succeeded + prices held → HELD AT GATE (warn amber) — the default story
 *   - succeeded + nothing held → APPLIED (ok green)
 *   - failed → PARTIAL FAILURE (fail brick-ember)
 *   - running / queued → RUNNING (idle)
 * Pill is icon+label always (never color alone). Re-run is a secondary action
 * (re-runs are routine, not the one amber CTA — the review callout owns primary).
 */
export interface RunDetailHeaderProps {
  run: RunDetail
  /** Workflow display name for the breadcrumb + title. */
  workflowName: string
  /** Whether the run is holding prices at the gate (drives the pill copy). */
  heldAtGate: boolean
  /** Base path for breadcrumb links, e.g. `/mi-pase`. */
  basePath: string
  onRerun: () => void
}

interface GatePill {
  status: PillStatus
  label: string
  iconLabel: string
}

function pillFor(run: RunDetail, heldAtGate: boolean): GatePill {
  if (run.status === 'failed')
    return { status: 'fail', label: 'Partial failure', iconLabel: 'Run partially failed' }
  if (run.status === 'running' || run.status === 'queued')
    return { status: 'idle', label: 'Running', iconLabel: 'Run in progress' }
  if (heldAtGate)
    return { status: 'warn', label: 'Held at gate', iconLabel: 'Held at approval gate' }
  return { status: 'ok', label: 'Applied', iconLabel: 'Run applied' }
}

const runDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function RunDetailHeader({
  run,
  workflowName,
  heldAtGate,
  basePath,
  onRerun,
}: RunDetailHeaderProps) {
  const gate = pillFor(run, heldAtGate)
  const finished = run.finishedAt ? runDate.format(new Date(run.finishedAt)) : null

  return (
    <header className="space-y-4">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <li>
            <Link
              to={`${basePath}/workflows`}
              className="transition-colors hover:text-[var(--foreground)]"
            >
              Workflows
            </Link>
          </li>
          <ChevronRight className="size-3" aria-hidden="true" />
          <li>
            <Link
              to={`${basePath}/workflows/${run.workflowId}`}
              className="transition-colors hover:text-[var(--foreground)]"
            >
              {workflowName}
            </Link>
          </li>
          <ChevronRight className="size-3" aria-hidden="true" />
          <li aria-current="page" className="font-medium text-[var(--foreground-soft)]">
            Run
          </li>
        </ol>
      </nav>

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
              {workflowName}
            </h1>
            <Pill status={gate.status} iconLabel={gate.iconLabel} showTick>
              {gate.label}
            </Pill>
          </div>
          <p className="font-sans text-sm text-[var(--muted-foreground)]">
            {finished ? `Finished ${finished}` : 'In progress'}
            <span className="px-2 text-[var(--border)]">·</span>
            <span className="font-mono text-xs">{run.runId}</span>
          </p>
        </div>

        <Button variant="secondary" onClick={onRerun} className="shrink-0 self-start">
          <RotateCw className="size-4" aria-hidden="true" />
          Re-run
        </Button>
      </div>
    </header>
  )
}
