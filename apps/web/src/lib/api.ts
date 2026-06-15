import {
  type ErrorCode,
  type ErrorEnvelope,
  errorEnvelopeSchema,
} from '@godin-engine/contract'
import { resolveMock } from '@/mocks/registry'
// Side-effect import: registers every per-surface fixture (approvals, …) with
// the registry. Tree-shaken out of the network build because the bundler drops
// the unused export binding; the import is kept for its registration side effect.
import '@/mocks'

/**
 * The single client-side fetch seam for `/v1`. Mock-data-first: when
 * `VITE_USE_MOCKS` is on, requests are served from the in-process mock registry
 * and never touch the network. Otherwise they hit the engine-api `/v1` surface.
 *
 * Auth model (locked, M2 P0-C / docs/.../auth-model.md): the browser carries a
 * **Privy JWT ONLY**. It NEVER attaches `X-Service-Key` (a machine secret that
 * must stay server-side). The Privy access-token is bridged in via a module-level
 * getter registry (W3): a component under `<PrivyProvider>` calls
 * `setAuthTokenGetter(privy.getAccessToken)` on mount; `apiFetch` then resolves
 * the token through `getAuthToken()` per request. Until a getter is registered
 * (or for a logged-out caller), `getAuthToken()` resolves `null` → no Bearer
 * header. We deliberately have NO `X-Service-Key` path here.
 */

export interface ApiFetchOptions extends Omit<RequestInit, 'signal'> {
  /** Total request timeout in ms (per attempt). Default 30s. */
  timeoutMs?: number
  /** Max retry attempts for retryable (network/timeout) failures. Default 3. */
  retries?: number
  /** Base backoff in ms; grows exponentially per attempt. Default 300ms. */
  backoffMs?: number
}

/** A typed client error carrying the engine's `ErrorEnvelope` + HTTP status. */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly retryable: boolean
  readonly envelope: ErrorEnvelope

  constructor(envelope: ErrorEnvelope, status: number) {
    super(envelope.message)
    this.name = 'ApiError'
    this.code = envelope.code
    this.status = status
    this.retryable = envelope.retryable
    this.envelope = envelope
  }
}

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

/**
 * LIVE PATHS (W3 + P5b Wave 2) — the surfaces that ALWAYS hit the network, even
 * when `VITE_USE_MOCKS==='true'`. PR2b wired ONLY `/v1/tenants/me` live; P5b Wave 2
 * wires the workspace READ MODELS onto the merged Wave-1 backend, so each surface
 * the SPA now reads from the real `/v1` endpoints is added here. Match is on the
 * pathname (query stripped). A surface NOT in this matcher is served from the
 * in-process mock registry (`resolveMock`); a surface IN it bypasses the registry
 * and goes to `fetch`. So this matcher is what makes the wired pages hit the real
 * backend (and what makes their jsdom live-path tests, which stub `global.fetch`,
 * exercise the real path instead of the registry).
 *
 * REPORTS is deliberately ABSENT — Reports is a deferred surface (ComingSoon /
 * EmptyState) with NO network call, so it must neither be live NOR hit the mock
 * registry; it simply renders an honest empty state.
 *
 * Exact paths (whole-pathname equality):
 *   - /v1/tenants/me          — tenant identity (W3, unchanged).
 *   - /v1/tenants/claim       — transparent auto-provision claim (tenant-invites Wave 2).
 *   - /v1/workspace/workflows — the workspace workflow CARDS read model.
 *   - /v1/integrations        — this tenant's integration CONNECTION status rows.
 *   - /v1/runs                — the tenant run list (parent of the run detail).
 *   - /v1/approvals           — the tenant approvals worklist.
 *
 * Pattern paths (parameterized — a static Set cannot match `/v1/runs/:id`):
 *   - ^/v1/workflows/[^/]+/runs$            — a workflow family's runs.
 *   - ^/v1/runs/[^/]+$                      — a single run detail.
 *   - ^/v1/approvals/[^/]+/(approve|reject)$ — the approve/reject mutations.
 */
