import { useNavigate, useParams } from 'react-router-dom'
import type { ErrorEnvelope, RunDetail as RunDetailRow } from '@pokta-engine/contract'
import { useTenant } from '@/providers/TenantProvider'
import { RunDetailHeader } from '@/components/runs/RunDetailHeader'
import { RunStatTiles } from '@/components/runs/RunStatTiles'
import { ReviewCallout } from '@/components/runs/ReviewCallout'
import { AutoAppliedCollapse } from '@/components/runs/AutoAppliedCollapse'
import { NoChangeLine } from '@/components/runs/NoChangeLine'
import { PartialFailureBanner } from '@/components/runs/PartialFailureBanner'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import type { PricingRunOutput } from '@/mocks/runs'
import { useRerunWorkflow, useRunDetail } from './use-run-detail'

/**
 * RUN DETAIL surface (P5b-wired).
 *
 * Wires the run-detail summary to the LIVE read model (GET /v1/runs/:id) via
 * `useRunDetail`, and Re-run to the real dispatch (POST /v1/workflows/:id/runs)
 * via `useRerunWorkflow`. The run `output` is opaque per-workflow JSON; this page
 * narrows it to the daily-pricing `PricingRunOutput` shape (the renderer-owned
 * shape, imported as a TYPE only). When a run carries that shape it renders the
 * rich tiles + review callout + applied/no-change breakdown; otherwise it renders
 * a clean run summary (header + empty-summary), never a crash.
 *
 * Graceful degradation (D3): loading / not-found (404) / error all render cleanly.
 */

const WORKFLOW_NAME = 'Daily Pricing'

/**
 * Narrow the opaque run `output` to the daily-pricing shape, defensively.
 *
 * The `kind` tag alone is NOT enough: a real run can tag its output before the
 * arrays/counts are populated (an early-aborted, failed, or partial run can emit
 * `{kind:'mipase.daily-pricing'}` with `flagged`/`applied` absent). The rich tiles
 * + callouts then `.map()` those arrays — so a kind-only narrow would `undefined.map`
 * → throw → white screen (there is no app-wide error boundary). We therefore require
 * the full shape (both arrays present + the numeric counts) before returning the
 * rich output; a partial payload falls through to the clean "No run summary yet"
 * EmptyState branch instead of crashing.
 */
function asPricingOutput(run: RunDetailRow): PricingRunOutput | null {
  const out = run.output
  if (
    out &&
    typeof out === 'object' &&
    (out as { kind?: unknown }).kind === 'mipase.daily-pricing'
  ) {
    const o = out as Partial<PricingRunOutput>
    if (
      Array.isArray(o.flagged) &&
      Array.isArray(o.applied) &&
      typeof o.analyzedCount === 'number' &&
      typeof o.autoAppliedCount === 'number' &&
      typeof o.needsReviewCount === 'number' &&
      typeof o.noChangeCount === 'number'
    ) {
      return out as PricingRunOutput
    }
  }
  return null
}

export default function RunDetail() {
  const tenant = useTenant()
  const navigate = useNavigate()
  const params = useParams()
  const runId = params.id

  const { data: run, isPending, isError, error, refetch } = useRunDetail(runId)
  const rerun = useRerunWorkflow()
  const basePath = `/${tenant.id}`

  if (isPending) {
    return (
      <section className="space-y-6">
        <LoadingState label="Loading run…" />
      </section>
    )
  }

  if (isError) {
    const envelope: ErrorEnvelope | undefined = error?.envelope
    // A 404 reads as "not found" via the shared ErrorState code-aware copy; any
    // other error renders its envelope. Never a white screen.
    return (
      <section className="space-y-6">
        <ErrorState error={envelope} onRetry={() => void refetch()} />
      </section>
    )
  }

  // `run` is defined past the isPending/isError guards above.
  const resolvedRun = run
  const doRerun = () => {
    rerun.mutate(
      { workflowId: resolvedRun.workflowId },
      {
        // Routing to the workflow keeps the affordance live even when a child run
        // id isn't surfaced; the workflow page shows the fresh run.
        onSuccess: () => navigate(`${basePath}/workflows/${resolvedRun.workflowId}`),
      },
    )
  }

  const output = asPricingOutput(resolvedRun)

  // A non-pricing run (or missing output) renders a clean summary rather than
  // crashing — keeps the surface robust as more workflows land.
  if (!output) {
    return (
      <section className="space-y-6">
        <RunDetailHeader
          run={run}
          workflowName={WORKFLOW_NAME}
          heldAtGate={false}
          basePath={basePath}
          onRerun={doRerun}
        />
        {rerun.isError && (
          <ErrorState error={rerun.error?.envelope} onRetry={doRerun} />
        )}
        <EmptyState
          title="No run summary yet"
          description="This run hasn’t produced a summary the dashboard can display."
        />
      </section>
    )
  }

  const isFailure = run.status === 'failed'
  const heldAtGate = !isFailure && output.needsReviewCount > 0

  return (
    <section className="space-y-8">
      <RunDetailHeader
        run={run}
        workflowName={WORKFLOW_NAME}
        heldAtGate={heldAtGate}
        basePath={basePath}
        onRerun={doRerun}
      />

      {rerun.isError && <ErrorState error={rerun.error?.envelope} onRetry={doRerun} />}

      <RunStatTiles output={output} />

      {isFailure ? (
        <PartialFailureBanner
          error={
            run.error ?? {
              code: 'SKILL_EXEC_ERROR',
              message: 'Some prices failed to apply.',
              retryable: true,
            }
          }
          failedItems={output.flagged}
          onRetry={doRerun}
        />
      ) : (
        <ReviewCallout
          count={output.needsReviewCount}
          items={output.flagged}
          onReview={() => navigate(`${basePath}/approvals`)}
        />
      )}

      <AutoAppliedCollapse count={output.autoAppliedCount} items={output.applied} />

      <NoChangeLine count={output.noChangeCount} />
    </section>
  )
}
