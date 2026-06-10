import { Link } from 'react-router-dom'
import { ArrowLeft, FileBarChart } from 'lucide-react'
import { ComingSoon } from '@/components/ui/ComingSoon'

/**
 * Report detail — DEFERRED (P5b Wave 2).
 *
 * Mounted for the `reports/:id` route, but Reports has no backend read model yet,
 * so this makes NO network call and renders an honest ComingSoon panel with a way
 * back to the (also-deferred) Reports index.
 */
export default function ReportDetailPage() {
  return (
    <section className="space-y-6">
      <Link
        to=".."
        relative="path"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--foreground-soft)] transition-colors hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All reports
      </Link>
      <ComingSoon
        Icon={FileBarChart}
        title="No reports yet"
        description="Reports aren’t available yet. When your workflows produce them, you’ll be able to open them here."
      />
    </section>
  )
}
