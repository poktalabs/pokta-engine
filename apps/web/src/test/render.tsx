import { type ReactElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { PrivyAuthProvider } from '@/providers/PrivyProvider'
import { AuthTokenBridge } from '@/providers/AuthTokenBridge'
import { LanguageProvider } from '@/providers/LanguageProvider'
import { TenantProvider } from '@/providers/TenantProvider'

/**
 * `renderWithProviders` (PR2b W0) — the shared SPA test renderer. It mounts a
 * component inside the REAL provider tree in its locked nesting order
 * (`PrivyAuthProvider → Query → Language → Tenant`), with a FRESH QueryClient per
 * call so query cache never leaks across tests.
 *
 * Privy is supplied by `@/test/privy-mock` (a `vi.mock('@privy-io/react-auth', …)`
 * in the test file) — `PrivyAuthProvider` then renders the mocked passthrough and
 * `usePrivy()` reads the controllable mock state. The Tenant layer (post-W4)
 * fetches `GET /v1/tenants/me`; pair this with `@/test/mock-fetch`
 * (`installMockFetch()` + `mockLivePath('GET','/v1/tenants/me', …)`) so the live
 * path resolves.
 *
 * Returns the RTL result plus the `queryClient` so a test can inspect/clear cache.
 */

/** A fresh QueryClient for one test: retries OFF, no cache reuse, silent logs. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Inject a specific client (e.g. to assert the real retry predicate). */
  queryClient?: QueryClient
  /** Extra wrapper rendered INSIDE TenantProvider (e.g. a MemoryRouter for routes). */
  wrapInner?: (children: ReactNode) => ReactElement
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { queryClient = createTestQueryClient(), wrapInner, ...renderOptions } = options

  function Wrapper({ children }: { children: ReactNode }) {
    const inner = wrapInner ? wrapInner(children) : children
    return (
      <PrivyAuthProvider>
        {/* W3 token bridge — registers the (mocked) getAccessToken so live-path
            requests carry `Authorization: Bearer` exactly as in production. */}
        <AuthTokenBridge />
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>
            <TenantProvider>{inner}</TenantProvider>
          </LanguageProvider>
        </QueryClientProvider>
      </PrivyAuthProvider>
    )
  }

  const result = render(ui, { wrapper: Wrapper, ...renderOptions })
  return { ...result, queryClient }
}
