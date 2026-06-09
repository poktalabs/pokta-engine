import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { ErrorEnvelope } from '@godin-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { getMockSettings, type SettingsView } from '@/mocks/settings'
import { TenantProfilePanel } from '@/pages/settings/TenantProfilePanel'
import { IntegrationStatusPanel } from '@/pages/settings/IntegrationStatusPanel'
import { MemberRosterPanel } from '@/pages/settings/MemberRosterPanel'

/**
 * Settings surface (M2 P4-C) — READ-ONLY.
 *
 * Three read-only panels: tenant profile, integration-status summary, and the
 * user roster. There is NO credential editing and NO write surface in M2;
 * credential + member management are explicitly descoped (each panel states it).
 *
 * Renders the full 4-state matrix (loading / empty / error / loaded) on mock
 * data behind `VITE_USE_MOCKS`. No backend exists for `/v1/settings` yet, so the
 * data comes from `@/mocks/settings` directly; P5b swaps this for a TanStack
 * Query hook against `apiFetch` with no change to the panels.
 *
 * A `?settings_state=loading|empty|error|loaded` query param forces a state for
 * QA / design review; the default path resolves the live (mock) tenant payload.
 */

type ViewState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; error: ErrorEnvelope }
  | { kind: 'loaded'; data: SettingsView }

type ForcedState = 'loading' | 'empty' | 'error' | 'loaded'

const FORBIDDEN_ERROR: ErrorEnvelope = {
  code: 'APPROVAL_DENIED',
  message:
    'You don’t have access to this workspace’s settings. Ask an owner to grant access.',
  retryable: false,
}

function readForcedState(): ForcedState | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('settings_state')
  if (raw === 'loading' || raw === 'empty' || raw === 'error' || raw === 'loaded') {
    return raw
  }
  return null
}

export default function Settings() {
  const tenant = useTenant()
  const [state, setState] = useState<ViewState>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    const forced = readForcedState()

    // Forced states resolve synchronously (after a tick) for QA/demo.
    if (forced === 'loading') {
      setState({ kind: 'loading' })
      return
    }
    if (forced === 'empty') {
      setState({ kind: 'empty' })
      return
    }
    if (forced === 'error') {
      setState({ kind: 'error', error: FORBIDDEN_ERROR })
      return
    }

    setState({ kind: 'loading' })
    // Mock-data-first: resolve the tenant's read-only settings without the
    // network. The small delay lets the loading state be observable.
    const timer = setTimeout(() => {
      if (!active) return
      const data = getMockSettings(tenant.id)
      const isEmpty =
        data.integrations.length === 0 && data.members.length === 0
      setState(isEmpty ? { kind: 'empty' } : { kind: 'loaded', data })
    }, 150)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [tenant.id])

  return (
    <section className="space-y-8">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
          Settings
        </h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Tenant profile, integration status and team — read-only for M2.
        </p>
      </header>

      {state.kind === 'loading' && <LoadingState label="Loading settings…" />}

      {state.kind === 'empty' && (
        <EmptyState
          Icon={SlidersHorizontal}
          title="Nothing to show yet"
          description="This workspace has no integrations or team members configured. They’ll appear here once your workspace is set up."
        />
      )}

      {state.kind === 'error' && <ErrorState error={state.error} />}

      {state.kind === 'loaded' && (
        <div className="space-y-10">
          <TenantProfilePanel profile={state.data.profile} />
          {state.data.integrations.length > 0 && (
            <IntegrationStatusPanel integrations={state.data.integrations} />
          )}
          <MemberRosterPanel members={state.data.members} />
        </div>
      )}
    </section>
  )
}
