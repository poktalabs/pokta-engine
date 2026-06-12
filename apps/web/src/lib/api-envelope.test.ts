import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, apiFetch } from '@/lib/api'
import { installMockFetch, mockLivePath } from '@/test/mock-fetch'

/**
 * Wire-contract regression for the prod invites bug. The engine wraps EVERY error
 * as `{ error: { code, message, retryable } }` (engine-api `fail()`), but `parseError`
 * used to validate the RAW body against the UNWRAPPED envelope schema — so the real
 * wrapped body failed the schema and fell through to status-based synthesis, turning
 * every 403 into `SKILL_EXEC_ERROR`. That made `/v1/tenants/me` → 403 TENANT_UNKNOWN
 * classify as `SKILL_EXEC_ERROR`, so TenantProvider saw `isTenantUnknown === false`,
 * showed the generic error state, and the auto-provision claim NEVER fired (a real
 * preloaded user got "Could not load your workspace" and a dead "Try again").
 *
 * The SPA tests passed because their fixtures used the UNWRAPPED shape — they never
 * exercised the real wire format. These tests use the REAL wrapped shape so the bug
 * can't come back. `/v1/tenants/me` is a LIVE_PATH, so apiFetch hits the (stubbed)
 * network and runs the real parseError.
 */

/** The REAL engine wire shape for an error response. */
const wrapped = (code: string, message = 'x', retryable = false) => ({
  error: { code, message, retryable },
})

/** Call a live path expected to reject, returning the typed ApiError. */
async function caughtApiError(path: string): Promise<ApiError> {
  try {
    await apiFetch(path)
    throw new Error(`expected apiFetch(${path}) to reject, but it resolved`)
  } catch (e) {
    if (e instanceof ApiError) return e
    throw e
  }
}

describe('apiFetch error-envelope parsing — real engine { error } wrapper', () => {
  beforeEach(() => installMockFetch())

  it('classifies a wrapped 403 TENANT_UNKNOWN by its REAL code (was SKILL_EXEC_ERROR — the invites bug)', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 403,
      body: wrapped('TENANT_UNKNOWN', 'principal maps to no active tenant'),
    })
    const err = await caughtApiError('/v1/tenants/me')
    expect(err.code).toBe('TENANT_UNKNOWN')
    expect(err.status).toBe(403)
  })

  it('classifies a wrapped 409 APPROVAL_DENIED by its real code (was also mis-synthesized)', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 409, body: wrapped('APPROVAL_DENIED', 'already approved') })
    const err = await caughtApiError('/v1/tenants/me')
    expect(err.code).toBe('APPROVAL_DENIED')
    expect(err.status).toBe(409)
  })

  it('still parses a legacy UNWRAPPED envelope (defensive fallback — no regression)', async () => {
    mockLivePath('GET', '/v1/tenants/me', {
      status: 403,
      body: { code: 'TENANT_UNKNOWN', message: 'x', retryable: false },
    })
    const err = await caughtApiError('/v1/tenants/me')
    expect(err.code).toBe('TENANT_UNKNOWN')
  })

  it('still synthesizes by status for a NON-enveloped infra response (empty/HTML 404 → SKILL_NOT_FOUND)', async () => {
    mockLivePath('GET', '/v1/tenants/me', { status: 404, body: undefined })
    const err = await caughtApiError('/v1/tenants/me')
    expect(err.code).toBe('SKILL_NOT_FOUND')
  })
})
