import type { ReactNode } from 'react'
import { Inbox, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * Warm empty state — a sharp square instrument badge (brand cue), serif heading,
 * soft supporting copy, and an optional primary action.
 */
export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  Icon?: ComponentType<LucideProps>
  action?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({
  title,
  description,
  Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-5 border border-[var(--rule)] ' +
          'bg-[var(--surface)] px-6 py-16 text-center',
        className,
      )}
    >
      <span className="grid size-14 place-items-center border border-[var(--rule)] bg-[var(--background)]">
        <Icon className="size-7 text-[var(--accent-text)]" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h2 className="font-serif text-2xl leading-tight text-[var(--foreground)]">
          {title}
        </h2>
        {description && (
          <p className="mx-auto max-w-[48ch] text-sm leading-relaxed text-[var(--foreground-soft)]">
            {description}
          </p>
        )}
      </div>
      {action && (
        <Button onClick={action.onClick} size="sm">
          {action.label}
        </Button>
      )}
    </div>
  )
}
