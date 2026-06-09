import { Link } from 'react-router-dom'
import {
  CalendarClock,
  ChevronRight,
  Hand,
  Zap,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { Pill, type PillStatus } from '@/components/ui/pill'
import type {
  WorkflowLastRunOutcome,
  WorkflowListItem,
  WorkflowTrigger,
} from '@/mocks/workflows'

/**
 * One row of the WORKFLOWS list (M2 P3-A).
 *
 * Each row shows: name + description, the TRIGGER (schedule / event / manual),
 * the last-run outcome PILL, and a PENDING COUNT chip when approvals are waiting.
 * Rows whose detail is implemented link to it; the rest are inert (no dead link).
 *
 * Brand: hairline cell on `--surface`, square status tick via `<Pill>` (icon +
 * label, never color alone), Source Serif name, Manrope body. Rendered inside a
 * <HairlineGrid cols={1}> so the gap-px rules separate rows.
 */

/** Map a last-run outcome → status pill role + label (icon+label, never color). */
const OUTCOME_META: Record<
  WorkflowLastRunOutcome,
  { status: PillStatus; label: string; iconLabel: string }
> = {
  applied: { status: 'ok', label: 'Applied', iconLabel: 'Last run applied' },
  held: { status: 'warn', label: 'Held at gate', iconLabel: 'Held at approval gate' },
  running: { status: 'warn', label: 'Running', iconLabel: 'Run in progress' },
  failed: { status: 'fail', label: 'Failed', iconLabel: 'Last run failed' },
  'no-change': { status: 'idle', label: 'No change', iconLabel: 'No change' },
  never: { status: 'idle', label: 'Never run', iconLabel: 'Never run' },
}

/** Map a trigger kind → its leading icon. */
const TRIGGER_ICON: Record<WorkflowTrigger['kind'], ComponentType<LucideProps>> = {
  schedule: CalendarClock,
  event: Zap,
  manual: Hand,
}

export interface WorkflowRowProps {
  workflow: WorkflowListItem
  /** Base path for the detail link, e.g. `/mi-pase/workflows`. */
  basePath: string
  className?: string
}

export function WorkflowRow({ workflow, basePath, className }: WorkflowRowProps) {
  const outcome = OUTCOME_META[workflow.lastRunOutcome]
  const TriggerIcon = TRIGGER_ICON[workflow.trigger.kind]

  const body = (
    <div className="flex items-center gap-5">
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="truncate font-serif text-xl leading-snug text-[var(--foreground)]">
          {workflow.name}
        </h2>
        <p className="truncate text-sm text-[var(--foreground-soft)]">
          {workflow.description}
        </p>
        <p className="flex items-center gap-1.5 pt-1 text-[var(--muted-foreground)]">
          <TriggerIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em]">
            {workflow.trigger.label}
          </span>
        </p>
      </div>

      {/* Pending-count chip — amber, only when approvals are waiting. */}
      {workflow.pendingCount > 0 && (
        <span
          className="shrink-0 border border-[var(--status-warn-line)] bg-[var(--status-warn-bg)] px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--status-warn)]"
          aria-label={`${workflow.pendingCount} pending ${workflow.pendingCount === 1 ? 'approval' : 'approvals'}`}
        >
          {workflow.pendingCount} pending
        </span>
      )}

      {/* Last-run outcome pill (icon + label). */}
      <span className="shrink-0">
        <Pill status={outcome.status} iconLabel={outcome.iconLabel} showTick>
          {outcome.label}
        </Pill>
      </span>

      {/* Last-run time. */}
      {workflow.lastRunAt && (
        <span className="hidden shrink-0 text-sm text-[var(--muted-foreground)] sm:inline">
          {workflow.lastRunAt}
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
