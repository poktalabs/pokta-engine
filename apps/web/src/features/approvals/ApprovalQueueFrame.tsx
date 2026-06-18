import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Cpu, ShieldAlert, X } from 'lucide-react'
import type { ApprovalView } from '@pokta-engine/contract'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { EmptyState } from '@/components/ui/EmptyState'
import type {
  ApprovalQueueState,
  ApprovalRenderer,
  DecisionHandler,
  PartialFailure,
} from './types'

/**
 * The universal Approvals frame (M2 P2-A).
 *
 * Tenant-agnostic. It owns the 6-state machine (default / empty / submitting /
 * success / partial-failure / rejected), the async approve/reject lifecycle, the
 * what/where/risk/source header strip, the pending count, the batch action bar,
 * the inline audit trail, and the a11y contract (focus management + an
 * `aria-live` status region). The queue BODY is delegated wholesale to a
 * pluggable `renderer` — swapping that prop is the ONLY change between tenants.
 */

export interface ApprovalQueueFrameProps {
  /** Surface heading, e.g. "Approvals". */
  title: string
  /** One-line supporting copy under the heading. */
  description?: string
  /** The pending items the frame governs (already scoped to this queue). */
  items: ApprovalView[]
  /** The pluggable renderer for this tenant/artifact kind. */
  renderer: ApprovalRenderer
  /**
   * Async decision handler — POSTs the built `DecisionRequest`. Resolves a
   * `PartialFailure` when some items failed, throws on total failure, resolves
   * void on full success. P2 passes a mock; P5b passes the real hook.
   */
  onDecision: DecisionHandler
  /** Human label for the apply target (drives the confirm copy + header strip). */
  target?: { what: string; where: string }
  /** Coarse risk hint for the header strip (renderer may show finer per-row risk). */
  risk?: { tier: 'low' | 'medium' | 'high'; label: string }
  className?: string
}

const RISK_PILL: Record<'low' | 'medium' | 'high', 'idle' | 'warn' | 'fail'> = {
  low: 'idle',
  medium: 'warn',
  high: 'fail',
}

