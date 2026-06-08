import { Pill, type PillStatus } from '@/components/ui/pill'
import { RiskBadge } from '@/pages/settings/RiskBadge'
import type {
  IntegrationConnectionStatus,
  IntegrationStatusSummary,
} from '@/mocks/settings'

/**
 * Integration-status summary — READ-ONLY (M2 P4-C). A hairline-grid table of the
 * tenant's connectors with status + risk-tier. NO credential editing: this is a
 * status display only. Each connector maps its `connected | estimated |
 * not-yet-live` status to a brand status pill (icon + label, never color alone)
 * and shows the resolved 3-tier risk badge.
 */

interface StatusMeta {
  pill: PillStatus
  label: string
  iconLabel: string
}

const STATUS_META: Record<IntegrationConnectionStatus, StatusMeta> = {
  connected: { pill: 'ok', label: 'Connected', iconLabel: 'Connected' },
  estimated: { pill: 'warn', label: 'Estimated', iconLabel: 'Estimated (illustrative)' },
  'not-yet-live': { pill: 'idle', label: 'Not yet live', iconLabel: 'Not yet live' },
}

export interface IntegrationStatusPanelProps {
  integrations: IntegrationStatusSummary[]
}

export function IntegrationStatusPanel({ integrations }: IntegrationStatusPanelProps) {
  return (
    <section aria-labelledby="settings-integrations-heading" className="space-y-4">
      <div className="space-y-1">
        <h2
          id="settings-integrations-heading"
          className="font-serif text-xl leading-tight text-[var(--foreground)]"
        >
          Integration status
        </h2>
        <p className="text-sm text-[var(--foreground-soft)]">
          Connector status is read-only and illustrative for M2 — credential
          management is not available yet.
        </p>
      </div>

      <div
        role="table"
        aria-label="Integration status"
        className="border border-[var(--rule)] bg-[var(--surface)]"
      >
        <div
          role="row"
          className="grid grid-cols-[1.4fr_1fr_0.8fr] gap-4 border-b border-[var(--rule)] px-5 py-3"
        >
          <span role="columnheader" className="kicker text-[var(--foreground-soft)]">
            Connector
          </span>
          <span role="columnheader" className="kicker text-[var(--foreground-soft)]">
            Status
          </span>
          <span role="columnheader" className="kicker text-[var(--foreground-soft)]">
            Risk
          </span>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {integrations.map((integration) => {
            const meta = STATUS_META[integration.status]
            return (
              <div
                key={integration.provider}
                role="row"
                className="grid grid-cols-[1.4fr_1fr_0.8fr] items-center gap-4 px-5 py-4"
              >
                <span role="cell" className="flex flex-col gap-0.5">
                  <span className="font-sans text-sm font-semibold text-[var(--foreground)]">
                    {integration.label}
                  </span>
                  {integration.detail && (
                    <span className="text-xs leading-snug text-[var(--foreground-soft)]">
                      {integration.detail}
                    </span>
                  )}
                </span>
                <span role="cell">
                  <Pill status={meta.pill} iconLabel={meta.iconLabel} showTick>
                    {meta.label}
                  </Pill>
                </span>
                <span role="cell">
                  <RiskBadge tier={integration.riskTier} />
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
