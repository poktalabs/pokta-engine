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
 * must stay server-side). The Privy access-token injection point is stubbed here
 * and filled in P6 — `getAuthToken()` returns `null` until then.
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
 * Privy access-token accessor — STUB for P0. Filled in P6 (token injection).
 * Returning `null` means no `Authorization` header is attached. We deliberately
 * have NO `X-Service-Key` path: the machine secret never reaches the browser.
 */
async function getAuthToken(): Promise<string | null> {
  return null
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

  if (USE_MOCKS) {
    return resolveMock<T>(path, init)
  }

  const token = await getAuthToken()
  const mergedHeaders = new Headers(headers)
  if (!(init.body instanceof FormData) && init.body != null && !mergedHeaders.has('Content-Type')) {
    mergedHeaders.set('Content-Type', 'application/json')
  }
  if (token) mergedHeaders.set('Authorization', `Bearer ${token}`)
  // INVARIANT: never set X-Service-Key here. The browser is JWT-only.

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
