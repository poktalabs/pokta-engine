/**
 * Mock infrastructure (M2 P0). When `VITE_USE_MOCKS=true`, `apiFetch` consults
 * this registry instead of the network. Per-surface fixtures (approvals, runs,
 * workflows, integrations, reports) register their handlers here in later phases
 * (P2–P4); P0 ships only the registry + matcher so the seam is frozen.
 *
 * A handler matches a request by HTTP method + a path matcher (exact string or a
 * RegExp). The first match wins. The matcher captures RegExp groups and passes
 * them to the handler as `params` so dynamic routes (`/v1/runs/:id`) work.
 */

export type MockMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface MockContext {
  /** Resolved request method (defaults to GET). */
  method: MockMethod
  /** The full request path, e.g. `/v1/runs/run_123`. */
  path: string
  /** RegExp capture groups, if the matcher was a RegExp. */
  params: string[]
  /** Parsed JSON body for write requests, when present. */
  body: unknown
}

export type MockHandler = (ctx: MockContext) => unknown | Promise<unknown>

interface MockRoute {
  method: MockMethod
  match: string | RegExp
  handler: MockHandler
}

const routes: MockRoute[] = []

/** Register a mock route. Per-surface fixture modules call this at import time. */
export function registerMock(method: MockMethod, match: string | RegExp, handler: MockHandler): void {
  routes.push({ method, match, handler })
}

/** Replace ALL registered routes — primarily for test isolation. */
export function resetMocks(): void {
  routes.length = 0
}

function normalizeMethod(init: RequestInit): MockMethod {
  return (init.method?.toUpperCase() as MockMethod) ?? 'GET'
}

function parseBody(init: RequestInit): unknown {
  const { body } = init
  if (body == null || body instanceof FormData) return undefined
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return body
    }
  }
  return undefined
}

/**
 * Resolve a request against the registry. Throws if no fixture is registered —
 * a loud failure is better than a silent empty response while building surfaces.
 */
export async function resolveMock<T>(path: string, init: RequestInit): Promise<T> {
  const method = normalizeMethod(init)
  // Strip query string for matching; handlers can re-read it from `path` if needed.
  const pathname = path.split('?')[0] ?? path

  for (const route of routes) {
    if (route.method !== method) continue
    if (typeof route.match === 'string') {
      if (route.match === pathname) {
        return (await route.handler({ method, path, params: [], body: parseBody(init) })) as T
      }
    } else {
      const m = route.match.exec(pathname)
      if (m) {
        return (await route.handler({
          method,
          path,
          params: m.slice(1),
          body: parseBody(init),
        })) as T
      }
    }
  }

  throw new Error(`[mocks] no fixture registered for ${method} ${pathname}`)
}
