import { FileBarChart } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Reports surface — P1 placeholder. P4-B fills the report index + detail with the
 * full state matrix on mock data.
 */
export default function Reports() {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Reports</h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Impact, usage and pipeline-health summaries.
        </p>
      </header>
      <EmptyState
        Icon={FileBarChart}
        title="Reports land in P4"
        description="The report index and detail views arrive in the next phase."
      />
    </section>
  )
}
