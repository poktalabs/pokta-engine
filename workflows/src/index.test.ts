import { describe, expect, it } from 'vitest'
import {
  approvalTargets,
  gatedTargets,
  getWorkflow,
  listManifests,
  registry,
} from './index'

/**
 * T9 — wiring of the Mi Pase pricing chain into the workflow registry.
 *
 * Asserts the registry/gate logic that the control plane + worker depend on:
 *   - all three pricing ids are registered (draft + the two apply children)
 *   - the draft declares onComplete → confident and onApprove → flagged
 *   - approvalTargets() = approval-only (just the flagged child)
 *   - gatedTargets()    = approval ∪ onComplete (BOTH children: neither is a
 *     public POST — confident via onComplete, flagged via the gate)
 */
describe('pricing chain registration (T9)', () => {
  it('registers pricing-draft + both apply children', () => {
    for (const id of ['pricing-draft', 'pricing-apply-confident', 'pricing-apply-flagged']) {
      const wf = getWorkflow(id)
      expect(wf, `${id} should be registered`).toBeDefined()
      expect(wf!.manifest.id).toBe(id)
      expect(typeof wf!.run).toBe('function')
    }
  })

  it('the registry id matches each manifest id (no mis-key)', () => {
    for (const [id, mod] of registry) {
      expect(mod.manifest.id).toBe(id)
    }
  })

  it('pricing-draft fans out: onComplete → confident, onApprove → flagged', () => {
    const draft = getWorkflow('pricing-draft')!.manifest
    expect(draft.onComplete).toBe('pricing-apply-confident')
    const approval = draft.policy.find((p) => p.kind === 'approval')
    expect(approval).toBeDefined()
    expect(approval && approval.kind === 'approval' && approval.onApprove).toBe(
      'pricing-apply-flagged',
    )
  })

  it('the two apply children share a manifest version + carry no further chaining', () => {
    const confident = getWorkflow('pricing-apply-confident')!.manifest
    const flagged = getWorkflow('pricing-apply-flagged')!.manifest
    // Neither apply child chains onward (terminal in the M1 chain).
    expect(confident.onComplete).toBeUndefined()
    expect(flagged.onComplete).toBeUndefined()
    expect(confident.policy).toEqual([])
    expect(flagged.policy).toEqual([])
  })
})

describe('gate-only reachability (T9)', () => {
  it('approvalTargets() is approval-only — contains flagged, NOT confident', () => {
    const targets = approvalTargets()
    expect(targets.has('pricing-apply-flagged')).toBe(true)
    expect(targets.has('pricing-apply-confident')).toBe(false)
  })

  it('gatedTargets() blocks BOTH apply children from a direct POST', () => {
    const targets = gatedTargets()
    // flagged: reachable only via the approval gate
    expect(targets.has('pricing-apply-flagged')).toBe(true)
    // confident: reachable only via the draft's onComplete (not a public POST)
    expect(targets.has('pricing-apply-confident')).toBe(true)
    // the draft itself IS a public POST entrypoint — never gated
    expect(targets.has('pricing-draft')).toBe(false)
  })

  it('gatedTargets() is a strict superset of approvalTargets()', () => {
    const approval = approvalTargets()
    const gated = gatedTargets()
    for (const t of approval) expect(gated.has(t)).toBe(true)
    expect(gated.size).toBeGreaterThan(approval.size)
  })

  it('every gated target resolves to a registered workflow', () => {
    const ids = new Set(listManifests().map((m) => m.id))
    for (const t of gatedTargets()) expect(ids.has(t)).toBe(true)
  })
})
