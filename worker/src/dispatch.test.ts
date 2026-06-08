import type { RunContext, WorkflowManifest } from '@godin-engine/contract'
import { describe, expect, it, vi } from 'vitest'
import { type DispatchEffects, dispatchOnSuccess } from './dispatch'

const logger: RunContext['logger'] = { info: vi.fn(), error: vi.fn() }

function makeEffects(): DispatchEffects & {
  dispatchChildRun: ReturnType<typeof vi.fn>
  openApprovalGate: ReturnType<typeof vi.fn>
} {
  return {
    dispatchChildRun: vi.fn().mockResolvedValue('child-run-1'),
    openApprovalGate: vi.fn().mockResolvedValue(undefined),
  }
}

// `dispatchOnSuccess` never reads `manifest.input`, so a structural stub is fine
// here — avoids a zod dependency the worker package doesn't declare.
const baseManifest: WorkflowManifest = {
  id: 'pricing-draft',
  version: '0.1.0',
  runtime: 'agent',
  timeoutMs: 1_000,
  policy: [],
  input: { _kind: 'stub-zod-schema' } as unknown as WorkflowManifest['input'],
}

const sourceRun = { runId: 'parent-run-1', consumerId: 'mi-pase' }

describe('dispatchOnSuccess — onComplete (D1)', () => {
  it('auto-dispatches the onComplete child with the output as input and NO approval gate', async () => {
    const effects = makeEffects()
    const manifest: WorkflowManifest = { ...baseManifest, onComplete: 'pricing-apply-confident' }
    const output = { summary: { confident: 3, flagged: 1 }, artifactRef: 'artifact://run/parent-run-1' }

    await dispatchOnSuccess(sourceRun, manifest, output, effects, logger)

    // child dispatched with output as input, parented to the source run, no gate
    expect(effects.dispatchChildRun).toHaveBeenCalledTimes(1)
    expect(effects.dispatchChildRun).toHaveBeenCalledWith({
      workflowId: 'pricing-apply-confident',
      consumerId: 'mi-pase',
      input: output,
      parentRunId: 'parent-run-1',
    })
    // proves NO engine_approvals row is created for an onComplete-only workflow
    expect(effects.openApprovalGate).not.toHaveBeenCalled()
  })

  it('does nothing when neither onComplete nor an approval policy is set', async () => {
    const effects = makeEffects()
    await dispatchOnSuccess(sourceRun, baseManifest, { ok: true }, effects, logger)
    expect(effects.dispatchChildRun).not.toHaveBeenCalled()
    expect(effects.openApprovalGate).not.toHaveBeenCalled()
  })

  it('still opens the approval gate for an approval-policy workflow (existing behavior intact)', async () => {
    const effects = makeEffects()
    const manifest: WorkflowManifest = {
      ...baseManifest,
      policy: [{ kind: 'approval', approver: 'role:reviewer', onApprove: 'echo-send' }],
    }
    const output = { draft: 'hi' }

    await dispatchOnSuccess(sourceRun, manifest, output, effects, logger)

    expect(effects.openApprovalGate).toHaveBeenCalledTimes(1)
    expect(effects.openApprovalGate).toHaveBeenCalledWith({
      sourceRunId: 'parent-run-1',
      workflowId: 'echo-send',
      artifact: output,
      approver: 'role:reviewer',
    })
    // no ungated child for a gate-only workflow
    expect(effects.dispatchChildRun).not.toHaveBeenCalled()
  })

  it('fires BOTH the ungated onComplete child AND the gated approval, independently', async () => {
    const effects = makeEffects()
    const manifest: WorkflowManifest = {
      ...baseManifest,
      onComplete: 'pricing-apply-confident',
      policy: [{ kind: 'approval', approver: 'role:reviewer', onApprove: 'pricing-apply-flagged' }],
    }
    const output = { summary: {}, artifactRef: 'a' }

    await dispatchOnSuccess(sourceRun, manifest, output, effects, logger)

    expect(effects.dispatchChildRun).toHaveBeenCalledTimes(1)
    expect(effects.dispatchChildRun).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'pricing-apply-confident', input: output }),
    )
    expect(effects.openApprovalGate).toHaveBeenCalledTimes(1)
    expect(effects.openApprovalGate).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'pricing-apply-flagged', artifact: output }),
    )
  })
})
