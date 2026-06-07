import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Resend SDK. `send` is the single seam: success returns {data:{id}},
// API error returns {error}. We assert sendEmail maps these to {messageId}/throw.
const send = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send } })),
}))

describe('resend client', () => {
  beforeEach(() => {
    vi.resetModules()
    send.mockReset()
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.RESEND_FROM = 'Vino <hello@vino.example>'
    delete process.env.RESEND_TO
  })

  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM
    delete process.env.RESEND_TO
  })

  it('exposes config info without throwing', async () => {
    const { resendInfo } = await import('./index')
    expect(typeof resendInfo().configured).toBe('boolean')
    expect(resendInfo().configured).toBe(true)
  })

  it('throws when unconfigured (no api key / from)', async () => {
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM
    const { sendEmail } = await import('./index')
    await expect(sendEmail({ to: 'x@example.com', subject: 's', body: 'b' })).rejects.toThrow(/not configured/i)
    expect(send).not.toHaveBeenCalled()
  })

  it('success returns {messageId} and forwards from/to/subject/body', async () => {
    send.mockResolvedValue({ data: { id: 'msg_123' }, error: null })
    const { sendEmail } = await import('./index')
    const res = await sendEmail({ to: 'client@example.com', subject: 'Proposal', body: 'Hello' })
    expect(res).toEqual({ messageId: 'msg_123' })
    expect(send).toHaveBeenCalledWith({
      from: 'Vino <hello@vino.example>',
      to: 'client@example.com',
      subject: 'Proposal',
      text: 'Hello',
    })
  })

  it('RESEND_TO overrides the recipient (demo safety)', async () => {
    process.env.RESEND_TO = 'demo@vino.example'
    send.mockResolvedValue({ data: { id: 'msg_456' }, error: null })
    const { sendEmail } = await import('./index')
    await sendEmail({ to: 'real-client@example.com', subject: 's', body: 'b' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'demo@vino.example' }))
  })

  it('API error throws (never returns a failure shape)', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'domain not verified', name: 'validation_error' } })
    const { sendEmail } = await import('./index')
    await expect(sendEmail({ to: 'x@example.com', subject: 's', body: 'b' })).rejects.toThrow(/domain not verified/)
  })

  it('throws when the provider returns no message id', async () => {
    send.mockResolvedValue({ data: null, error: null })
    const { sendEmail } = await import('./index')
    await expect(sendEmail({ to: 'x@example.com', subject: 's', body: 'b' })).rejects.toThrow(/no message id/i)
  })
})
