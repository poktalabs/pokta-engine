import { HairlineGrid, HairlineCell } from '@/components/ui/HairlineGrid'
import type { TenantProfile } from '@/mocks/settings'

/**
 * Tenant profile — READ-ONLY (M2 P4-C). A hairline-grid of profile facts. No
 * editable field here: workspace-profile editing is descoped for M2.
 */

const LOCALE_LABEL: Record<TenantProfile['locale'], string> = {
  en: 'English',
  'es-MX': 'Español (México)',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface Field {
  label: string
  value: string
}

export interface TenantProfilePanelProps {
  profile: TenantProfile
}

export function TenantProfilePanel({ profile }: TenantProfilePanelProps) {
  const fields: Field[] = [
    { label: 'Workspace', value: profile.name },
    { label: 'Plan', value: profile.plan },
    { label: 'Currency', value: profile.currency },
    { label: 'Default language', value: LOCALE_LABEL[profile.locale] },
    { label: 'Created', value: formatDate(profile.createdAt) },
    { label: 'Tenant id', value: profile.tenantId },
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
        {profile.badge && (
          <span className="border border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_16%,var(--color-paper))] px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--foreground)]">
            {profile.badge}
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
