import type { ReactNode } from 'react'
import { Clock, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

/**
 * ComingSoon — the honest deferred-surface placeholder (P5b Wave 2).
 *
 * A quiet hairline panel for surfaces that are intentionally NOT wired to a
 * backend yet (Reports; the Settings roster + integration-status panels). It says
 * so plainly — no fabricated rows, no fake data, never a dead/broken affordance.
 * Distinct from `EmptyState` (which means "wired, but nothing here yet"):
 * ComingSoon means "this surface is on the roadmap and deliberately empty for now".
 */
export interface ComingSoonProps {
  title: ReactNode
  description?: ReactNode
  Icon?: ComponentType<LucideProps>
  className?: string
}

export function ComingSoon({ title, description, Icon = Clock, className }: ComingSoonProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-4 border border-dashed border-[var(--rule)] ' +
          'bg-[var(--surface-2)] px-6 py-12 text-center',
        className,
      )}
    >
      <span className="grid size-12 place-items-center border border-[var(--rule)] bg-[var(--surface)]">
        <Icon className="size-6 text-[var(--muted-foreground)]" aria-hidden="true" />
      </span>
      <div className="space-y-1.5">
        <h2 className="font-serif text-xl leading-tight text-[var(--foreground)]">{title}</h2>
        {description && (
          <p className="mx-auto max-w-[48ch] text-sm leading-relaxed text-[var(--foreground-soft)]">
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
