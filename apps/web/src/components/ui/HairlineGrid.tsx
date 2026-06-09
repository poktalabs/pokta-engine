import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Hairline-grid wrapper — the brand's "scientific-print table" pattern.
 *
 * The wrapper paints one ink field (`bg-[var(--rule)]`) and `gap-px` lets it
 * bleed through, so every divider is a single shared hairline (never doubled).
 * Cells get their own surface background. Outer frame is the hard ink rule.
 *
 *   <HairlineGrid cols={3}>
 *     <HairlineCell>…</HairlineCell>
 *     <HairlineCell emphasis>…</HairlineCell>
 *   </HairlineGrid>
 */
export interface HairlineGridProps {
  children: ReactNode
  /** Column count at the md breakpoint. Defaults to 3. */
  cols?: 1 | 2 | 3 | 4
  className?: string
}

const COL_CLASS: Record<NonNullable<HairlineGridProps['cols']>, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
}

export function HairlineGrid({ children, cols = 3, className }: HairlineGridProps) {
  return (
    <div
      className={cn(
        'grid gap-px border border-[var(--rule)] bg-[var(--rule)]',
        COL_CLASS[cols],
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface HairlineCellProps {
  children: ReactNode
  /** Use the Lavender surface-2 for emphasis cells. */
  emphasis?: boolean
  className?: string
}

export function HairlineCell({ children, emphasis = false, className }: HairlineCellProps) {
  return (
    <div
      className={cn(
        emphasis ? 'bg-[var(--surface-2)]' : 'bg-[var(--surface)]',
        'p-7 md:p-8',
        className,
      )}
    >
      {children}
    </div>
  )
}
