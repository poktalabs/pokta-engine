import type { WorkflowManifest, WorkflowModule } from '@godin-engine/contract'

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

const modules: WorkflowModule[] = [
  { manifest: echoManifest, run: echoRun as WorkflowModule['run'] },
  { manifest: echoDraftManifest, run: echoDraftRun as WorkflowModule['run'] },
  { manifest: echoSendManifest, run: echoSendRun as WorkflowModule['run'] },
  { manifest: callIntakeManifest, run: callIntakeRun as WorkflowModule['run'] },
  { manifest: proposalStepManifest, run: proposalStepRun as WorkflowModule['run'] },
  { manifest: sendStepManifest, run: sendStepRun as WorkflowModule['run'] },
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
