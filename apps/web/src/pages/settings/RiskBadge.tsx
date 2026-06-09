import type { ComponentType } from 'react'
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  type LucideProps,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SettingsRiskTier } from '@/mocks/settings'

/**
 * Risk badge — `.risk` / `.risk-{low,med,high}` from `risk-tiers.css` (the
 * resolved 3-tier scale, no new brand color: low=muted ink, medium=amber,
 * high=brick ember).
 *
 * Brand rule: NEVER meaning by color alone. Every badge pairs an icon AND a text
 * label; the icon carries an accessible name so screen readers announce the tier.
 * Sharp (radius 0), 11px all-caps — mirrors the status pill shape.
 *
 * Settings-local for M2 (the shared RiskBadge ships with P2-C). Kept here so the
 * read-only Settings surface is self-contained.
 */

interface RiskMeta {
  riskClass: string
  Icon: ComponentType<LucideProps>
  label: string
  accessibleName: string
}

const RISK_META: Record<SettingsRiskTier, RiskMeta> = {
  low: {
    riskClass: 'risk-low',
    Icon: ShieldCheck,
    label: 'Low',
    accessibleName: 'Risk: low',
  },
  medium: {
    riskClass: 'risk-med',
    Icon: ShieldAlert,
    label: 'Medium',
    accessibleName: 'Risk: medium',
  },
  high: {
    riskClass: 'risk-high',
    Icon: ShieldX,
    label: 'High',
    accessibleName: 'Risk: high',
  },
}

export interface RiskBadgeProps {
  tier: SettingsRiskTier
  className?: string
}

export function RiskBadge({ tier, className }: RiskBadgeProps) {
  const meta = RISK_META[tier]
  const { Icon } = meta
  return (
    <span className={cn('risk', meta.riskClass, className)}>
      <Icon
        className="size-3"
        aria-label={meta.accessibleName}
        role="img"
      />
      <span>{meta.label}</span>
    </span>
  )
}
