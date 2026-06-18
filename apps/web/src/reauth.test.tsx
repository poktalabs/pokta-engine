import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import {
  capturedRequests,
  installMockFetch,
  mockLivePath,
  privyMockSpies,
  setPrivyState,
} from '@/test'
import { ApiError, apiFetch, setAuthTokenGetter, setLogoutHandler } from '@/lib/api'
import { AuthTokenBridge } from '@/providers/AuthTokenBridge'
import { QueryProvider } from '@/providers/QueryProvider'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { ErrorEnvelope } from '@pokta-engine/contract'
import type { ReactNode } from 'react'

/**
 * 401-LOOP ★ (PR2b §6) — the session-expiry re-auth path. A 401 UNAUTHENTICATED
 * triggers EXACTLY ONE silent token refresh + retry; if the retry still 401s the
 * user is logged out (dropped to the login screen) and the error throws — NEVER a
 * loop. The React Query retry predicate must ALSO refuse to retry UNAUTHENTICATED
 * (otherwise it would stack a second refresh/logout cycle). And 401 must be
 * distinguished by `error.code` from the two 403 approval codes AND from the 403
 * `TENANT_UNKNOWN`.
 *
 * Binds to the REAL exported symbols: `apiFetch` + `setAuthTokenGetter` /
 * `setLogoutHandler` (the bridge seams), the real `AuthTokenBridge` (which wires
 * Privy's getAccessToken/logout into those seams), and the real `QueryProvider`
 * (whose retry predicate we extract off its QueryClient default options). The
 * Privy SDK is replaced by the shared controllable mock; live `/v1/tenants/me`
 * responses are driven through the shared path-aware fetch helper.
 */

vi.mock('@privy-io/react-auth', async () => (await import('@/test/privy-mock')).privyMockFactory())

/** Build the REAL wrapped wire error body `{ error: { code, message, retryable } }` for a given code. */
function errBody(code: ErrorEnvelope['code'], message = code): { error: ErrorEnvelope } {
  return { error: { code, message, retryable: false } }
}

beforeEach(() => {
  installMockFetch()
  setPrivyState({ ready: true, authenticated: true, token: 'jwt-initial' })
  // Each apiFetch test registers its own token getter / logout handler so the
  // module-level registry reflects the case under test (setup.ts resets Privy
  // state + the fetch registry between cases, but not these api.ts seams).
  setAuthTokenGetter(null)
  setLogoutHandler(null)
})

