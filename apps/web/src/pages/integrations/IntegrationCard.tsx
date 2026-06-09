import { Plug } from 'lucide-react'
import type {
  IntegrationConnectionStatus,
  IntegrationStatus,
} from '@godin-engine/contract'
import { Pill, type PillStatus } from '@/components/ui/pill'
import { cn } from '@/lib/utils'

/**
 * Integration status card (P5b-wired).
 *
 * Renders the LIVE, honest `IntegrationStatus` read model: only
 * `{ id, displayName, category, status, detail? }`. Status is the ops-asserted
 * per-tenant ENABLEMENT state (`enabled | pending | disabled`) — rendered as
 * "Enabled / Pending / Disabled", NEVER "Connected / Live". The old
 * risk-tier / report-slot / read-only-feed / provider fields and the
 * estimated/not-yet-live vocabulary are gone (the backend does not assert them).
 *
 * Brand: freestanding pop-card (1.5px ink border + hard-offset stamp), radius 0,
 * status pill is icon + label (never color alone).
 */

/** Map the per-tenant connection status → the shared status-pill role + copy. */
const STATUS_PILL: Record<
  IntegrationConnectionStatus,
  { status: PillStatus; label: string; iconLabel: string }
> = {
  enabled: { status: 'ok', label: 'Enabled', iconLabel: 'Status: enabled' },
  pending: { status: 'warn', label: 'Pending', iconLabel: 'Status: pending' },
  disabled: { status: 'idle', label: 'Disabled', iconLabel: 'Status: disabled' },
}

export interface IntegrationCardProps {
  integration: IntegrationStatus
  className?: string
}

export function IntegrationCard({ integration, className }: IntegrationCardProps) {
  const pill = STATUS_PILL[integration.status]
  const headingId = `integration-${integration.id}`

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
            {integration.displayName}
          </h3>
        </div>
        <span className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          {integration.category}
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Pill status={pill.status} iconLabel={pill.iconLabel} showTick>
          {pill.label}
        </Pill>
      </div>

      {integration.detail && (
        <p className="text-sm leading-relaxed text-[var(--foreground-soft)]">
          {integration.detail}
        </p>
      )}
    </article>
  )
}
