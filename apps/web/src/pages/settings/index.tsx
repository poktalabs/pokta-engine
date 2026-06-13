import { useTenant, useTenantContext } from '@/providers/TenantProvider'
import { ApiError } from '@/lib/api'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import { TenantProfilePanel } from '@/pages/settings/TenantProfilePanel'
import { IntegrationStatusPanel } from '@/pages/settings/IntegrationStatusPanel'
import { TeamPanel } from '@/pages/settings/TeamPanel'

/**
 * Settings surface (P5b-wired) — READ-ONLY.
 *
 * The tenant PROFILE comes from the already-live TenantProvider
 * (`useTenantContext().view` : TenantView — GET /v1/tenants/me). There is NO
 * `/v1/settings` endpoint. The integration-status panel is an honest DEFERRED shell
 * (ComingSoon). The TEAM panel (admin-roles Wave B) is now LIVE + role-adaptive
 * against the Wave A role endpoints; it is cosmetic (the server re-checks every
 * action) and renders no DIDs-as-emails.
 *
 * Graceful degradation (D3): the provider's loading / access-denied / error states
 * are surfaced cleanly rather than white-screening.
 */
export default function Settings() {
  const tenant = useTenant()
  const { view, status, error, refetch } = useTenantContext()
  const basePath = `/${tenant.id}`

  const header = (
    <header className="space-y-1">
      <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
        Settings
      </h1>
      <p className="text-sm text-[var(--foreground-soft)]">
        Tenant profile and workspace — read-only.
      </p>
    </header>
  )

  let body: React.ReactNode
  if (status === 'loading' || !view) {
    body = <LoadingState label="Loading settings…" />
  } else if (status === 'error') {
    body = (
      <ErrorState
        error={error instanceof ApiError ? error.envelope : undefined}
        title="Could not load your settings"
        onRetry={refetch}
      />
    )
  } else {
    body = (
      <div className="space-y-10">
        <TenantProfilePanel view={view} />
        <IntegrationStatusPanel basePath={basePath} />
        <TeamPanel />
      </div>
    )
  }

  return (
    <section className="space-y-8">
      {header}
      {body}
    </section>
  )
}
