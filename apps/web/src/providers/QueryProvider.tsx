import { type ReactNode, useState } from 'react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'

/**
 * Query retry predicate (PR2b W5). A 401 `UNAUTHENTICATED` is a re-auth signal,
 * NOT a transient failure: apiFetch already runs a single-flight token refresh +
 * one retry (and logs out if still 401), so React Query must NEVER retry it — that
 * would stack a second refresh/logout cycle (a re-auth loop). Everything else
 * keeps the prior single retry. 401 is thus distinct from the two 403 approval
 * codes AND from `TENANT_UNKNOWN` (403, handled by TenantProvider/AppShell), which
 * are likewise never retried here because they are not the default-retry path.
 */
function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return false
  if (error instanceof ApiError && !error.retryable) return false
  return failureCount < 1
}

/**
 * TanStack Query boundary — REAL (P0 owns this). `staleTime: 30s`; queries retry
 * via `retryQuery` (W5 — excludes 401/UNAUTHENTICATED + non-retryable codes); a
 * global `MutationCache.onError` surfaces failures as a toast so every mutation
 * gets baseline error feedback without per-call wiring.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: retryQuery,
      },
    },
    mutationCache: new MutationCache({
      onError: (error) => {
        const message =
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Something went wrong'
        toast.error(message)
      },
    }),
  })
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // One client per app lifetime; `useState` keeps it stable across re-renders.
  const [client] = useState(createQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