export function ApprovalQueueFrame({
  title,
  description,
  items,
  renderer,
  onDecision,
  target,
  risk,
  className,
}: ApprovalQueueFrameProps) {
  const [state, setState] = useState<ApprovalQueueState>(
    items.length === 0 ? 'empty' : 'default',
  )
  const [selection, setSelection] = useState<Set<string>>(
    () => new Set(items.map((i) => i.approvalId)),
  )
  const [failedItemIds, setFailedItemIds] = useState<string[]>([])
  const [announcement, setAnnouncement] = useState('')
  const [auditOpen, setAuditOpen] = useState(false)

  // Focus is moved to the status region after a decision settles (a11y contract).
  const statusRef = useRef<HTMLDivElement | null>(null)

  // Keep selection / state in sync if the governed items change (e.g. refetch).
  useEffect(() => {
    setSelection(new Set(items.map((i) => i.approvalId)))
    setState(items.length === 0 ? 'empty' : 'default')
    setFailedItemIds([])
  }, [items])

  const submitting = state === 'submitting'
  const pendingCount = items.length
  const selectedCount = selection.size

  const onToggle = useCallback(
    (approvalId: string) => {
      setSelection((prev) => {
        const next = new Set(prev)
        if (next.has(approvalId)) next.delete(approvalId)
        else next.add(approvalId)
        return next
      })
    },
    [],
  )

  const settle = useCallback((next: ApprovalQueueState, message: string) => {
    setState(next)
    setAnnouncement(message)
    // Move focus to the live status region so SR users land on the result.
    requestAnimationFrame(() => statusRef.current?.focus())
  }, [])

  const runDecision = useCallback(
    async (kind: 'approve' | 'reject', explicitId?: string) => {
      const selectedItems = items.filter(
        (i) => selection.has(i.approvalId) || i.approvalId === explicitId,
      )
      if (selectedItems.length === 0) return

      const payload = renderer.toDecisionPayload(
        explicitId ? new Set([explicitId]) : selection,
        selectedItems,
      )

      setState('submitting')
      setFailedItemIds([])
      setAnnouncement(
        kind === 'approve' ? 'Submitting approval…' : 'Submitting rejection…',
      )

      try {
        const result = (await onDecision(payload, kind)) as PartialFailure | void
        if (result && result.failedItemIds.length > 0) {
          setFailedItemIds(result.failedItemIds)
          settle(
            'partial-failure',
            `${result.failedItemIds.length} of ${selectedItems.length} items failed. Review and retry the failed items.`,
          )
          return
        }
        if (kind === 'reject') {
          settle('rejected', `Rejected ${selectedItems.length} item(s).`)
        } else {
          settle('success', `Approved and applied ${selectedItems.length} item(s).`)
        }
      } catch {
        // Total failure surfaces as partial-failure over the whole selection so
        // the operator gets one uniform "Retry failed" affordance.
        const ids = selectedItems.map((i) => i.approvalId)
        setFailedItemIds(ids)
        settle(
          'partial-failure',
          `Could not ${kind} ${ids.length} item(s). Please retry.`,
        )
      }
    },
    [items, selection, renderer, onDecision, settle],
  )

  const onApproveAll = useCallback(() => void runDecision('approve'), [runDecision])
  const onReject = useCallback(
    (approvalId?: string) => void runDecision('reject', approvalId),
    [runDecision],
  )
  const retryFailed = useCallback(() => {
    // Re-run the decision against only the failed ids.
    setSelection(new Set(failedItemIds))
    void runDecision('approve')
  }, [failedItemIds, runDecision])

  const headerRisk = useMemo(() => {
    if (!risk) return null
    return <Pill status={RISK_PILL[risk.tier]}>{risk.label}</Pill>
  }, [risk])

  const sourceRunIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.sourceRunId))),
    [items],
  )

  const showBody = state !== 'success' && state !== 'rejected'
  const isTerminal = state === 'success' || state === 'rejected'

  return (
    <section className={cn('space-y-6', className)} data-approval-state={state}>
      <header className="space-y-4">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[var(--foreground-soft)]">{description}</p>
          )}
        </div>

        {/* what / where / risk / source strip — the brand hairline frame. */}
        {pendingCount > 0 && (
          <dl className="grid grid-cols-2 gap-px border border-[var(--rule)] bg-[var(--rule)] md:grid-cols-4">
            <StripCell label="What" value={target?.what ?? 'Agent draft'} icon={<Cpu className="size-3.5 text-[var(--accent-text)]" aria-hidden="true" />} />
            <StripCell label="Where" value={target?.where ?? '—'} />
            <StripCell
              label="Risk"
              value={headerRisk ?? <span className="text-[var(--muted-foreground)]">Not rated</span>}
              icon={risk ? <ShieldAlert className="size-3.5 text-[var(--muted-foreground)]" aria-hidden="true" /> : undefined}
            />
            <StripCell
              label="Source"
              value={
                <span className="font-mono text-xs text-[var(--foreground-soft)]">
                  {sourceRunIds.length === 1
                    ? sourceRunIds[0]
                    : `${sourceRunIds.length} runs`}
                </span>
              }
            />
          </dl>
        )}

        {/* Pending count + selection summary. */}
        {pendingCount > 0 && (
          <p className="text-sm text-[var(--foreground-soft)]">
            <span className="font-semibold text-[var(--foreground)]">{pendingCount}</span>{' '}
            pending · <span className="font-semibold text-[var(--foreground)]">{selectedCount}</span>{' '}
            selected
          </p>
        )}
      </header>

      {/*
        a11y: a polite live region announces every async result; focus moves here
        on settle so SR users land on the outcome. tabIndex -1 makes it focusable
        without entering the tab order.
      */}
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={cn(
          'outline-none',
          isTerminal || state === 'partial-failure'
            ? 'border border-[var(--rule)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--foreground)]'
            : 'sr-only',
        )}
      >
        {announcement}
      </div>

      {/* Body — delegated to the pluggable renderer, or the empty state. */}
      {state === 'empty' ? (
        <EmptyState
          Icon={Check}
          title="Nothing to approve"
          description="Your agents haven’t drafted anything that needs review. New items will appear here."
        />
      ) : showBody ? (
        <div aria-busy={submitting}>
          {renderer.render({
            items,
            state,
            selection,
            onToggle,
            onApproveAll,
            onReject,
            failedItemIds,
            disabled: submitting,
          })}
        </div>
      ) : null}

      {/*
        Action bar — sticky so it stays reachable over a long queue. The audit
        toggle is always available; the decision buttons are suppressed when the
        renderer owns its own action surface (`ownsActionBar`) so the batch /
        single-action renderers' bars never duplicate the frame's. The frame
        still surfaces "Retry failed" universally (it owns the failed-id list).
      */}
      {state !== 'empty' && !isTerminal && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 border border-[var(--rule)] bg-[var(--background)] px-4 py-3">
          <div className="flex items-center gap-3 text-sm text-[var(--foreground-soft)]">
            <button
              type="button"
              onClick={() => setAuditOpen((o) => !o)}
              className="underline-offset-2 hover:underline"
              aria-expanded={auditOpen}
            >
              {auditOpen ? 'Hide audit trail' : 'Show audit trail'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {state === 'partial-failure' && failedItemIds.length > 0 && (
              <Button variant="secondary" size="sm" onClick={retryFailed} disabled={submitting}>
                Retry failed ({failedItemIds.length})
              </Button>
            )}
            {!renderer.ownsActionBar && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onReject()}
                  disabled={submitting || selectedCount === 0}
                >
                  <X className="size-4" aria-hidden="true" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={onApproveAll}
                  disabled={submitting || selectedCount === 0}
                >
                  <Check className="size-4" aria-hidden="true" />
                  {submitting ? 'Applying…' : `Approve ${selectedCount} & apply`}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Inline audit trail — the ONLY audit surface in M2 (no backend endpoint). */}
      {auditOpen && state !== 'empty' && (
        <div className="border border-[var(--rule)] bg-[var(--surface)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="px-4 py-2 font-medium">Approval</th>
                <th className="px-4 py-2 font-medium">Source run</th>
                <th className="px-4 py-2 font-medium">Decided by</th>
                <th className="px-4 py-2 font-medium">Decided at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((i) => (
                <tr key={i.approvalId}>
                  <td className="px-4 py-2 font-mono text-xs">{i.approvalId}</td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--foreground-soft)]">
                    {i.sourceRunId}
                  </td>
                  <td className="px-4 py-2 text-[var(--foreground-soft)]">
                    {i.decidedBy ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-[var(--foreground-soft)]">
                    {i.decidedAt ?? 'Pending'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Terminal states get a quiet reset affordance. */}
      {isTerminal && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState(items.length === 0 ? 'empty' : 'default')
              setAnnouncement('')
              setFailedItemIds([])
            }}
          >
            Back to queue
          </Button>
        </div>
      )}
    </section>
  )
}

function StripCell({
  label,
  value,
  icon,
}: {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div className="bg-[var(--surface)] px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="mt-1 flex items-center gap-1.5 text-sm text-[var(--foreground)]">
        {icon}
        {value}
      </dd>
    </div>
  )
}