describe('401-LOOP ★ — apiFetch single-shot re-auth', () => {
  it('401 → ONE silent refresh + retry → 200 (success), exactly one refresh', async () => {
    // The Privy token getter "refreshes" to a new value on the second read.
    const getter = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('jwt-initial')
      .mockResolvedValueOnce('jwt-refreshed')
    setAuthTokenGetter(getter)
    const logout = vi.fn()
    setLogoutHandler(logout)

    let call = 0
    mockLivePath('GET', '/v1/tenants/me', () => {
      call += 1
      return call === 1
        ? { status: 401, body: errBody('UNAUTHENTICATED') }
        : { status: 200, body: { id: 'mi-pase' } }
    })

    const result = await apiFetch<{ id: string }>('/v1/tenants/me')
    expect(result).toEqual({ id: 'mi-pase' })

    // Exactly two network attempts: the original 401 and the single retry.
    const tenantReqs = capturedRequests.filter((r) => r.path === '/v1/tenants/me')
    expect(tenantReqs).toHaveLength(2)
    // The retry carried the REFRESHED bearer, not the stale one.
    expect(tenantReqs[0]?.headers.authorization).toBe('Bearer jwt-initial')
    expect(tenantReqs[1]?.headers.authorization).toBe('Bearer jwt-refreshed')
    // A successful re-auth must NOT log the user out.
    expect(logout).not.toHaveBeenCalled()
  })

  it('401 → refresh returns the SAME (still-rejected) token → logout once, throws, NO loop', async () => {
    const getter = vi.fn(async () => 'jwt-stale')
    setAuthTokenGetter(getter)
    const logout = vi.fn()
    setLogoutHandler(logout)

    // Every attempt 401s, and Privy keeps handing back the SAME token (not yet
    // refreshed by its own clock). The hardened refresh path backs off, sees the
    // identical token, and does NOT bother re-sending a known-bad bearer — it logs
    // out instead. Bounded; never a loop.
    mockLivePath('GET', '/v1/tenants/me', () => ({
      status: 401,
      body: errBody('UNAUTHENTICATED'),
    }))

    await expect(apiFetch('/v1/tenants/me')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })

    // Bounded network attempts: since the refreshed token is identical to the one
    // that just 401'd, resending it is pointless and skipped — so the request is
    // tried once, never spun into a loop. The hard invariant is "bounded, no loop".
    const tenantReqs = capturedRequests.filter((r) => r.path === '/v1/tenants/me')
    expect(tenantReqs.length).toBeGreaterThanOrEqual(1)
    expect(tenantReqs.length).toBeLessThanOrEqual(2)
    // Logout fired exactly once (drops to the login screen).
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('BARE 401 (non-enveloped body) is classified UNAUTHENTICATED → refresh + retry + logout', async () => {
    // ⚠ HARDEN: an infra/proxy/CDN 401 carries an HTML/empty body, NOT the engine's
    // JSON envelope. parseError must still classify it as UNAUTHENTICATED so the
    // re-auth/logout path runs — pre-fix it became SKILL_EXEC_ERROR and the session
    // silently degraded to a dead error screen, never dropping to login.
    const getter = vi.fn(async () => 'jwt-stale')
    setAuthTokenGetter(getter)
    const logout = vi.fn()
    setLogoutHandler(logout)

    // A bare 401 with a non-envelope body (a plain HTML/string body that fails
    // `errorEnvelopeSchema.safeParse`).
    mockLivePath('GET', '/v1/tenants/me', () => ({
      status: 401,
      body: '<html><body>401 Unauthorized</body></html>',
    }))

    const caught = await apiFetch('/v1/tenants/me').then(
      () => null,
      (e) => e as ApiError,
    )

    // It surfaced as UNAUTHENTICATED (not SKILL_EXEC_ERROR), status 401.
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught?.code).toBe('UNAUTHENTICATED')
    expect(caught?.status).toBe(401)
    // And the re-auth/logout path actually fired (the whole point — the session is
    // dropped to the login screen instead of stranding a stale session).
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('BARE 401 with an EMPTY body is still classified UNAUTHENTICATED', async () => {
    const getter = vi.fn(async () => 'jwt-stale')
    setAuthTokenGetter(getter)
    const logout = vi.fn()
    setLogoutHandler(logout)

    // No body at all (e.g. gateway 401 with empty payload) → res.json() throws →
    // safeParse fails → status-based classification must still pick UNAUTHENTICATED.
    mockLivePath('GET', '/v1/tenants/me', () => ({ status: 401 }))

    const caught = await apiFetch('/v1/tenants/me').then(
      () => null,
      (e) => e as ApiError,
    )
    expect(caught?.code).toBe('UNAUTHENTICATED')
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('401 → transient getter THROW on refresh does NOT short-circuit to logout; a later fresh token recovers', async () => {
    // ⚠ HARDEN: a transient Privy getter error mid-refresh must NOT collapse to an
    // immediate null → logout. The backoff path retries; once Privy yields a fresh
    // (different) token, the request recovers — no spurious session drop.
    const getter = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('jwt-initial') // initial request bearer
      .mockRejectedValueOnce(new Error('transient privy/jwks hiccup')) // 1st refresh attempt throws
      .mockResolvedValueOnce('jwt-refreshed') // 2nd refresh attempt → fresh token
    setAuthTokenGetter(getter)
    const logout = vi.fn()
    setLogoutHandler(logout)

    let call = 0
    mockLivePath('GET', '/v1/tenants/me', () => {
      call += 1
      return call === 1
        ? { status: 401, body: errBody('UNAUTHENTICATED') }
        : { status: 200, body: { id: 'mi-pase' } }
    })

    const result = await apiFetch<{ id: string }>('/v1/tenants/me')
    expect(result).toEqual({ id: 'mi-pase' })
    // Recovered without ejecting the session despite the transient throw.
    expect(logout).not.toHaveBeenCalled()
    const tenantReqs = capturedRequests.filter((r) => r.path === '/v1/tenants/me')
    expect(tenantReqs[0]?.headers.authorization).toBe('Bearer jwt-initial')
    expect(tenantReqs[1]?.headers.authorization).toBe('Bearer jwt-refreshed')
  })

  it('401 with no fresh token available → logout immediately, single attempt + nothing more', async () => {
    // Getter resolves null (e.g. session fully gone) — there is no token to retry
    // with, so apiFetch must log out without a pointless second network attempt.
    const getter = vi.fn(async () => null)
    setAuthTokenGetter(getter)
    const logout = vi.fn()
    setLogoutHandler(logout)

    mockLivePath('GET', '/v1/tenants/me', () => ({
      status: 401,
      body: errBody('UNAUTHENTICATED'),
    }))

    await expect(apiFetch('/v1/tenants/me')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    })

    const tenantReqs = capturedRequests.filter((r) => r.path === '/v1/tenants/me')
    // One original attempt; the refresh yielded null so no retry, just logout.
    expect(tenantReqs).toHaveLength(1)
    expect(logout).toHaveBeenCalledTimes(1)
  })
})

describe('401-LOOP ★ — error.code distinguishes 401 from the 403 family', () => {
  // The three 403 codes must NOT trigger re-auth (no token refresh, no logout):
  // only UNAUTHENTICATED(401) does. apiFetch throws them straight through so the
  // caller (QueryProvider / TenantProvider) can branch on `error.code`.
  it.each(['APPROVAL_REQUIRED', 'APPROVAL_DENIED', 'TENANT_UNKNOWN'] as const)(
    '403 %s → no refresh, no logout, thrown with its own code (not UNAUTHENTICATED)',
    async (code) => {
      const getter = vi.fn(async () => 'jwt-initial')
      setAuthTokenGetter(getter)
      const logout = vi.fn()
      setLogoutHandler(logout)

      mockLivePath('GET', '/v1/tenants/me', () => ({ status: 403, body: errBody(code) }))

      const caught = await apiFetch('/v1/tenants/me').then(
        () => null,
        (e) => e as ApiError,
      )

      expect(caught).toBeInstanceOf(ApiError)
      expect(caught?.code).toBe(code)
      expect(caught?.code).not.toBe('UNAUTHENTICATED')
      expect(caught?.status).toBe(403)
      // No re-auth machinery fires for a 403: exactly one attempt, never logout.
      const tenantReqs = capturedRequests.filter((r) => r.path === '/v1/tenants/me')
      expect(tenantReqs).toHaveLength(1)
      expect(logout).not.toHaveBeenCalled()
      // The getter is called once (to set the initial bearer), never a second
      // time as a "refresh" — the 403 path does not refresh.
      expect(getter).toHaveBeenCalledTimes(1)
    },
  )
})

/**
 * Extract the REAL retry predicate off the production QueryProvider's QueryClient.
 * A render-prop child grabs the client via `useQueryClient`; we then read the
 * `defaultOptions.queries.retry` function the provider installed (W5).
 */
function getProviderRetryPredicate(): (failureCount: number, error: unknown) => boolean {
  let captured: QueryClient | null = null
  function Capture(): null {
    captured = useQueryClient()
    return null
  }
  const { unmount } = render(
    <QueryProvider>
      <Capture />
    </QueryProvider>,
  )
  const retry = captured!.getDefaultOptions().queries?.retry
  unmount()
  if (typeof retry !== 'function') {
    throw new Error('QueryProvider did not install a function retry predicate')
  }
  return retry as (failureCount: number, error: unknown) => boolean
}

function makeApiError(code: ErrorEnvelope['code'], status: number, retryable = false): ApiError {
  return new ApiError({ code, message: code, retryable }, status)
}

describe('401-LOOP ★ — React Query retry predicate excludes UNAUTHENTICATED', () => {
  it('NEVER retries an UNAUTHENTICATED ApiError (would stack a second refresh/logout)', () => {
    const retry = getProviderRetryPredicate()
    // failureCount 0 — the first failure. A retryable transient would normally
    // get one retry; UNAUTHENTICATED must be refused outright.
    expect(retry(0, makeApiError('UNAUTHENTICATED', 401))).toBe(false)
    expect(retry(0, makeApiError('UNAUTHENTICATED', 401, true))).toBe(false)
  })

  it('does NOT retry the 403 family either (terminal control-plane codes)', () => {
    const retry = getProviderRetryPredicate()
    for (const code of ['APPROVAL_REQUIRED', 'APPROVAL_DENIED', 'TENANT_UNKNOWN'] as const) {
      expect(retry(0, makeApiError(code, 403))).toBe(false)
    }
  })

  it('still allows ONE retry for a genuinely retryable (non-401) failure', () => {
    const retry = getProviderRetryPredicate()
    const transient = makeApiError('SKILL_EXEC_ERROR', 500, true)
    expect(retry(0, transient)).toBe(true) // first failure → retry
    expect(retry(1, transient)).toBe(false) // already retried once → stop
  })
})

/**
 * End-to-end via React Query + the real bridge: a query whose endpoint always
 * 401s must surface the error WITHOUT the query layer spinning extra attempts
 * (predicate refuses UNAUTHENTICATED) and WITHOUT re-firing the apiFetch re-auth
 * beyond its single shot. We mount the real `AuthTokenBridge` so logout is wired
 * to the Privy mock's `logout` spy.
 */
describe('401-LOOP ★ — query layer does not loop on a persistent 401', () => {
  function QueryHarness({ children }: { children: ReactNode }) {
    return (
      <QueryProvider>
        <AuthTokenBridge />
        {children}
      </QueryProvider>
    )
  }

  function TenantMeProbe() {
    const q = useQuery<unknown, ApiError>({
      queryKey: ['probe', 'tenant-me'],
      queryFn: () => apiFetch('/v1/tenants/me'),
      // No per-query `retry` → inherits the provider default (the real W5 predicate).
    })
    return <div data-testid="status">{q.isError ? `error:${q.error?.code}` : q.status}</div>
  }

  it('persistent 401 → bounded attempts, logout via Privy, settles on error (no loop)', async () => {
    // Privy token never changes; the endpoint never accepts it.
    setPrivyState({ token: 'jwt-doomed' })
    mockLivePath('GET', '/v1/tenants/me', () => ({
      status: 401,
      body: errBody('UNAUTHENTICATED'),
    }))

    const { getByTestId } = render(
      <QueryHarness>
        <TenantMeProbe />
      </QueryHarness>,
    )

    // Timeout allows for the documented token-refresh backoff window (the hardened
    // refresh path retries getAccessToken with a short time-based backoff per Privy
    // guidance before declaring the session unrecoverable and logging out).
    await waitFor(
      () => {
        expect(getByTestId('status')).toHaveTextContent('error:UNAUTHENTICATED')
      },
      { timeout: 3000 },
    )

    // apiFetch did its single-shot re-auth (original + one retry) and stopped;
    // the predicate refused to retry the query, so the network attempt count is
    // bounded (well under any "loop" threshold).
    const tenantReqs = capturedRequests.filter((r) => r.path === '/v1/tenants/me')
    expect(tenantReqs.length).toBeGreaterThanOrEqual(1)
    expect(tenantReqs.length).toBeLessThanOrEqual(3)
    // Logout was invoked through the real bridge → Privy mock logout spy.
    expect(privyMockSpies.logout).toHaveBeenCalled()
  })
})
