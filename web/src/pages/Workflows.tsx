import { Workflow } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Workflows surface — P1 placeholder. P3-A fills the list + detail + pipeline +
 * schedule editor with the full state matrix on mock data.
 */
export default function Workflows() {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Workflows</h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Your automated, human-gated workflows.
        </p>
      </header>
      <EmptyState
        Icon={Workflow}
        title="Workflows land in P3"
        description="The workflow list, detail, pipeline flow and schedule editor arrive in the next phase."
      />
    </section>
  )
}
