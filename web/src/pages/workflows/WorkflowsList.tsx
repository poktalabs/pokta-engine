import { useMemo, useState } from 'react'
import { Workflow } from 'lucide-react'
import type { ErrorEnvelope } from '@godin-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { HairlineGrid } from '@/components/ui/HairlineGrid'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { WorkflowRow } from '@/components/workflows/WorkflowRow'
import { MOCK_WORKFLOWS, type WorkflowListItem } from '@/mocks/workflows'

/**
 * WORKFLOWS list surface (M2 P3-A).
 *
 * Lists the active tenant's workflows as hairline-grid rows (trigger, last-run
 * pill, pending count) via <WorkflowRow>. Covers the full state matrix
 * (loading / empty / error+403 / loaded) on mock data behind `VITE_USE_MOCKS`.
 * P5b swaps `useWorkflowsList()` for the `use-workflows` TanStack hook.
 *
 * `?mock=` query toggles the demo state (`loading` / `empty` / `error` /
 * `forbidden`) so every branch is reachable without a backend.
 */

type ListState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; error: ErrorEnvelope }
  | { status: 'loaded'; workflows: WorkflowListItem[] }

const FORBIDDEN: ErrorEnvelope = {
  code: 'APPROVAL_DENIED',
  message: 'You don’t have access to this workspace’s workflows.',
  retryable: false,
}

const GENERIC: ErrorEnvelope = {
  code: 'SKILL_EXEC_ERROR',
  message: 'We couldn’t load your workflows.',
  retryable: true,
}

/** Resolve the list state from mock data + a demo `?mock=` override. */
function useWorkflowsList(): ListState {
  const demo = new URLSearchParams(window.location.search).get('mock')
  return useMemo<ListState>(() => {
    switch (demo) {
      case 'loading':
        return { status: 'loading' }
      case 'empty':
        return { status: 'empty' }
      case 'error':
        return { status: 'error', error: GENERIC }
      case 'forbidden':
        return { status: 'error', error: FORBIDDEN }
      default:
        return { status: 'loaded', workflows: MOCK_WORKFLOWS }
    }
  }, [demo])
}

export default function WorkflowsList() {
  const tenant = useTenant()
  const initial = useWorkflowsList()
  // Local copy so a Retry can flip an error back to loaded in the mock demo.
  const [state, setState] = useState<ListState>(initial)
  const basePath = `/${tenant.id}/workflows`

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl leading-tight text-[var(--foreground)]">
          Workflows
        </h1>
        <p className="text-sm text-[var(--foreground-soft)]">
          Your automated, human-gated workflows.
        </p>
      </header>

      {state.status === 'loading' && <LoadingState label="Loading workflows…" />}

      {state.status === 'empty' && (
        <EmptyState
          Icon={Workflow}
          title="No workflows yet"
          description="When workflows are configured for your workspace they’ll appear here."
        />
      )}

      {state.status === 'error' && (
        <ErrorState
          error={state.error}
          onRetry={() => setState({ status: 'loaded', workflows: MOCK_WORKFLOWS })}
        />
      )}

      {state.status === 'loaded' && (
        <HairlineGrid cols={1}>
          {state.workflows.map((workflow) => (
            <WorkflowRow key={workflow.id} workflow={workflow} basePath={basePath} />
          ))}
        </HairlineGrid>
      )}
    </section>
  )
}
