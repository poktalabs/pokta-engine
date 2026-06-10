import { Link } from 'react-router-dom'
import {
  CalendarClock,
  ChevronRight,
  Hand,
  Zap,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { WorkflowCard } from '@godin-engine/contract'
import { cn } from '@/lib/utils'
import { Pill, type PillStatus } from '@/components/ui/pill'

/**
 * One row of the WORKFLOWS list (M2 P3-A · P5b-wired).
 *
 * Renders the live contract `WorkflowCard` read model: name + trigger, the
 * last-run outcome PILL (derived from `lastRun.status`), and a PENDING COUNT chip
 * when approvals are waiting. Rows whose detail is implemented (`hasDetail`) link
 * to it; the rest are inert (no dead link).
 *
 * Brand: hairline cell on `--surface`, square status tick via `<Pill>` (icon +
 * label, never color alone), Source Serif name, Manrope body. Rendered inside a
 * <HairlineGrid cols={1}> so the gap-px rules separate rows.
 */

/** Map a run status (or null = never run) → status pill role + label. */
function outcomeFor(
  lastRun: WorkflowCard['lastRun'],
): { status: PillStatus; label: string; iconLabel: string } {
  if (!lastRun) {
    return { status: 'idle', label: 'Never run', iconLabel: 'Never run' }
  }
  switch (lastRun.status) {
    case 'succeeded':
      return { status: 'ok', label: 'Applied', iconLabel: 'Last run applied' }
    case 'failed':
      return { status: 'fail', label: 'Failed', iconLabel: 'Last run failed' }
    case 'running':
      return { status: 'warn', label: 'Running', iconLabel: 'Run in progress' }
    case 'queued':
      return { status: 'idle', label: 'Queued', iconLabel: 'Run queued' }
    default:
      return { status: 'idle', label: lastRun.status, iconLabel: lastRun.status }
  }
}

/** Map a coarse trigger label → its leading icon (best-effort by keyword). */
function triggerIconFor(trigger: string): ComponentType<LucideProps> {
  const t = trigger.toLowerCase()
  if (t.includes('manual')) return Hand
  if (t.includes('event') || t.includes('on ')) return Zap
  return CalendarClock
}

/** Format the last-run ISO timestamp for the row's trailing time slot. */
function formatLastRunAt(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export interface WorkflowRowProps {
  workflow: WorkflowCard
  /** Base path for the detail link, e.g. `/mi-pase/workflows`. */
  basePath: string
  className?: string
}

export function WorkflowRow({ workflow, basePath, className }: WorkflowRowProps) {
  const outcome = outcomeFor(workflow.lastRun)
  const TriggerIcon = triggerIconFor(workflow.trigger)
  const lastRunAt = workflow.lastRun ? formatLastRunAt(workflow.lastRun.at) : null

  const body = (
    <div className="flex items-center gap-5">
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="truncate font-serif text-xl leading-snug text-[var(--foreground)]">
          {workflow.displayName}
        </h2>
        <p className="flex items-center gap-1.5 pt-1 text-[var(--muted-foreground)]">
          <TriggerIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em]">
            {workflow.trigger}
          </span>
        </p>
      </div>

      {/* Pending-count chip — amber, only when approvals are waiting. */}
      {workflow.pendingApprovals > 0 && (
        <span
          className="shrink-0 border border-[var(--status-warn-line)] bg-[var(--status-warn-bg)] px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--status-warn)]"
          aria-label={`${workflow.pendingApprovals} pending ${workflow.pendingApprovals === 1 ? 'approval' : 'approvals'}`}
        >
          {workflow.pendingApprovals} pending
        </span>
      )}

      {/* Last-run outcome pill (icon + label). */}
      <span className="shrink-0">
        <Pill status={outcome.status} iconLabel={outcome.iconLabel} showTick>
          {outcome.label}
        </Pill>
      </span>

      {/* Last-run time. */}
      {lastRunAt && (
        <span className="hidden shrink-0 text-sm text-[var(--muted-foreground)] sm:inline">
          {lastRunAt}
        </span>
      )}

      {workflow.hasDetail && (
        <ChevronRight
          className="size-5 shrink-0 text-[var(--muted-foreground)]"
          aria-hidden="true"
        />
      )}
    </div>
  )

  const cellClass = cn(
    'block bg-[var(--surface)] p-6 transition-colors',
    workflow.hasDetail &&
      'hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)]',
    className,
  )

  if (workflow.hasDetail) {
    return (
      <Link to={`${basePath}/${encodeURIComponent(workflow.id)}`} className={cellClass}>
        {body}
      </Link>
    )
  }

  // No detail yet → inert row (never a dead link).
  return (
    <div className={cn(cellClass, 'cursor-default')} aria-disabled="true">
      {body}
    </div>
  )
}
