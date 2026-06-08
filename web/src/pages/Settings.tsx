import { Settings as SettingsIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * Settings surface — P1 placeholder. P4-C fills tenant profile + integration
 * status + roster, read-only for M2 (no credential editing — no backend yet).
 */
export default function Settings() {
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">Settings</h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Tenant profile, integration status and team (read-only for M2).
        </p>
      </header>
      <EmptyState
        Icon={SettingsIcon}
        title="Settings land in P4"
        description="Read-only tenant profile, integration credential status and roster arrive in the next phase."
      />
    </section>
  )
}
