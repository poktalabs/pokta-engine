import type { ComponentType } from 'react'
import { ShieldCheck, ShieldAlert, OctagonAlert, type LucideProps } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RiskTier } from '@/mocks/integrations'

/**
 * Risk-tier badge — `.risk` / `.risk-{low,med,high}` from `risk-tiers.css`.
 *
 * The resolved 3-tier scale (P1-C-risk, decided by Mel): Low = muted ink,
 * Medium = brand amber, High = brick ember (the only "stop" color). There is NO
 * 4th color — JobTread's "very-high" estimate-commit risk folds into `high`, with
 * the copy ("Highest") carrying the nuance instead of a new hue.
 *
 * Brand rule: never meaning by color alone — every badge renders an icon AND a
 * text label, and the icon carries an accessible name.
 */

interface RiskMeta {
  className: string
  Icon: ComponentType<LucideProps>
  /** Visible label (uppercased by CSS). */
  label: string
  /** Accessible name for the icon. */
  accessibleName: string
}

const RISK_META: Record<RiskTier, RiskMeta> = {
  low: {
    className: 'risk-low',
    Icon: ShieldCheck,
    label: 'Low risk',
    accessibleName: 'Risk: low',
  },
  medium: {
    className: 'risk-med',
    Icon: ShieldAlert,
    label: 'Medium risk',
    accessibleName: 'Risk: medium',
  },
  high: {
    className: 'risk-high',
    Icon: OctagonAlert,
    label: 'Highest risk',
    accessibleName: 'Risk: highest',
  },
}

export interface RiskBadgeProps {
  tier: RiskTier
  /** Override the visible label (e.g. tenant-specific phrasing). */
  label?: string
  className?: string
}

export function RiskBadge({ tier, label, className }: RiskBadgeProps) {
  const meta = RISK_META[tier]
  const { Icon } = meta
  return (
    <span className={cn('risk', meta.className, className)}>
      <Icon className="size-3" aria-label={meta.accessibleName} role="img" />
      <span>{label ?? meta.label}</span>
    </span>
  )
}
