import { describe, expect, it, vi } from 'vitest'
import type { RunContext } from '@godin-engine/contract'

// Mock the resend module (the integration seam). send-step must be fail-soft:
// ok path -> sendResult.status='ok'; throw path -> status='failed', run resolves.
const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }))
vi.mock('@godin-engine/resend', () => ({ sendEmail }))

import { run } from './index'

function makeCtx(): RunContext {
  return {
    runId: 'run_1',
    traceId: 'trace_1',
    logger: { info: vi.fn(), error: vi.fn() },
    artifactDir: '/tmp/run_1',
    // send-step uses the @godin-engine/resend module directly, not ctx.integration;
    // a throwing stub satisfies the RunContext shape (D2) without being exercised.
    integration: (name: string) => {
      throw new Error(`integration('${name}') not stubbed in this test`)
    },
  }
}

const email = { to: 'client@example.com', subject: 'Your proposal', body: 'Hi there' }

describe('send-step', () => {
  // Each test sets its own implementation (fully overwriting the prior one); we
  // avoid mockReset() in beforeEach because vitest 2.1 surfaces a throwing impl
  // installed right after a reset as an uncaught error.
  it('ok path: records sendResult.status="ok" with the messageId', async () => {
    sendEmail.mockReset()
    sendEmail.mockResolvedValue({ messageId: 'msg_ok_1' })
    const out = await run({ email }, makeCtx())
    expect(sendEmail).toHaveBeenCalledWith({ to: email.to, subject: email.subject, body: email.body })
    expect(out.sent).toBe(true)
    expect(out.sendResult.provider).toBe('resend')
    expect(out.sendResult.status).toBe('ok')
    expect(out.sendResult.ref).toBe('msg_ok_1')
    expect(out.sendResult.error).toBeUndefined()
    expect(typeof out.sendResult.at).toBe('string')
  })

  it('throw path: fail-soft — resolves with status="failed" and the error, never throws', async () => {
    sendEmail.mockImplementation(async () => {
      throw new Error('domain not verified')
    })
    const out = await run({ email }, makeCtx())
    expect(out.sent).toBe(false)
    expect(out.sendResult.provider).toBe('resend')
    expect(out.sendResult.status).toBe('failed')
    expect(out.sendResult.error).toMatch(/domain not verified/)
    expect(out.sendResult.ref).toBeUndefined()
    expect(typeof out.sendResult.at).toBe('string')
  })
})
