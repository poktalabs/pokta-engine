import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  ApprovalView,
  ApproveResponse,
  ErrorEnvelope,
  RejectResponse,
} from '@godin-engine/contract'
import { ApiError, apiFetch } from '@/lib/api'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ApprovalQueueFrame } from '@/features/approvals/ApprovalQueueFrame'
import type {
  ApprovalRenderer,
  DecisionHandler,
  PartialFailure,
} from '@/features/approvals/types'
import { batchApprovalRenderer } from '@/features/approvals/renderers/BatchApprovalRenderer'
import { singleActionRenderer } from '@/features/approvals/renderers/SingleActionRenderer'
import { useApprovals } from './use-approvals'

/**
 * Approvals surface (P5b-wired).
 *
 * Wires the universal `ApprovalQueueFrame` to the LIVE read model
 * (GET /v1/approvals) via `useApprovals`, and the approve/reject decisions to the
 * real mutations (POST /v1/approvals/:id/approve | /reject). The renderer is
 * selected by the items' `workflowId` domain (`mipase.*` → the virtualized batch
 * table, otherwise → the focused single-action card) — the plan's thesis: the only
 * thing that changes between tenants is the `renderer` prop.
 *
 * The decision handler POSTs per-id and collects any failures into a
 * `PartialFailure` so the frame surfaces "Retry failed". It branches on
 * `ApiError.code`: `APPROVAL_DENIED` (already-decided / not-permitted) is the
 * expected per-item failure, recorded as a failed id rather than a thrown crash.
 *
 * Graceful degradation (D3): loading / empty / error are all rendered cleanly
 * (the frame owns the empty state once items resolve to `[]`).
 */

/** Pick the renderer for a queue from the items' workflow domain. */
function rendererFor(items: ApprovalView[]): ApprovalRenderer {
  const first = items[0]
  if (first && first.workflowId.startsWith('mipase')) return batchApprovalRenderer
  return singleActionRenderer
}

/** Coarse target/risk header copy derived from the selected renderer. */
function headerFor(renderer: ApprovalRenderer): {
  target: { what: string; where: string }
  risk?: { tier: 'low' | 'medium' | 'high'; label: string }
} {
  if (renderer === batchApprovalRenderer) {
    return {
      target: { what: 'Apply suggested prices', where: 'Shopify · test store' },
      risk: { tier: 'medium', label: 'Price changes' },
    }
  }
  return { target: { what: 'Run drafted actions', where: 'Connected integrations' } }
}

export default function Approvals() {
  const { data, isPending, isError, error, refetch } = useApprovals()
  const queryClient = useQueryClient()

  const items = useMemo<ApprovalView[]>(() => data?.approvals ?? [], [data])
  const renderer = useMemo(() => rendererFor(items), [items])
  const { target, risk } = useMemo(() => headerFor(renderer), [renderer])

  /**
   * Real decision handler. POSTs approve/reject for every approval id in the
   * request, collecting failures. A single-id failure becomes a `PartialFailure`
   * the frame renders; a clean run resolves void (full success) and refetches the
   * worklist so decided items drop off.
   */
  const onDecision = useCallback<DecisionHandler>(
    async (request, kind) => {
      const ids = request.approvalIds
      const failedItemIds: string[] = []
      const errors: ErrorEnvelope[] = []

      await Promise.all(
        ids.map(async (id) => {
          try {
            if (kind === 'approve') {
              await apiFetch<ApproveResponse>(`/v1/approvals/${encodeURIComponent(id)}/approve`, {
                method: 'POST',
              })
            } else {
              await apiFetch<RejectResponse>(`/v1/approvals/${encodeURIComponent(id)}/reject`, {
                method: 'POST',
              })
            }
          } catch (err) {
            // Branch on the typed envelope code: APPROVAL_DENIED (already decided /
            // not permitted) and any other failure are recorded per-item so the
            // frame can flag exactly which rows failed + offer "Retry failed".
            failedItemIds.push(id)
            if (err instanceof ApiError) errors.push(err.envelope)
            else
              errors.push({
                code: 'SKILL_EXEC_ERROR',
                message: 'The decision could not be submitted. Please retry.',
                retryable: true,
              })
          }
        }),
      )

      // Refresh the worklist so decided items drop off (even on partial failure).
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })

      if (failedItemIds.length > 0) {
        return { failedItemIds, errors } satisfies PartialFailure
      }
      // Full success → void.
    },
    [queryClient],
  )

  if (isPending) {
    return (
      <section className="space-y-6">
        <header className="space-y-1">
          <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
            Approvals
          </h1>
          <p className="text-sm text-[var(--foreground-soft)]">
            Review and approve what your agents have drafted.
          </p>
        </header>
        <LoadingState label="Loading approvals…" />
      </section>
    )
  }

  if (isError) {
    return (
      <section className="space-y-6">
        <header className="space-y-1">
          <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
            Approvals
          </h1>
        </header>
        <ErrorState error={error?.envelope} onRetry={() => void refetch()} />
      </section>
    )
  }

  return (
    <ApprovalQueueFrame
      title="Approvals"
      description="Review and approve what your agents have drafted."
      items={items}
      renderer={renderer}
      onDecision={onDecision}
      target={target}
      risk={risk}
    />
  )
}