const LIVE_PATHS: ReadonlySet<string> = new Set([
  '/v1/tenants/me',
  '/v1/tenants/claim',
  '/v1/workspace/workflows',
  '/v1/integrations',
  '/v1/runs',
  '/v1/approvals',
  // admin-roles Wave B — the superadmin tenant PICKER list. A flat path, so it
  // lives in the exact Set; the team/invite/member endpoints are parameterized
  // (below). NOTE the patterns require an `/invites` or `/members` suffix, so they
  // can never match the separate `/v1/tenants/me` exact entry above.
  '/v1/superadmin/tenants',
])

/** Parameterized live paths a static Set cannot match (matched against the pathname). */
const LIVE_PATH_PATTERNS: readonly RegExp[] = [
  /^\/v1\/workflows\/[^/]+\/runs$/,
  /^\/v1\/runs\/[^/]+$/,
  /^\/v1\/approvals\/[^/]+\/(approve|reject)$/,
  // admin-roles Wave B — the role-gated team endpoints. The `/invites` and
  // `/members` suffixes mean these NEVER match `/v1/tenants/me`.
  /^\/v1\/tenants\/[^/]+\/invites$/,
  /^\/v1\/tenants\/[^/]+\/invites\/[^/]+$/,
  /^\/v1\/tenants\/[^/]+\/members\/[^/]+$/,
]

/** True when `path` (query stripped) is a live network path even under mocks. */
function isLivePath(path: string): boolean {
  const pathname = path.split('?')[0] ?? path
  if (LIVE_PATHS.has(pathname)) return true
  return LIVE_PATH_PATTERNS.some((re) => re.test(pathname))
}

/**
 * Module-level Privy access-token getter registry (W3). A component mounted under
 * `<PrivyProvider>` registers `privy.getAccessToken` here on mount via
 * `setAuthTokenGetter`. This indirection exists because `apiFetch` is a plain
 * module function — it CANNOT call `usePrivy()` (a React hook). Registration, not
 * a hook call, bridges the token in.
 */
type AuthTokenGetter = () => Promise<string | null>
let authTokenGetter: AuthTokenGetter | null = null

/** Register (or clear, with `null`) the Privy access-token getter. */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  authTokenGetter = getter
}

/**
 * Resolve the current Privy access token, or `null` when no getter is registered
 * (logged out / pre-mount). `null` means no `Authorization` header is attached. We
 * deliberately have NO `X-Service-Key` path: the machine secret never reaches the
 * browser.
 *
 * A getter THROW (transient Privy error — network blip mid-refresh, JWKS hiccup,
 * SDK race on a backgrounded tab) is swallowed to `null` HERE so the initial
 * request just goes out header-less (the server answers 401, which routes into the
 * single-shot re-auth path). The re-auth path itself uses `refreshAuthToken`, which
 * RETRIES with backoff and does NOT treat a single transient throw as a terminal
 * null → so a momentary token-fetch failure no longer escalates straight to logout.
 */
async function getAuthToken(): Promise<string | null> {
  if (!authTokenGetter) return null
  try {
    return await authTokenGetter()
  } catch {
    // A failed token fetch must not attach a stale/garbage header — fail to null.
    return null
  }
}

/**
 * Logout-handler registry (W5). The AuthTokenBridge registers Privy's `logout`
 * here. apiFetch calls it after a 401 survives one silent token refresh + retry,
 * dropping the user back to the login screen. `null` when logged out / pre-mount.
 */
type LogoutHandler = () => void | Promise<void>
let logoutHandler: LogoutHandler | null = null

