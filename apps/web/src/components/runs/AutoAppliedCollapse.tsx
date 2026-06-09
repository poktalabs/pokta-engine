import { useId, useState } from 'react'
import { CheckCircle2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCount, formatMXN, formatDelta } from './format'
import type { RunAppliedItem } from '@/mocks/runs'

/**
 * The confident set, collapsed-as-done. The brand expression of "the agent
 * already handled these, no action needed": a quiet OK-green summary line —
 * "248 applied automatically · View all" — that expands into a hairline-grid
 * table of the applied price changes.
 *
 * Collapsed is the default (the wireframe keeps the confident set folded so the
 * eye goes to the review callout). `defaultExpanded` drives the
 * auto-applied-expanded state for the page's state demo.
 *
 * A11y: the toggle is a real <button> with `aria-expanded` + `aria-controls`;
 * the panel id is stable per instance.
 */
export interface AutoAppliedCollapseProps {
  count: number
  items: RunAppliedItem[]
  defaultExpanded?: boolean
}

export function AutoAppliedCollapse({
  count,
  items,
  defaultExpanded = false,
}: AutoAppliedCollapseProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const panelId = useId()
  const shown = items.length
  const remaining = count - shown

  return (
    <section className="border border-[var(--status-ok-line)] bg-[var(--status-ok-bg)]">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center justify-between gap-4 px-7 py-5 text-left md:px-8',
          'transition-colors hover:bg-[var(--surface-2)]/40',
        )}
      >
        <span className="flex items-center gap-3">
          <CheckCircle2
            className="size-5 shrink-0 text-[var(--status-ok)]"
            aria-hidden="true"
          />
          <span className="font-sans text-sm text-[var(--foreground)]">
            <span className="font-semibold text-[var(--status-ok)]">
              {formatCount(count)}
            </span>{' '}
            applied automatically
            <span className="text-[var(--muted-foreground)]"> · </span>
            <span className="font-medium underline underline-offset-2">
              {expanded ? 'Hide' : 'View all'}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-[var(--muted-foreground)] transition-transform',
            'motion-reduce:transition-none',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-[var(--status-ok-line)] bg-[var(--surface)]">
          {/* Hairline-grid table of applied changes (square ticks, soft row rules). */}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--rule)] text-left">
                <th className="kicker px-7 py-3 font-normal text-[var(--muted-foreground)] md:px-8">
                  Product
                </th>
                <th className="kicker px-4 py-3 text-right font-normal text-[var(--muted-foreground)]">
                  Was
                </th>
                <th className="kicker px-4 py-3 text-right font-normal text-[var(--muted-foreground)]">
                  Applied
                </th>
                <th className="kicker px-7 py-3 text-right font-normal text-[var(--muted-foreground)] md:px-8">
                  Δ
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((item) => (
                <tr key={item.rowId}>
                  <td className="px-7 py-3 md:px-8">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="status-tick status-tick-ok"
                      />
                      <span
                        className="truncate font-medium text-[var(--foreground)]"
                        title={item.product}
                      >
                        {item.product}
                      </span>
                    </span>
                    <span className="block pl-4 font-mono text-xs text-[var(--muted-foreground)]">
                      {item.sku}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--muted-foreground)] line-through">
                    {formatMXN(item.previousPrice)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--foreground)]">
                    {formatMXN(item.appliedPrice)}
                  </td>
                  <td
                    className={cn(
                      'px-7 py-3 text-right tabular-nums md:px-8',
                      item.deltaPct >= 0
                        ? 'text-[var(--status-ok)]'
                        : 'text-[var(--foreground-soft)]',
                    )}
                  >
                    {formatDelta(item.deltaPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {remaining > 0 && (
            <p className="border-t border-[var(--border)] px-7 py-4 text-xs text-[var(--muted-foreground)] md:px-8">
              Showing {formatCount(shown)} of {formatCount(count)} applied changes.
              The full list is exported with this run’s report.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
