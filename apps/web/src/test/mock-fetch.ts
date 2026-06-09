import { vi } from 'vitest'

/**
 * Path-aware test fetch (PR2b W0). The SPA splits `/v1` traffic two ways
 * (api.ts): paths in `LIVE_PATHS` (e.g. `/v1/tenants/me`) ALWAYS hit the network
 * via `fetch`, even under `VITE_USE_MOCKS`; every other path is served from the
 * in-process mock registry (`resolveMock`) and never touches `fetch`.
 *
 * This helper backs the LIVE half: it installs a `global.fetch` stub that serves
 * responses from a small per-test registry keyed by `METHOD path`. Test writers
 * register the live responses they need (most commonly `GET /v1/tenants/me`); the
 * mocked surfaces (approvals/runs/integrations/reports) continue to resolve
 * through the real registry untouched, so a single test exercises BOTH halves the
 * way production does.
 *
 *   import { installMockFetch, mockLivePath, capturedRequests } from '@/test/mock-fetch'
 *   installMockFetch()                         // once per file (or in beforeEach)
 *   mockLivePath('GET', '/v1/tenants/me', { status: 200, body: tenantView })
 *   // … render; then assert on capturedRequests for headers, etc.
 *
 * `resetMockRegistry()` (called from setup.ts `afterEach`) clears the registry +
 * the captured-request log so nothing leaks between cases.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface MockResponseSpec {
  status: number
  /** JSON body to serialize. Omit for 204 / empty bodies. */
  body?: unknown
  /** Extra response headers (rare). */
  headers?: Record<string, string>
}

/** A dynamic responder gets the captured request and returns a response spec. */
export type MockResponder = (req: CapturedRequest) => MockResponseSpec | Promise<MockResponseSpec>

export interface CapturedRequest {
  method: HttpMethod
  /** Path WITH query string, exactly as `apiFetch` called it. */
  path: string
  /** Header name (lowercased) → value. */
  headers: Record<string, string>
  /** Parsed JSON body for write requests, when present. */
  body: unknown
}

interface MockRoute {
  method: HttpMethod
  /** Match against the pathname (query stripped). */
  pathname: string
  responder: MockResponder
}

const routes: MockRoute[] = []

/** Every request the live-path fetch stub saw, in order. Assert headers here. */
export const capturedRequests: CapturedRequest[] = []

/**
 * Register a live-path response. `match` is the pathname (query stripped before
 * matching). Pass a `MockResponseSpec` for a static reply or a `MockResponder`
 * for a per-call one (e.g. first call 401, second 200 — the 401-LOOP test).
 */
export function mockLivePath(
  method: HttpMethod,
  match: string,
  reply: MockResponseSpec | MockResponder,
): void {
  const pathname = match.split('?')[0] ?? match
  const responder: MockResponder = typeof reply === 'function' ? reply : () => reply
  routes.push({ method, pathname, responder })
}

/** Clear all live-path routes + the captured-request log. */
export function resetMockRegistry(): void {
  routes.length = 0
  capturedRequests.length = 0
}

function normalizeMethod(init: RequestInit | undefined): HttpMethod {
  return ((init?.method ?? 'GET').toUpperCase() as HttpMethod)
}

function headersToObject(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const h = init?.headers
  if (!h) return out
  if (h instanceof Headers) {
    h.forEach((v, k) => { out[k.toLowerCase()] = v })
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v)
  }
  return out
}

function parseBody(init: RequestInit | undefined): unknown {
  const body = init?.body
  if (body == null || typeof body !== 'string') return undefined
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/**
 * Install the live-path `global.fetch` stub. Idempotent per test (call in a
 * `beforeEach` or once at the top of a file). Unmatched live paths throw a loud
 * error so a missing `mockLivePath(...)` is never a silent empty response.
 */
export function installMockFetch(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    // api.ts calls `${API_BASE}${path}`; API_BASE is '' in tests, so url IS the path.
    const path = url
    const pathname = path.split('?')[0] ?? path
    const method = normalizeMethod(init)
    const captured: CapturedRequest = {
      method,
      path,
      headers: headersToObject(init),
      body: parseBody(init),
    }
    capturedRequests.push(captured)

    const route = routes.find((r) => r.method === method && r.pathname === pathname)
    if (!route) {
      throw new Error(`[mock-fetch] no live response registered for ${method} ${pathname}`)
    }
    const spec = await route.responder(captured)
    const headers = new Headers({ 'Content-Type': 'application/json', ...spec.headers })
    const responseBody = spec.body === undefined ? null : JSON.stringify(spec.body)
    return new Response(responseBody, { status: spec.status, headers })
  })
}
