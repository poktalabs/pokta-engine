import { useQuery } from '@tanstack/react-query'
import { Plug, Info } from 'lucide-react'
import { apiFetch, ApiError } from '@/lib/api'
import type { ErrorEnvelope } from '@godin-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import type { IntegrationListResponse } from '@/mocks/integrations'
// Side-effect import: registers the `GET /v1/integrations` mock with the registry.
// The base barrel (`mocks/index.ts`) doesn't import this fixture yet, so this keeps
// the surface self-contained behind `VITE_USE_MOCKS`. Harmless when mocks are off —
// it only adds an unused route to the in-process registry.
import '@/mocks/integrations'
import { IntegrationCard } from './IntegrationCard'

/**
 * Integrations surface (M2 P4-A) — the full P4-A deliverable.
 *
 * A per-tenant grid of status cards, each carrying a connection-status pill, a
 * 3-tier risk badge (risk-tiers.css) and a small report/data slot. Driven by
 * TanStack Query → `apiFetch('/v1/integrations?tenant=…')`, which is served from
 * the in-process mock registry behind `VITE_USE_MOCKS` (no backend exists for any
 * of these providers yet). Implements the full state matrix:
 * loading / empty / error (incl. 403) / loaded.
 *
 * Because the data is mock-only, the page renders a clear "status is illustrative"
 * affordance so an operator never mistakes a simulated connector for a live one.
 *
 * This is a NEW, self-contained surface module under `pages/integrations/`. Wiring
 * it into the route tree (replacing the P1 placeholder `pages/Integrations.tsx`)
 * is the App.tsx owner's call — this module ships ready to mount.
 */

export default function Integrations() {
  const tenant = useTenant()

  const query = useQuery<IntegrationListResponse, ApiError>({
    queryKey: ['integrations', tenant.id],
    queryFn: () =>
      apiFetch<IntegrationListResponse>(`/v1/integrations?tenant=${tenant.id}`),
  })

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
          Integrations
        </h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Connectors {tenant.name} uses — connection status and the risk of each
          connector&rsquo;s writes.
        </p>
      </header>

      {/* "status is illustrative" affordance — mock data is not a live signal. */}
      <p
        role="note"
        className="flex items-start gap-2 border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-xs leading-relaxed text-[var(--foreground-soft)]"
      >
        <Info className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
        <span>
          Status shown here is illustrative. Connectors marked{' '}
          <strong className="font-semibold">Estimated</strong> are wired but have no
          key in this deployment, so their actions are simulated.
        </span>
      </p>

      <IntegrationsBody query={query} tenantName={tenant.name} />
    </section>
  )
}

/** Render the state matrix (loading / empty / error+403 / loaded). */
function IntegrationsBody({
  query,
  tenantName,
}: {
  query: ReturnType<typeof useQuery<IntegrationListResponse, ApiError>>
  tenantName: string
}) {
  if (query.isPending) {
    return <LoadingState label="Loading integrations…" />
  }

  if (query.isError) {
    // ApiError carries the typed envelope; ErrorState renders code-aware copy
    // (incl. the 403 APPROVAL_REQUIRED / APPROVAL_DENIED variants).
    const envelope: ErrorEnvelope | undefined = query.error?.envelope
    return <ErrorState error={envelope} onRetry={() => query.refetch()} />
  }

  const integrations = query.data.integrations
  if (integrations.length === 0) {
    return (
      <EmptyState
        Icon={Plug}
        title="No integrations yet"
        description={`No connectors are configured for ${tenantName} yet. They appear here once wired.`}
      />
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {integrations.map((integration) => (
        <IntegrationCard key={integration.provider} integration={integration} />
      ))}
    </div>
  )
}
