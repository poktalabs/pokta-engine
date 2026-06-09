import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { HairlineCell } from '@/components/ui/HairlineGrid'

/**
 * Stat tile — a hairline-grid cell with a serif index numeral, a big value and
 * a label. Drop these inside a <HairlineGrid> so the gap-px rules separate them.
 *
 *   <HairlineGrid cols={4}>
 *     <StatTile index={1} label="Products analyzed" value="316" />
 *     ...
 *   </HairlineGrid>
 */
export interface StatTileProps {
  /** 1-based index; rendered as a serif, zero-padded numeral. */
  index?: number
  label: ReactNode
  value: ReactNode
  /** Optional trailing detail (e.g. a delta pill). */
  detail?: ReactNode
  emphasis?: boolean
  className?: string
}

export function StatTile({
  index,
  label,
  value,
  detail,
  emphasis = false,
  className,
}: StatTileProps) {
  return (
    <HairlineCell emphasis={emphasis} className={cn('flex flex-col gap-2', className)}>
      {index != null && (
        <span className="font-serif text-3xl leading-none text-[var(--muted-foreground)]">
          {String(index).padStart(2, '0')}
        </span>
      )}
      <span className="font-sans text-3xl font-semibold leading-none text-[var(--foreground)]">
        {value}
      </span>
      <span className="kicker text-[var(--foreground-soft)]">{label}</span>
      {detail}
    </HairlineCell>
  )
}
