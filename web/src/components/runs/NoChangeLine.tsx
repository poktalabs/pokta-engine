import { MinusCircle } from 'lucide-react'
import { formatCount } from './format'

/**
 * The no-change line — the quiet idle/muted footer to the run summary: "1,030
 * products were already priced right — no change needed." Carries the idle status
 * role (muted ink) paired with its label, never color alone. Sits below the
 * confident set as the run's reassuring tail.
 */
export interface NoChangeLineProps {
  count: number
}

export function NoChangeLine({ count }: NoChangeLineProps) {
  return (
    <p className="flex items-center gap-3 border border-[var(--status-idle-line)] bg-[var(--status-idle-bg)] px-7 py-4 text-sm text-[var(--muted-foreground)] md:px-8">
      <MinusCircle className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-medium text-[var(--foreground-soft)]">
          {formatCount(count)}
        </span>{' '}
        {count === 1 ? 'product was' : 'products were'} already priced right — no
        change needed.
      </span>
    </p>
  )
}
