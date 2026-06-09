import { Link } from 'react-router-dom'
import type { RunStatus } from '@godin-engine/contract'
import { cn } from '@/lib/utils'
import { Pill, type PillStatus } from '@/components/ui/pill'
import { EmptyState } from '@/components/ui/EmptyState'
import { History } from 'lucide-react'
import type { WorkflowRunHistoryRow } from '@/mocks/workflows'

/**
 * Run-history table (M2 P3-A).
 *
 * The brand's hairline-grid "scientific-print table": one outer ink frame, soft
 * 15%-ink row dividers, a square Brick-Ember header rule. Columns: Date /
 * Auto-applied / Approved / Rejected / Outcome pill. Each row links to its run
 * detail (`/:tenant/runs/:id`). Empty history renders the warm empty state.
 *
 * Status → pill mapping is icon + label (never color alone, per the brand rule).
 */

/** Map a contract `RunStatus` → a status pill role + label. */
const STATUS_META: Record<RunStatus, { status: PillStatus; label: string }> = {
  succeeded: { status: 'ok', label: 'Applied' },
  failed: { status: 'fail', label: 'Failed' },
  running: { status: 'warn', label: 'Running' },
  queued: { status: 'idle', label: 'Queued' },
}

export interface RunHistoryTableProps {
  rows: WorkflowRunHistoryRow[]
  /** Base path for run-detail links, e.g. `/mi-pase/runs`. */
  runsBasePath: string
  className?: string
}

export function RunHistoryTable({ rows, runsBasePath, className }: RunHistoryTableProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        Icon={History}
        title="No runs yet"
        description="Run history appears here after this workflow runs for the first time."
        className={className}
      />
    )
  }

  return (
    <div
      className={cn('overflow-x-auto border border-[var(--rule)] bg-[var(--surface)]', className)}
    >
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">Run history</caption>
        <thead>
          <tr className="border-b border-[var(--rule)] text-left">
            <Th>Date</Th>
            <Th numeric>Auto-applied</Th>
            <Th numeric>Approved</Th>
            <Th numeric>Rejected</Th>
            <Th>Outcome</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map(({ run, ranAt, outcome }) => {
            const meta = STATUS_META[run.status]
            return (
              <tr key={run.runId} className="transition-colors hover:bg-[var(--surface-2)]">
                <td className="px-4 py-3">
                  <Link
                    to={`${runsBasePath}/${encodeURIComponent(run.runId)}`}
                    className="font-medium text-[var(--foreground)] underline-offset-2 hover:text-[var(--accent-text)] hover:underline"
                  >
                    {ranAt}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                  {run.status === 'failed' ? '—' : outcome.autoApplied.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                  {run.status === 'failed' ? '—' : outcome.approved.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                  {run.status === 'failed' ? '—' : outcome.rejected.toLocaleString()}
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

function Th({ children, numeric = false }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]',
        numeric && 'text-right',
      )}
    >
      {children}
    </th>
  )
}
