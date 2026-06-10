import { useQuery } from '@tanstack/react-query'
import { Plug } from 'lucide-react'
import type { ErrorEnvelope, IntegrationListResponse } from '@godin-engine/contract'
import { apiFetch, ApiError } from '@/lib/api'
import { useTenant } from '@/providers/TenantProvider'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { IntegrationCard } from './IntegrationCard'

/**
 * Integrations surface (P5b-wired).
 *
 * A per-tenant grid of integration status cards, driven by the LIVE read model
 * (GET /v1/integrations) — in `LIVE_PATHS`, so it bypasses the mock registry even
 * under `VITE_USE_MOCKS`. The tenant is resolved server-side from the Privy JWT;
 * there is NO `?tenant=` param (the JWT is the only tenant authority). Status is
 * ops-asserted ENABLEMENT (`enabled | pending | disabled`), rendered honestly by
 * the card — no "illustrative/simulated" affordance, no risk tiers.
 *
 * Full state matrix (loading / empty / error+403 / loaded). Graceful degradation
 * (D3): any endpoint error renders ErrorState; an empty roster reads "no
 * integrations enabled yet".
 */

export default function Integrations() {
  const tenant = useTenant()

  const query = useQuery<IntegrationListResponse, ApiError>({
    queryKey: ['integrations'],
    queryFn: () => apiFetch<IntegrationListResponse>('/v1/integrations'),
    retry: false,
  })

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
          Integrations
        </h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Connectors {tenant.name} uses — each connector&rsquo;s enablement status.
        </p>
      </header>

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
    const envelope: ErrorEnvelope | undefined = query.error?.envelope
    return <ErrorState error={envelope} onRetry={() => void query.refetch()} />
  }

  const integrations = query.data.integrations
  if (integrations.length === 0) {
    return (
      <EmptyState
        Icon={Plug}
        title="No integrations enabled yet"
        description={`No connectors are enabled for ${tenantName} yet. They appear here once an operator enables them.`}
      />
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {integrations.map((integration) => (
        <IntegrationCard key={integration.id} integration={integration} />
      ))}
    </div>
  )
}
