import { z } from 'zod'

/**
 * Port of pyme-engine's five-code error envelope, extended with the governance
 * codes (D-7). The job layer only ever raises SKILL_* codes; QUOTA_EXCEEDED and
 * APPROVAL_* are control-plane decisions and never come from `run()`.
 */
export const ERROR_CODES = [
  'SKILL_NOT_FOUND',
  'ARGS_INVALID',
  'SKILL_EXEC_ERROR',
  'SKILL_TIMEOUT',
  'QUOTA_EXCEEDED',
  'APPROVAL_REQUIRED',
  'APPROVAL_DENIED',
] as const

export const errorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof errorCodeSchema>

export const errorEnvelopeSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
})
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

/** Default HTTP status per error code, for the control-plane routes. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  SKILL_NOT_FOUND: 404,
  ARGS_INVALID: 400,
  SKILL_EXEC_ERROR: 500,
  SKILL_TIMEOUT: 504,
  QUOTA_EXCEEDED: 429,
  APPROVAL_REQUIRED: 403,
  APPROVAL_DENIED: 403,
}

export class EngineError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.retryable = retryable
  }

  toEnvelope(): ErrorEnvelope {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }

  get httpStatus(): number {
    return ERROR_HTTP_STATUS[this.code]
  }
}
