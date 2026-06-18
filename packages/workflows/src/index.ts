import type { WorkflowManifest, WorkflowModule } from '@pokta-engine/contract'

// The workflows package is the ONLY place that references workflows by name.
// engine-api and worker import the aggregate registry below — never an individual
// workflow — so the rule "engine code never imports a workflow by name" holds.
import echoManifest from './echo/manifest'
import { run as echoRun } from './echo'
import echoDraftManifest from './echo-draft/manifest'
import { run as echoDraftRun } from './echo-draft'
import echoSendManifest from './echo-send/manifest'
import { run as echoSendRun } from './echo-send'

// Vino pipeline (call → CRM → proposal → email), the demo's real workflows.
import callIntakeManifest from './call-intake/manifest'
import { run as callIntakeRun } from './call-intake'
import proposalStepManifest from './proposal-step/manifest'
import { run as proposalStepRun } from './proposal-step'
import sendStepManifest from './send-step/manifest'
import { run as sendStepRun } from './send-step'

// Mi Pase daily-pricing chain (M1). The draft fans out on success into TWO
// independent children (plan D1 + gate semantics):
//   - pricing-apply-confident  ← draft.onComplete  (auto, NO gate)
//   - pricing-apply-flagged    ← draft.onApprove   (human-gated)
// Both children share one run() impl, registered under two ids so the subset
// selection (confident[] vs flagged[]) is bound by id. Neither child is a public
// POST: flagged is an approval target, confident is an onComplete target —
// gatedTargets() (below) blocks a direct POST to both.
import pricingDraftManifest from '../pricing/pricing-draft/manifest'
import { run as pricingDraftRun } from '../pricing/pricing-draft'
import {
  pricingApplyConfidentManifest,
  pricingApplyFlaggedManifest,
} from '../pricing/pricing-apply/manifest'
import { runConfident as pricingApplyConfidentRun, runFlagged as pricingApplyFlaggedRun } from '../pricing/pricing-apply'

const modules: WorkflowModule[] = [
  { manifest: echoManifest, run: echoRun as WorkflowModule['run'] },
  { manifest: echoDraftManifest, run: echoDraftRun as WorkflowModule['run'] },
  { manifest: echoSendManifest, run: echoSendRun as WorkflowModule['run'] },
  { manifest: callIntakeManifest, run: callIntakeRun as WorkflowModule['run'] },
  { manifest: proposalStepManifest, run: proposalStepRun as WorkflowModule['run'] },
  { manifest: sendStepManifest, run: sendStepRun as WorkflowModule['run'] },
  { manifest: pricingDraftManifest, run: pricingDraftRun as WorkflowModule['run'] },
  { manifest: pricingApplyConfidentManifest, run: pricingApplyConfidentRun as WorkflowModule['run'] },
  { manifest: pricingApplyFlaggedManifest, run: pricingApplyFlaggedRun as WorkflowModule['run'] },
]

export const registry: ReadonlyMap<string, WorkflowModule> = new Map(
  modules.map((m) => [m.manifest.id, m]),
)

export function getWorkflow(id: string): WorkflowModule | undefined {
  return registry.get(id)
}

export function listManifests(): WorkflowManifest[] {
  return [...registry.values()].map((m) => m.manifest)
}

/**
 * Workflows reachable ONLY via an approved gate (every `onApprove` target).
 * The control plane refuses a direct POST to these (APPROVAL_REQUIRED).
 */
export function approvalTargets(): Set<string> {
  const targets = new Set<string>()
  for (const m of listManifests()) {
    for (const p of m.policy) {
      if (p.kind === 'approval') targets.add(p.onApprove)
    }
  }
  return targets
}

/**
 * Every workflow id that is only reachable as a CHILD — never via a public
 * `POST /v1/workflows/:id/runs`. This is the union of:
 *   - approval targets (`onApprove`) — opened by the control plane on a gate
 *     approval (e.g. `pricing-apply-flagged`), and
 *   - onComplete targets (`onComplete`) — auto-dispatched by the worker on a
 *     parent's success (e.g. `pricing-apply-confident`).
 * The control plane refuses a direct POST to any of these. `approvalTargets()`
 * stays narrower (approval-only) for callers that specifically mean "gated".
 */
export function gatedTargets(): Set<string> {
  const targets = approvalTargets()
  for (const m of listManifests()) {
    if (m.onComplete) targets.add(m.onComplete)
  }
  return targets
}
