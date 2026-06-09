import { Workflow } from 'lucide-react'
import type { ErrorEnvelope } from '@godin-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { HairlineGrid } from '@/components/ui/HairlineGrid'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { WorkflowRow } from '@/components/workflows/WorkflowRow'
import { useWorkspaceWorkflows } from './use-workflows'

/**
 * WORKFLOWS list surface (P5b-wired).
 *
 * Lists the active tenant's workflow CARDS (trigger, last-run pill, pending count)
 * via <WorkflowRow>, driven by the LIVE `useWorkspaceWorkflows()` hook
 * (GET /v1/workspace/workflows). Covers the full state matrix
 * (loading / empty / error+403 / loaded). Graceful degradation (D3): any endpoint
 * error renders ErrorState (code-aware copy via ApiError.envelope), never a white
 * screen; an empty roster renders the honest EmptyState.
 */

export default function WorkflowsList() {
  const tenant = useTenant()
  const { data, isPending, isError, error, refetch } = useWorkspaceWorkflows()
  const basePath = `/${tenant.id}/workflows`

  let body: React.ReactNode
  if (isPending) {
    body = <LoadingState label="Loading workflows…" />
  } else if (isError) {
    const envelope: ErrorEnvelope | undefined = error?.envelope
    body = <ErrorState error={envelope} onRetry={() => void refetch()} />
  } else if (data.workflows.length === 0) {
    body = (
      <EmptyState
        Icon={Workflow}
        title="No workflows yet"
        description="When workflows are configured for your workspace they’ll appear here."
      />
    )
  } else {
    body = (
      <HairlineGrid cols={1}>
        {data.workflows.map((workflow) => (
          <WorkflowRow key={workflow.id} workflow={workflow} basePath={basePath} />
        ))}
      </HairlineGrid>
    )
  }

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

      {body}
    </section>
  )
}
