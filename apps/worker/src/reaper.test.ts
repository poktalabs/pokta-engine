import type { EngineError, RunContext } from '@pokta-engine/contract'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GRACE_MS,
  DEFAULT_TIMEOUT_MS,
  type ReapableRun,
  type ReaperEffects,
  isStranded,
  reapStrandedRuns,
} from './reaper'

const logger: RunContext['logger'] = { info: vi.fn(), error: vi.fn() }

function makeEffects(running: ReapableRun[], timeouts: Record<string, number>): ReaperEffects & {
  failRun: ReturnType<typeof vi.fn>
} {
  return {
    listRunningRuns: vi.fn().mockResolvedValue(running),
    timeoutMsFor: (workflowId: string) => timeouts[workflowId] ?? null,
    failRun: vi.fn().mockResolvedValue(undefined),
  }
}

const NOW = new Date('2026-06-07T12:00:00.000Z')
const TIMEOUT = 20 * 60_000 // 20 min

describe('isStranded', () => {
  it('is true once now is past startedAt + timeout + grace', () => {
    const startedAt = new Date(NOW.getTime() - TIMEOUT - DEFAULT_GRACE_MS - 1)
    expect(isStranded({ runId: 'r', workflowId: 'w', startedAt }, TIMEOUT, NOW)).toBe(true)
  })

  it('is false while still within timeout + grace', () => {
    const startedAt = new Date(NOW.getTime() - TIMEOUT) // past timeout but inside grace
    expect(isStranded({ runId: 'r', workflowId: 'w', startedAt }, TIMEOUT, NOW)).toBe(false)
  })

  it('is false for a run that never actually started (no startedAt)', () => {
    expect(isStranded({ runId: 'r', workflowId: 'w', startedAt: null }, TIMEOUT, NOW)).toBe(false)
  })
})

describe('reapStrandedRuns — the reaper (D8)', () => {
  it('fails a stale running run with a retryable SKILL_TIMEOUT envelope', async () => {
    const startedAt = new Date(NOW.getTime() - TIMEOUT - DEFAULT_GRACE_MS - 1)
    const effects = makeEffects(
      [{ runId: 'stranded-run', workflowId: 'pricing-draft', startedAt }],
      { 'pricing-draft': TIMEOUT },
    )

    const reaped = await reapStrandedRuns(effects, logger, NOW)

    expect(reaped).toBe(1)
    expect(effects.failRun).toHaveBeenCalledTimes(1)
    const [runId, err] = effects.failRun.mock.calls[0] as [string, EngineError]
    expect(runId).toBe('stranded-run')
    expect(err.code).toBe('SKILL_TIMEOUT')
    expect(err.retryable).toBe(true)
    expect(err.toEnvelope()).toMatchObject({ code: 'SKILL_TIMEOUT', retryable: true })
  })

  it('leaves a fresh running run alone (within deadline)', async () => {
    const startedAt = new Date(NOW.getTime() - 1_000) // 1s ago
    const effects = makeEffects(
      [{ runId: 'fresh-run', workflowId: 'pricing-draft', startedAt }],
      { 'pricing-draft': TIMEOUT },
    )

    const reaped = await reapStrandedRuns(effects, logger, NOW)

    expect(reaped).toBe(0)
    expect(effects.failRun).not.toHaveBeenCalled()
  })

  it('only reaps the stranded subset, leaving fresh runs running', async () => {
    const stale = new Date(NOW.getTime() - TIMEOUT - DEFAULT_GRACE_MS - 1)
    const fresh = new Date(NOW.getTime() - 1_000)
    const effects = makeEffects(
      [
        { runId: 'stale', workflowId: 'pricing-draft', startedAt: stale },
        { runId: 'fresh', workflowId: 'pricing-draft', startedAt: fresh },
      ],
      { 'pricing-draft': TIMEOUT },
    )

    const reaped = await reapStrandedRuns(effects, logger, NOW)

    expect(reaped).toBe(1)
    expect(effects.failRun).toHaveBeenCalledTimes(1)
    expect(effects.failRun).toHaveBeenCalledWith('stale', expect.anything())
  })

  it('falls back to DEFAULT_TIMEOUT_MS for an unregistered workflow', async () => {
    // No registered timeout → uses DEFAULT_TIMEOUT_MS. Started just past that + grace.
    const startedAt = new Date(NOW.getTime() - DEFAULT_TIMEOUT_MS - DEFAULT_GRACE_MS - 1)
    const effects = makeEffects(
      [{ runId: 'orphan-wf-run', workflowId: 'removed-workflow', startedAt }],
      {}, // timeoutMsFor returns null
    )

    const reaped = await reapStrandedRuns(effects, logger, NOW)

    expect(reaped).toBe(1)
    expect(effects.failRun).toHaveBeenCalledWith('orphan-wf-run', expect.anything())
  })

  it('does nothing when no runs are running', async () => {
    const effects = makeEffects([], {})
    const reaped = await reapStrandedRuns(effects, logger, NOW)
    expect(reaped).toBe(0)
    expect(effects.failRun).not.toHaveBeenCalled()
  })
})
