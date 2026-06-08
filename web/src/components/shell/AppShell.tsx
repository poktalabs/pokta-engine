import { Outlet } from 'react-router-dom'
import { TopBar } from '@/components/shell/TopBar'
import { Sidebar } from '@/components/shell/Sidebar'
import { useTenant } from '@/providers/TenantProvider'

/**
 * Tenant-agnostic workspace shell (P1).
 *
 * Sticky top bar + left nav + routed `<Outlet/>`. The `data-tenant` attribute is
 * set on the root so any tenant-scoped CSS hooks can key off it (none needed for
 * M2 — the light base is locked — but the seam exists for P4-Z).
 *
 * `pendingApprovals` is hardcoded to 0 in P1; P2 lifts it from the approvals
 * query so the Sidebar badge reflects the real pending count.
 */
export function AppShell() {
  const tenant = useTenant()
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
