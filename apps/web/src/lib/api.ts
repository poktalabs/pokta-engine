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
 * LIVE PATHS (W3) — the auth/tenant-identity surfaces that ALWAYS hit the network,
 * even when `VITE_USE_MOCKS==='true'`. PR2b wires ONLY `/v1/tenants/me` live; every
 * other surface (approvals/runs/workflows/integrations/reports) stays mocked. Match
 * is on the pathname (query stripped). Keep this set MINIMAL — widening it pulls a
 * surface off the registry and onto the real backend.
 */
const LIVE_PATHS: ReadonlySet<string> = new Set(['/v1/tenants/me'])

/** True when `path` (query stripped) is a live network path even under mocks. */
function isLivePath(path: string): boolean {
  const pathname = path.split('?')[0] ?? path
  return LIVE_PATHS.has(pathname)
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

/**
 * Single-flight token refresh (W5). Concurrent 401s share ONE refresh so we never
 * fan out N parallel Privy refreshes (and never stack N retries). `getAccessToken`
 * transparently refreshes an expired token inside Privy; we just call it once and
 * de-dupe via the in-flight promise. Returns the fresh token (or null).
 */
let refreshInFlight: Promise<string | null> | null = null
function refreshAuthToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = getAuthToken().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
  const parsed = errorEnvelopeSchema.safeParse(body)
  if (parsed.success) return new ApiError(parsed.data, res.status)
  // Non-enveloped failure — synthesize an envelope. Map by HTTP status.
  const code: ErrorCode = res.status === 404 ? 'SKILL_NOT_FOUND' : 'SKILL_EXEC_ERROR'
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

  const token = await getAuthToken()
  const mergedHeaders = new Headers(headers)
  if (!(init.body instanceof FormData) && init.body != null && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json')
  }
  if (token) mergedHeaders.set('Authorization', `Bearer ${token}`)
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
            const fresh = await refreshAuthToken()
            if (fresh) {
              mergedHeaders.set('Authorization', `Bearer ${fresh}`)
              attempt-- // this re-auth retry does not consume the network budget
              continue
            }
          }
          // Already retried once (still 401) or no fresh token → log out + fail.
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
