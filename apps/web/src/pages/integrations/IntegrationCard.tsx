import { Plug, ArrowDownToLine } from 'lucide-react'
import { Pill, type PillStatus } from '@/components/ui/pill'
import { cn } from '@/lib/utils'
import type { IntegrationStatus, IntegrationConnectionStatus } from '@/mocks/integrations'
import { RiskBadge } from './RiskBadge'

/**
 * Integration status card (M2 P4-A).
 *
 * A freestanding pop-card — own `1.5px ink` border + `4px 4px 0 0 ink` stamp that
 * lifts on hover (the brand's choice-card affordance; integrations ARE choices, so
 * the hairline grid is not the right system here). Carries:
 *   - connector name + a sharp square instrument badge (brand cue)
 *   - a status pill (connection status) — icon + label, never color alone
 *   - a 3-tier risk badge (risk-tiers.css)
 *   - a small report/data slot (the compact figure the card surfaces)
 *
 * Radius 0, hairline rules, no gradients — all from the design system.
 */

/** Map connection status → the shared status-pill role + label/icon copy. */
const STATUS_PILL: Record<
  IntegrationConnectionStatus,
  { status: PillStatus; label: string; iconLabel: string }
> = {
  connected: { status: 'ok', label: 'Connected', iconLabel: 'Status: connected' },
  estimated: { status: 'warn', label: 'Estimated', iconLabel: 'Status: estimated' },
  'not-yet-live': { status: 'idle', label: 'Not yet live', iconLabel: 'Status: not yet live' },
}

export interface IntegrationCardProps {
  integration: IntegrationStatus
  className?: string
}

export function IntegrationCard({ integration, className }: IntegrationCardProps) {
  const pill = STATUS_PILL[integration.status]
  const headingId = `integration-${integration.provider}`

  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        // pop-card: own ink border + hard-offset stamp + hover lift (radius 0)
        'btn flex h-full flex-col items-stretch gap-4 bg-[var(--surface)] p-5 text-left',
        // `.btn` defaults to inline-flex + center; override for a block card.
        'justify-start',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center border border-[var(--rule)] bg-[var(--background)]"
          >
            <Plug className="size-4 text-[var(--accent-text)]" />
          </span>
          <h3
            id={headingId}
            className="font-serif text-lg leading-tight text-[var(--foreground)]"
          >
            {integration.name}
          </h3>
        </div>
        {integration.readOnly && (
          <span
            className="inline-flex items-center gap-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]"
            title="Read-only feed — this connector only reads, never writes back."
          >
            <ArrowDownToLine className="size-3" aria-hidden="true" />
            Feed
          </span>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Pill status={pill.status} iconLabel={pill.iconLabel} showTick>
          {pill.label}
        </Pill>
        <RiskBadge tier={integration.riskTier} />
      </div>

      {integration.detail && (
        <p className="text-sm leading-relaxed text-[var(--foreground-soft)]">
          {integration.detail}
        </p>
      )}

      {integration.report && (
        // The small report/data slot — a compact figure, hairline-separated.
        <dl className="mt-auto flex items-baseline justify-between border-t border-[var(--border)] pt-3">
          <dt className="text-xs uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
            {integration.report.label}
          </dt>
          <dd className="font-serif text-xl leading-none text-[var(--foreground)]">
            {integration.report.value}
          </dd>
        </dl>
      )}
    </article>
  )
}