/** Register (or clear, with `null`) the logout handler. */
export function setLogoutHandler(handler: LogoutHandler | null): void {
  logoutHandler = handler
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Token-refresh backoff schedule (W5, hardened). Privy's `getAccessToken` is NOT a
 * forced refresh — it only mints a NEW token when the current one is expired/near-
 * expiry by Privy's OWN clock. For a server-side 401 where the token is not yet
 * Privy-expired (SPA↔engine clock skew, near-boundary expiry, a transient getter
 * throw), the first call can return the SAME token or throw. Privy's documented
 * remedy ("Managing expired access tokens") is to call `getAccessToken` with a
 * TIME-BASED BACKOFF until a refreshed token is returned, and only log out if it
 * still cannot be refreshed. These delays implement that bounded backoff. The first
 * attempt is immediate (0ms) so the common case (token already refreshed) costs
 * nothing; the extra attempts cover the skew/transient window.
 */
const REFRESH_BACKOFF_MS: readonly number[] = [0, 250, 750]

/**
 * Single-flight token refresh (W5, hardened). Concurrent 401s share ONE refresh so
 * we never fan out N parallel Privy refreshes (and never stack N retries).
 *
 * Per Privy guidance, this retries `getAccessToken` with a short time-based backoff:
 *  - a getter THROW (transient) is retried rather than collapsing to an immediate
 *    null → logout (closes the "momentary token-fetch failure ejects the session"
 *    gap);
 *  - a token that DIFFERS from the one the failed request used means Privy minted a
 *    fresh token → return it immediately (no pointless extra waiting);
 *  - if every attempt yields the SAME (still-not-refreshed) token or null, we return
 *    that final value so the caller logs out — the bounded, intentional outcome.
 *
 * `previousToken` is the bearer the 401'd request carried; passing it lets us detect
 * "Privy refreshed to a new token" vs "Privy handed back the identical token".
 */
let refreshInFlight: Promise<string | null> | null = null
function refreshAuthToken(previousToken: string | null): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      let latest: string | null = null
      for (let i = 0; i < REFRESH_BACKOFF_MS.length; i++) {
        if (REFRESH_BACKOFF_MS[i]) await sleep(REFRESH_BACKOFF_MS[i]!)
        let token: string | null
        let threw = false
        try {
          token = authTokenGetter ? await authTokenGetter() : null
        } catch {
          // Transient getter error — keep backing off rather than logging out now.
          token = null
          threw = true
        }
        if (token) {
          latest = token
          // A genuinely refreshed (different) token → done. If it matches the token
          // that just 401'd, keep backing off in case Privy refreshes on a later tick.
          if (token !== previousToken) return token
        }
        // A logged-out getter (no getter registered) yields null without a throw →
        // no point retrying; the session is gone.
        if (!authTokenGetter && !threw) return null
      }
      // Backoff exhausted: return whatever we last saw (same-as-before token or
      // null). The caller treats a non-fresh result as "could not refresh" → logout.
      return latest
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

async function parseError(res: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  // The engine wraps EVERY error as `{ error: <envelope> }` (engine-api `fail()` +
  // every hand-rolled `c.json({ error: ... }, status)`). The bug this fixes: we used
  // to validate the RAW body against the (unwrapped) envelope schema, so the real
  // `{ error: { code, message, retryable } }` failed the schema and fell through to
  // the status-based synthesis below — turning every 403 into `SKILL_EXEC_ERROR`
  // instead of its real code (TENANT_UNKNOWN / APPROVAL_DENIED / …). That broke the
  // access-denied + auto-provision (TENANT_UNKNOWN) and the approvals (APPROVAL_DENIED)
  // paths in prod, while the tests passed because their fixtures used the unwrapped
  // shape. Unwrap `body.error` first; fall back to a bare body (defensive) and finally
  // to the status synthesis for non-enveloped infra/proxy responses (HTML/empty 401s).
  const enveloped =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error: unknown }).error
      : body
  const parsed = errorEnvelopeSchema.safeParse(enveloped)
  if (parsed.success) return new ApiError(parsed.data, res.status)
  // Non-enveloped failure — synthesize an envelope. Map by HTTP status.
  // ⚠ A 401 from an infra/proxy/gateway/CDN auth layer arrives with an HTML or
  // empty body (NOT the engine's JSON envelope). It MUST still classify as
  // `UNAUTHENTICATED` so the re-auth/logout path (keyed on `error.code`) runs —
  // otherwise a real session-expiry 401 would degrade to a dead error screen with
  // a stale session and never drop the user to the login screen. Mirror the
  // 404→SKILL_NOT_FOUND special-case.
  const code: ErrorCode =
    res.status === 401
      ? 'UNAUTHENTICATED'
      : res.status === 404
        ? 'SKILL_NOT_FOUND'
        : 'SKILL_EXEC_ERROR'
  return new ApiError(
    { code, message: res.statusText || `HTTP ${res.status}`, retryable: res.status >= 500 },
    res.status,
  )
}

