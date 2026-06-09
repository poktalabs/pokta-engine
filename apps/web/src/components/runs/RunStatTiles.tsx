import { HairlineGrid, HairlineCell } from '@/components/ui/HairlineGrid'
import { formatCount } from './format'
import type { PricingRunOutput } from '@/mocks/runs'

/**
 * The four run-detail stat tiles: Analyzed / Auto-applied / Needs review /
 * No change. These are NOT plain `StatTile`s — each value is tinted with the
 * status role color it represents (per the wireframe-reconciliation fix #4):
 *   - Analyzed  → neutral ink (the denominator)
 *   - Auto-applied → OK green (#19A662)
 *   - Needs review → warn amber
 *   - No change → idle / muted ink
 *
 * Brand rule (never color alone): each tile pairs its color with the explicit
 * label below it, so meaning is carried by the words, not the hue.
 */
export interface RunStatTilesProps {
  output: PricingRunOutput
}

type Role = 'neutral' | 'ok' | 'warn' | 'idle'

const ROLE_COLOR: Record<Role, string> = {
  neutral: 'var(--foreground)',
  ok: 'var(--status-ok)',
  warn: 'var(--status-warn)',
  idle: 'var(--status-idle)',
}

interface TileSpec {
  index: number
  label: string
  value: number
  role: Role
}

function Tile({ index, label, value, role }: TileSpec) {
  return (
    <HairlineCell className="flex flex-col gap-2">
      <span className="font-serif text-3xl leading-none text-[var(--muted-foreground)]">
        {String(index).padStart(2, '0')}
      </span>
      <span
        className="font-sans text-3xl font-semibold leading-none"
        style={{ color: ROLE_COLOR[role] }}
      >
        {formatCount(value)}
      </span>
      <span className="kicker text-[var(--foreground-soft)]">{label}</span>
    </HairlineCell>
  )
}

export function RunStatTiles({ output }: RunStatTilesProps) {
  const tiles: TileSpec[] = [
    { index: 1, label: 'Products analyzed', value: output.analyzedCount, role: 'neutral' },
    { index: 2, label: 'Auto-applied', value: output.autoAppliedCount, role: 'ok' },
    { index: 3, label: 'Needs review', value: output.needsReviewCount, role: 'warn' },
    { index: 4, label: 'No change', value: output.noChangeCount, role: 'idle' },
  ]
  return (
    <HairlineGrid cols={4}>
      {tiles.map((t) => (
        <Tile key={t.label} {...t} />
      ))}
    </HairlineGrid>
  )
}
