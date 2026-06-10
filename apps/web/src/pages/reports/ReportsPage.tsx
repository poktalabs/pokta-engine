import { FileBarChart } from 'lucide-react'
import { ComingSoon } from '@/components/ui/ComingSoon'

/**
 * Reports index — DEFERRED (P5b Wave 2).
 *
 * Reports is a roadmap surface with NO backend read model yet. The route stays
 * mounted (nav + roadmap visibility), but the page makes NO network call and
 * renders an honest ComingSoon panel instead of mock report cards.
 */
export default function ReportsPage() {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Reports</h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Impact, research and pipeline-health summaries your agents produce.
        </p>
      </header>
      <ComingSoon
        Icon={FileBarChart}
        title="No reports yet"
        description="When your workflows produce impact and research summaries, they’ll show up here."
      />
    </section>
  )
}
