import { describe, expect, it } from 'vitest'
import { withConsumerId } from './run-input'

/**
 * Regression for the prod pricing failure "pricing-draft: consumerId is required
 * (resolved from the run record)". The worker MUST inject the run record's
 * consumerId into the workflow input, or pricing-draft/pricing-apply fail closed.
 */
describe('withConsumerId (worker run-input)', () => {
  it('injects consumerId into an object input', () => {
    const out = withConsumerId({ scope: 'all', limit: 10 }, 'mi-pase') as Record<string, unknown>
    expect(out).toEqual({ scope: 'all', limit: 10, consumerId: 'mi-pase' })
  })

  it('makes input.consumerId available for a dispatch body that omitted it (the bug)', () => {
    // The control plane stores ONLY the request body as input (no consumerId); the
    // worker resolves consumerId from the run record's consumer_id column.
    const dispatchedInput = { marginFloorPct: 15 }
    const out = withConsumerId(dispatchedInput, 'mi-pase') as { consumerId?: string }
    expect(out.consumerId).toBe('mi-pase')
  })

  it("the run's tenant ALWAYS wins over a client-supplied input.consumerId (anti-spoof)", () => {
    const malicious = { scope: 'all', consumerId: 'other-tenant' }
    const out = withConsumerId(malicious, 'mi-pase') as { consumerId: string }
    expect(out.consumerId).toBe('mi-pase')
  })

  it('does not mutate the original input', () => {
    const original = { scope: 'all' }
    withConsumerId(original, 'mi-pase')
    expect(original).toEqual({ scope: 'all' })
    expect('consumerId' in original).toBe(false)
  })

  it('passes a non-object input through untouched (no manifest uses one today)', () => {
    expect(withConsumerId('raw', 'mi-pase')).toBe('raw')
    expect(withConsumerId(null, 'mi-pase')).toBe(null)
    expect(withConsumerId([1, 2], 'mi-pase')).toEqual([1, 2])
  })
})
