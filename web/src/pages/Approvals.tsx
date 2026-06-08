import { CheckSquare } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Approvals surface — P1 placeholder. P2 fills the universal ApprovalQueueFrame +
 * the Mi Pase BatchApprovalRenderer (the critical-path heart) on mock data.
 */
export default function Approvals() {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Approvals</h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Review and approve what your agents have drafted.
        </p>
      </header>
      <EmptyState
        Icon={CheckSquare}
        title="The approvals queue lands in P2"
        description="The universal approval frame and the Mi Pase batch renderer arrive in the next phase."
      />
    </section>
  )
}
