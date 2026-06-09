import { Navigate, Outlet, useParams } from 'react-router-dom'
import { TopBar } from '@/components/shell/TopBar'
import { Sidebar } from '@/components/shell/Sidebar'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import { AccessDenied } from '@/components/auth/AccessDenied'
import { useTenantContext } from '@/providers/TenantProvider'

/**
 * Tenant-agnostic workspace shell + ROUTER-LEVEL tenant gate (PR2b W4).
 *
 * TenantProvider sits ABOVE the router and cannot navigate, so the gate lives
 * here (AppShell mounts under `/:tenant`, inside the router). It branches on the
 * server tenant resolution:
 *
 *   - `loading`       → spinner (the `/v1/tenants/me` query is in flight).
 *   - `access-denied` → the dedicated ACCESS-DENIED screen (403 TENANT_UNKNOWN):
 *                       the DID is in no `members[]`. NEVER a default/other tenant.
 *   - `error`         → a generic retryable error state (network/5xx).
 *   - `ready`         → if the `/:tenant` URL segment ≠ the SERVER tenant id, REDIRECT
 *                       to the server tenant's URL (anti-spoof / URL hygiene — the
 *                       real boundary is server scoping, so a forged segment can
 *                       never leak another tenant's data; this just keeps the URL
 *                       honest). Otherwise render the workspace.
 */
export function AppShell() {
  const { tenant: tenantParam } = useParams()
  const { tenant, status, refetch } = useTenantContext()

  if (status === 'loading') return <LoadingState label="Loading workspace…" />
  if (status === 'access-denied') return <AccessDenied />
  if (status === 'error' || !tenant) {
    return <ErrorState title="Could not load your workspace" onRetry={refetch} />
  }

  // Server is the tenant authority: a URL segment that disagrees is redirected to
  // the resolved tenant, preserving the sub-path (approvals/runs/…).
  if (tenantParam !== tenant.id) {
    const rest = window.location.pathname.split('/').slice(2).join('/')
    const suffix = rest ? `/${rest}` : '/approvals'
    return <Navigate to={`/${tenant.id}${suffix}`} replace />
  }

  const pendingApprovals = 0 // P2 wires the real pending count

  return (
    <div data-tenant={tenant.id} className="flex min-h-screen flex-col bg-[var(--background)]">
      <TopBar />
      <div className="flex flex-1">
        <Sidebar pendingApprovals={pendingApprovals} />
        <main className="min-w-0 flex-1 p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
