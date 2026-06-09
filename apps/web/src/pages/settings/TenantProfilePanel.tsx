import type { TenantView } from '@godin-engine/contract'
import { HairlineGrid, HairlineCell } from '@/components/ui/HairlineGrid'

/**
 * Tenant profile — READ-ONLY (P5b-wired). A hairline-grid of profile facts built
 * from the LIVE `TenantView` (the already-live TenantProvider; no new endpoint, no
 * PATCH). No editable field here: workspace-profile editing is out of scope.
 *
 * Only fields the server actually returns are shown — id, name, status, currency,
 * locale, and the optional branding badge. Nothing is fabricated.
 */

const LOCALE_LABEL: Record<string, string> = {
  en: 'English',
  'es-MX': 'Español (México)',
}

const STATUS_LABEL: Record<TenantView['status'], string> = {
  active: 'Active',
  pending: 'Pending',
  disabled: 'Disabled',
}

interface Field {
  label: string
  value: string
}

export interface TenantProfilePanelProps {
  view: TenantView
}

export function TenantProfilePanel({ view }: TenantProfilePanelProps) {
  const fields: Field[] = [
    { label: 'Workspace', value: view.name },
    { label: 'Status', value: STATUS_LABEL[view.status] },
    { label: 'Currency', value: view.currency },
    { label: 'Default language', value: LOCALE_LABEL[view.locale] ?? view.locale },
    { label: 'Tenant id', value: view.id },
  ]

  return (
    <section aria-labelledby="settings-profile-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id="settings-profile-heading"
          className="font-serif text-xl leading-tight text-[var(--foreground)]"
        >
          Tenant profile
        </h2>
        {view.branding.badge && (
          <span className="border border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_16%,var(--color-paper))] px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--foreground)]">
            {view.branding.badge}
          </span>
        )}
      </div>

      <HairlineGrid cols={3}>
        {fields.map((field) => (
          <HairlineCell key={field.label} className="flex flex-col gap-1 p-5 md:p-6">
            <span className="kicker text-[var(--foreground-soft)]">{field.label}</span>
            <span className="font-sans text-base font-semibold text-[var(--foreground)]">
              {field.value}
            </span>
          </HairlineCell>
        ))}
      </HairlineGrid>
    </section>
  )
}
