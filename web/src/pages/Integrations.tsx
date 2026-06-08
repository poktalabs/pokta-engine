import { Plug } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTenant } from '@/providers/TenantProvider'

/**
 * Integrations surface — P1 placeholder. P4-A fills the per-tenant integration
 * card grid (mock-only behind VITE_USE_MOCKS) with status + risk-tier badges.
 */
export default function Integrations() {
  const tenant = useTenant()
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Integrations</h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          {tenant.integrations.length} connectors configured for {tenant.name}.
        </p>
      </header>
      <EmptyState
        Icon={Plug}
        title="The integrations grid lands in P4"
        description="Per-tenant connector cards with live/estimated status arrive in the next phase."
      />
    </section>
  )
}
