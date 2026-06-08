import { useParams } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Generic detail placeholder for `/workflows/:id`, `/runs/:id`, `/reports/:id`.
 * Real detail surfaces land in P3 (workflow/run) and P4 (report).
 */
export default function DetailPlaceholder({ kind }: { kind: string }) {
  const params = useParams()
  const id = params.id ?? '—'
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
          {kind} detail
        </h1>
        <p className="font-sans text-sm text-[var(--muted-foreground)]">{id}</p>
      </header>
      <EmptyState
        Icon={FileText}
        title={`${kind} detail lands in a later phase`}
        description="This detail view is wired to mock data in P3/P4."
      />
    </section>
  )
}
