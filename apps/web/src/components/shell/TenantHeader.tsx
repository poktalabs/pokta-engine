import { useTenant } from '@/providers/TenantProvider'

/**
 * Product + tenant co-branding lockup (P1).
 *
 * The PRODUCT brand is the Pokta Labs mark + "PoktaEngine" wordmark, mirroring
 * the poktalabs-landing-page lockup: 20px logo, gap-1 to the wordmark, words
 * set together in Funnel Display with "Pokta" = secondary (Midnight Violet) and
 * "Engine" = accent (Brick Ember). The lockup column is w-56 so it lines up with
 * the sidebar beneath it. The tenant identity (Mi Pase / Vino) sits beside it
 * with an optional amber "test store" badge.
 */
export function TenantHeader() {
  const tenant = useTenant()
  return (
    <div className="flex items-center gap-4">
      <span className="inline-flex w-56 shrink-0 items-center gap-1 font-funnel text-2xl font-medium tracking-tight">
        <img src="/logo/poktalabs-logo.svg" alt="Pokta Labs" width={20} height={20} className="size-5" />
        <span>
          <span className="text-secondary">Pokta</span>
          <span className="text-accent">Engine</span>
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
