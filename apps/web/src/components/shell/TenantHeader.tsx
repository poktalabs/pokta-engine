import { useTenant } from '@/providers/TenantProvider'

/**
 * Product + tenant co-branding lockup (P1).
 *
 * "Godin Engine by Pokta Labs" is the PRODUCT brand; the tenant identity (Mi
 * Pase / Vino) sits beside it with an optional amber "test store" badge. Funnel
 * Display medium wordmark; "Godin" = secondary (Midnight Violet), "Engine" =
 * accent (Brick Ember), per the brand lockup rule.
 */
export function TenantHeader() {
  const tenant = useTenant()
  return (
    <div className="flex items-center gap-4">
      <span className="inline-flex items-baseline gap-1.5 font-funnel text-lg font-medium tracking-tight">
        <span className="text-secondary">Godin</span>
        <span className="text-accent">Engine</span>
        <span className="ml-1 text-xs font-normal text-[var(--muted-foreground)]">
          by Pokta Labs
        </span>
      </span>

      {/* tenant divider + identity */}
      <span aria-hidden="true" className="h-5 w-px bg-[var(--rule)]" />

      <div className="flex items-center gap-2">
        <span className="font-sans text-sm font-semibold text-[var(--foreground)]">
          {tenant.lockup.name}
        </span>
        {tenant.lockup.badge && (
          <span className="border border-[var(--rule)] bg-[var(--primary)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--primary-foreground)]">
            {tenant.lockup.badge}
          </span>
        )}
      </div>
    </div>
  )
}
