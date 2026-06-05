import { describe, expect, it } from 'vitest'
import { sendEmail, resendInfo } from './index'

// Phase 0 seed (D6). Lane B (TASK-002) expands this: mock the resend SDK,
// assert success returns {messageId} and API error throws.
describe('resend stub', () => {
  it('exposes config info without throwing', () => {
    expect(typeof resendInfo().configured).toBe('boolean')
  })

  it('sendEmail rejects until implemented (throws, never returns a failure shape)', async () => {
    await expect(sendEmail({ to: 'x@example.com', subject: 's', body: 'b' })).rejects.toThrow()
  })
})
