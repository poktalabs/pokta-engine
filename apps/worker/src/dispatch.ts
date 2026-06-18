import type { RunContext, WorkflowManifest } from '@pokta-engine/contract'

/**
 * The source run that just succeeded, as seen by the dispatch step. Narrowed to
 * the fields the post-success fan-out needs so it stays unit-testable without a DB.
 */
export interface SucceededRun {
  runId: string
  consumerId: string
}

/** Side-effect seams the dispatch step drives. Injected so the logic stays pure. */
export interface DispatchEffects {
  /** Queue a NEW child run (status=queued) and enqueue it. Returns its id. */
  dispatchChildRun: (args: {
    workflowId: string
    consumerId: string
    input: unknown
    parentRunId: string
  }) => Promise<string>
  /** Open the first-class approval gate (engine_approvals row). */
  openApprovalGate: (args: {
    sourceRunId: string
    workflowId: string
    artifact: unknown
    approver: string
  }) => Promise<void>
}

/**
 * Post-SUCCESS fan-out (D1). Two INDEPENDENT effects, both keyed off the run's
 * output:
 *   - `onComplete`  → auto-dispatch a child run, NO gate (symmetric to onApprove,
 *     but ungated). input = this run's output.
 *   - approval policy → open an approval gate (the existing gated child).
 * A manifest may declare BOTH; both fire. Pure given its injected `effects`.
 */
export async function dispatchOnSuccess(
  run: SucceededRun,
  manifest: WorkflowManifest,
  output: unknown,
  effects: DispatchEffects,
  logger: RunContext['logger'],
): Promise<void> {
  // onComplete: ungated auto child. Output flows straight in as the child's input.
  if (manifest.onComplete) {
    const childRunId = await effects.dispatchChildRun({
      workflowId: manifest.onComplete,
      consumerId: run.consumerId,
      input: output,
      parentRunId: run.runId,
    })
    logger.info(`onComplete auto-dispatched → ${manifest.onComplete} (run ${childRunId}, no gate)`)
  }

  // approval policy: open the first-class gate (D-8). Independent of onComplete.
  const approval = manifest.policy.find((p) => p.kind === 'approval')
  if (approval && approval.kind === 'approval') {
    await effects.openApprovalGate({
      sourceRunId: run.runId,
      workflowId: approval.onApprove,
      artifact: output,
      approver: approval.approver,
    })
    logger.info(`approval gate opened → ${approval.onApprove} (approver ${approval.approver})`)
  }
}
