import { useMemo } from 'react'
import type { ApprovalView } from '@godin-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { ApprovalQueueFrame } from '@/features/approvals/ApprovalQueueFrame'
import type {
  ApprovalRenderer,
  DecisionHandler,
} from '@/features/approvals/types'
import { batchApprovalRenderer } from '@/features/approvals/renderers/BatchApprovalRenderer'
import { singleActionRenderer } from '@/features/approvals/renderers/SingleActionRenderer'
import { MOCK_BATCH_ROWS } from '@/mocks/approvals.batch'
import { MOCK_VINO_APPROVALS } from '@/mocks/approvals.single'

/**
 * Approvals surface (M2 P2).
 *
 * Mounts the universal `ApprovalQueueFrame` and selects a renderer by the active
 * TENANT (== the items' `workflowId` domain): Mi Pase's `mipase.*` daily-pricing
 * queue gets the virtualized `BatchApprovalRenderer` (P2-B, the hero); Vino's
 * `vino.*` queue gets the focused `SingleActionRenderer` (P2-C). The plan's
 * central thesis holds here — between tenants the ONLY thing that changes is the
 * `renderer` prop (and its mock queue); the frame, the 6-state machine, the async
 * lifecycle, the audit trail and the a11y contract are all shared.
 *
 * Both renderers own their own action surface (`ownsActionBar`), so the frame
 * suppresses its generic batch bar to avoid a duplicate Approve/Reject.
 */

interface TenantQueue {
  items: ApprovalView[]
  renderer: ApprovalRenderer
  target: { what: string; where: string }
  risk?: { tier: 'low' | 'medium' | 'high'; label: string }
}

/** Resolve the active tenant's pending queue + its renderer from mock data. */
function useApprovalQueue(tenantId: string): TenantQueue {
  return useMemo<TenantQueue>(() => {
    if (tenantId === 'vino') {
      return {
        items: MOCK_VINO_APPROVALS,
        renderer: singleActionRenderer,
        target: { what: 'Run drafted actions', where: 'Vino integrations' },
      }
    }
    // Default / Mi Pase: the daily-pricing batch, one ApprovalView per flagged row.
    return {
      items: MOCK_BATCH_ROWS,
      renderer: batchApprovalRenderer,
      target: { what: 'Apply suggested prices', where: 'Shopify · test store' },
      risk: { tier: 'medium', label: 'Price changes' },
    }
  }, [tenantId])
}

/**
 * Mock decision handler — succeeds without touching the network (mock-data-first,
 * behind `VITE_USE_MOCKS`). P5b swaps this for the real `apiFetch` mutation hook,
 * which returns a `PartialFailure` when some items fail (the frame already renders
 * that state + "Retry failed").
 */
const mockDecision: DecisionHandler = async () => {
  await new Promise((r) => setTimeout(r, 200))
}

export default function Approvals() {
  const tenant = useTenant()
  const { items, renderer, target, risk } = useApprovalQueue(tenant.id)

  return (
    <ApprovalQueueFrame
      title="Approvals"
      description="Review and approve what your agents have drafted."
      items={items}
      renderer={renderer}
      onDecision={mockDecision}
      target={target}
      risk={risk}
    />
  )
}