/**
 * Fetch + parse a `/v1` resource as `T`.
 *
 * NOTE on the two 403 codes: both `APPROVAL_REQUIRED` and `APPROVAL_DENIED` map
 * to HTTP 403. Callers MUST branch on `err.code` (not `err.status`) to tell them
 * apart — `ApiError` preserves the envelope code for exactly this reason.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = 30_000, retries = 3, backoffMs = 300, headers, ...init } = options

  // Mocks are a GLOBAL switch — EXCEPT for LIVE_PATHS (W3), which always hit the
  // network so the SPA derives tenant identity from the real backend even in the
  // mock-data-first local mode.
  if (USE_MOCKS && !isLivePath(path)) {
    return resolveMock<T>(path, init)
  }

  let currentToken = await getAuthToken()
  const mergedHeaders = new Headers(headers)
  if (!(init.body instanceof FormData) && init.body != null && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json')
  }
  if (currentToken) mergedHeaders.set('Authorization', `Bearer ${currentToken}`)
  // INVARIANT: never set X-Service-Key here. The browser is JWT-only.

  // 401 re-auth is single-shot per request (W5): one silent refresh + retry, then
  // logout if it persists. Tracked OUTSIDE the network-retry budget so a 401 can
  // never spin a loop with the exponential-backoff retries.
  let reauthAttempted = false
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: mergedHeaders,
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        const apiErr = await parseError(res)
        // ── 401 UNAUTHENTICATED: ONE silent refresh + retry, then logout. ───────
        // Distinct from the two 403 approval codes AND from TENANT_UNKNOWN (403):
        // only `UNAUTHENTICATED` triggers re-auth. Never loops — the second 401
        // logs out and throws.
        if (apiErr.code === 'UNAUTHENTICATED') {
          if (!reauthAttempted) {
            reauthAttempted = true
            // Backoff-retry getAccessToken (Privy guidance). Only retry the request
            // when Privy hands back a token DIFFERENT from the one that just 401'd —
            // re-sending the identical bearer would just 401 again (a wasted attempt
            // on the way to the same logout).
            const fresh = await refreshAuthToken(currentToken)
            if (fresh && fresh !== currentToken) {
              currentToken = fresh
              mergedHeaders.set('Authorization', `Bearer ${fresh}`)
              attempt-- // this re-auth retry does not consume the network budget
              continue
            }
          }
          // Already retried once (still 401), or refresh yielded no NEW token (null
          // or the same still-rejected token) → log out + fail. Fail closed.
          await logoutHandler?.()
          throw apiErr
        }
        // Only retry server-flagged retryable failures (network-class), never 4xx.
        if (apiErr.retryable && attempt < retries) {
          lastError = apiErr
          await sleep(backoffMs * 2 ** attempt)
          continue
        }
        throw apiErr
      }
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof ApiError) throw err
      // Network error or timeout — retry with exponential backoff.
      lastError = err
      if (attempt < retries && (isAbortError(err) || err instanceof TypeError)) {
        await sleep(backoffMs * 2 ** attempt)
        continue
      }
      throw err
    }
  }
  throw lastError
}
