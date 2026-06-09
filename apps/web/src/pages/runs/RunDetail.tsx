import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTenant } from '@/providers/TenantProvider'
import { RunDetailHeader } from '@/components/runs/RunDetailHeader'
import { RunStatTiles } from '@/components/runs/RunStatTiles'
import { ReviewCallout } from '@/components/runs/ReviewCallout'
import { AutoAppliedCollapse } from '@/components/runs/AutoAppliedCollapse'
import { NoChangeLine } from '@/components/runs/NoChangeLine'
import { PartialFailureBanner } from '@/components/runs/PartialFailureBanner'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  MOCK_RUN_DETAIL,
  MOCK_RUN_DETAIL_PARTIAL_FAILURE,
  PARTIAL_FAILURE_FAILED_ROW_IDS,
  getPricingOutput,
} from '@/mocks/runs'

/**
 * RUN DETAIL surface (M2 P3-B).
 *
 * Answers "what did the run do, and what still needs me?" for the Mi Pase
 * daily-pricing run. Composition:
 *   breadcrumb → serif title + HELD-AT-GATE pill + Re-run
 *   → 4 stat tiles (analyzed / auto-applied / needs-review / no-change)
 *   → amber "N prices need review" callout (real flag-reason copy)
 *   → collapsed confident set ("248 applied automatically · View all")
 *   → no-change line
 *
 * STATES (P3-B DoD slice; full loading/empty/error/403 matrix lands with P5b
 * wiring): three are demoable here via `?state=`:
 *   - default                → held-at-gate summary, confident set collapsed
 *   - auto-applied-expanded   → confident set pre-expanded into its table
 *   - partial-failure         → failed run + partial-failure banner + Retry
 *
 * Mock-data-first behind the run fixtures; no network. `?state=` selects the
 * fixture so all states are reachable on `/:tenant/runs/:id` without route edits.
 */
export type RunDetailState = 'default' | 'auto-applied-expanded' | 'partial-failure'

const STATES: ReadonlySet<string> = new Set<RunDetailState>([
  'default',
  'auto-applied-expanded',
  'partial-failure',
])

const WORKFLOW_NAME = 'Daily Pricing'

export interface RunDetailProps {
  /** Fallback state when no `?state=` query is present (used in tests / demos). */
  defaultState?: RunDetailState
}

export default function RunDetail({ defaultState = 'default' }: RunDetailProps) {
  const tenant = useTenant()
  const navigate = useNavigate()
  const params = useParams()
  const [search] = useSearchParams()

  const state: RunDetailState = useMemo(() => {
    const q = search.get('state')
    return (q && STATES.has(q) ? q : defaultState) as RunDetailState
  }, [search, defaultState])

  const isFailure = state === 'partial-failure'
  const run = isFailure ? MOCK_RUN_DETAIL_PARTIAL_FAILURE : MOCK_RUN_DETAIL
  const output = getPricingOutput(run)
  const basePath = `/${tenant.id}`

  function goReview() {
    navigate(`${basePath}/approvals`)
  }
  function rerun() {
    // Mock-data-first: a real re-run dispatches a child run in P5b. Here we just
    // route back to the workflow so the affordance is live, not dead.
    navigate(`${basePath}/workflows/${run.workflowId}`)
  }

  // Defensive: a non-pricing run (or missing output) renders an empty fallback
  // rather than crashing — keeps the surface robust as more workflows land.
  if (!output) {
    return (
      <section className="space-y-6">
        <RunDetailHeader
          run={run}
          workflowName={WORKFLOW_NAME}
          heldAtGate={false}
          basePath={basePath}
          onRerun={rerun}
        />
        <EmptyState
          title="No run summary yet"
          description="This run hasn’t produced a summary the dashboard can display."
        />
      </section>
    )
  }

  const heldAtGate = !isFailure && output.needsReviewCount > 0
  const failedItems = output.flagged.filter((f) =>
    PARTIAL_FAILURE_FAILED_ROW_IDS.includes(f.rowId),
  )

  return (
    <section className="space-y-8">
      <RunDetailHeader
        run={run}
        workflowName={WORKFLOW_NAME}
        heldAtGate={heldAtGate}
        basePath={basePath}
        onRerun={rerun}
      />

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
          failedItems={failedItems.length > 0 ? failedItems : output.flagged}
          onRetry={rerun}
        />
      ) : (
        <ReviewCallout
          count={output.needsReviewCount}
          items={output.flagged}
          onReview={goReview}
        />
      )}

      <AutoAppliedCollapse
        count={output.autoAppliedCount}
        items={output.applied}
        defaultExpanded={state === 'auto-applied-expanded'}
      />

      <NoChangeLine count={output.noChangeCount} />
    </section>
  )
}
