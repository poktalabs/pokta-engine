import { useMemo } from 'react'
import { useTenant } from '@/providers/TenantProvider'
import { ApprovalQueueFrame } from '@/features/approvals/ApprovalQueueFrame'
import type {
  ApprovalRenderer,
  ApprovalRendererProps,
  DecisionHandler,
} from '@/features/approvals/types'
import { MOCK_APPROVALS } from '@/mocks/approvals'

/**
 * Approvals surface (M2 P2-A).
 *
 * Mounts the universal `ApprovalQueueFrame` and selects a renderer by the items'
 * `workflowId` domain (`mipase.*` → batch, `vino.*` → single-action). The real
 * `BatchApprovalRenderer` (P2-B) and `SingleActionRenderer` (P2-C) plug in here
 * by swapping the `renderer` prop — nothing else changes. Until those land, a
 * minimal contract-conformant renderer proves the swap seam on mock data.
 */

/**
 * Placeholder renderer satisfying the P2-A contract. P2-B / P2-C replace this
 * with the virtualized batch table and the single-action card respectively.
 */
function makePlaceholderRenderer(artifactKind: string): ApprovalRenderer {
  return {
    artifactKind,
    render({ items, selection, onToggle, failedItemIds, disabled }: ApprovalRendererProps) {
      return (
        <ul className="divide-y divide-[var(--border)] border border-[var(--rule)] bg-[var(--surface)]">
          {items.map((item) => {
            const failed = failedItemIds.includes(item.approvalId)
            return (
              <li
                key={item.approvalId}
                className="flex items-center gap-3 px-4 py-3 text-sm"
                aria-invalid={failed || undefined}
              >
                <input
                  type="checkbox"
                  checked={selection.has(item.approvalId)}
                  onChange={() => onToggle(item.approvalId)}
                  disabled={disabled}
                  aria-label={`Select ${item.workflowId}`}
                />
                <span className="font-mono text-xs text-[var(--foreground-soft)]">
                  {item.workflowId}
                </span>
                {failed && (
                  <span className="text-xs font-semibold text-[var(--status-fail)]">
                    Failed — retry
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )
    },
    toDecisionPayload(selection, items) {
      const chosen = items.filter((i) => selection.has(i.approvalId))
      return {
        approvalIds: chosen.map((i) => i.approvalId),
        artifactKind,
        artifact: chosen.map((i) => i.artifact),
      }
    },
  }
}

/** Resolve the active tenant's queue + renderer from mock data. */
function useApprovalQueue(tenantId: string) {
  return useMemo(() => {
    const prefix = tenantId === 'mipase' ? 'mipase.' : 'vino.'
    const items = MOCK_APPROVALS.filter((a) => a.workflowId.startsWith(prefix))
    const artifactKind = items[0]?.workflowId.split('.')[0] ?? tenantId
    return { items, renderer: makePlaceholderRenderer(artifactKind) }
  }, [tenantId])
}

const mockDecision: DecisionHandler = async () => {
  // Mock-data-first: succeed without touching the network (VITE_USE_MOCKS).
  await new Promise((r) => setTimeout(r, 200))
}

export default function Approvals() {
  const tenant = useTenant()
  const { items, renderer } = useApprovalQueue(tenant.id)

  const target =
    tenant.id === 'mipase'
      ? { what: 'Apply suggested prices', where: 'Shopify · test store' }
      : { what: 'Run drafted actions', where: 'Vino integrations' }

  return (
    <ApprovalQueueFrame
      title="Approvals"
      description="Review and approve what your agents have drafted."
      items={items}
      renderer={renderer}
      onDecision={mockDecision}
      target={target}
    />
  )
}
