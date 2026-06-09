import { type ReactNode } from 'react'
import { vi } from 'vitest'

/**
 * Shared Privy mock (PR2b W0). The real `@privy-io/react-auth` SDK cannot run in
 * jsdom (it boots an iframe + network JWKS), so SPA tests replace it with this
 * controllable test double. It mirrors exactly the surface our code touches:
 *
 *   - `<PrivyProvider>` — a passthrough that renders `children` (the real one is
 *     mounted by `PrivyAuthProvider`; here it is inert),
 *   - `usePrivy()` — returns `{ ready, authenticated, login, logout,
 *     getAccessToken }` driven by the mutable `privyMockState` below.
 *
 * USAGE (Phase-2 test files) — load the factory via dynamic import INSIDE the
 * hoisted `vi.mock` callback so it never touches a not-yet-initialized top-level
 * import binding (the classic `vi.mock` temporal-dead-zone trap):
 *
 *   import { setPrivyState } from '@/test'
 *   vi.mock('@privy-io/react-auth', async () =>
 *     (await import('@/test/privy-mock')).privyMockFactory())
 *   // then, per case:
 *   setPrivyState({ ready: true, authenticated: true, token: 'jwt-123' })
 *
 * The hook reads state lazily (at hook-call time, not module-eval time) via the
 * closure over `privyMockState`. `resetPrivyMock()` (called from setup.ts
 * `afterEach`) restores the defaults + clears the spies so cases never leak.
 */

export interface PrivyMockState {
  /** Privy SDK readiness — `false` renders the AuthGate loading state. */
  ready: boolean
  /** Whether a session exists — `false` renders the login screen. */
  authenticated: boolean
  /** The access token `getAccessToken()` resolves to (null = no Bearer header). */
  token: string | null
}

const DEFAULT_STATE: PrivyMockState = {
  ready: true,
  authenticated: true,
  token: 'test-privy-jwt',
}

/** Mutable, test-controlled Privy state. Read lazily by `usePrivy()`. */
export const privyMockState: PrivyMockState = { ...DEFAULT_STATE }

/** Spies for the imperative Privy actions, so tests can assert login/logout calls. */
export const privyMockSpies = {
  login: vi.fn(),
  logout: vi.fn(async () => {
    privyMockState.authenticated = false
  }),
  getAccessToken: vi.fn(async () => privyMockState.token),
}

/** Patch the Privy state for the current test case. */
export function setPrivyState(patch: Partial<PrivyMockState>): void {
  Object.assign(privyMockState, patch)
}

/** Restore defaults + clear spies. Called from `afterEach` in setup.ts. */
export function resetPrivyMock(): void {
  Object.assign(privyMockState, DEFAULT_STATE)
  privyMockSpies.login.mockClear()
  privyMockSpies.logout.mockClear()
  privyMockSpies.getAccessToken.mockClear()
}

/** The `usePrivy()` return shape our code consumes (subset of `PrivyInterface`). */
export interface UsePrivyMock {
  ready: boolean
  authenticated: boolean
  login: typeof privyMockSpies.login
  logout: typeof privyMockSpies.logout
  getAccessToken: typeof privyMockSpies.getAccessToken
}

/** The mocked `usePrivy` hook — reads `privyMockState` at call time. */
export function usePrivyMock(): UsePrivyMock {
  return {
    ready: privyMockState.ready,
    authenticated: privyMockState.authenticated,
    login: privyMockSpies.login,
    logout: privyMockSpies.logout,
    getAccessToken: privyMockSpies.getAccessToken,
  }
}

/** A passthrough `<PrivyProvider>` for tests (the real SDK never boots in jsdom). */
export function PrivyProviderMock({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/**
 * The `vi.mock('@privy-io/react-auth', privyMockFactory)` factory. Returns only
 * the named exports our app imports; everything else is intentionally absent so a
 * test that reaches for an unmocked Privy API fails loudly rather than silently.
 */
export function privyMockFactory() {
  return {
    PrivyProvider: PrivyProviderMock,
    usePrivy: usePrivyMock,
  }
}
