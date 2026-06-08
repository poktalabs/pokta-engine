import { type ReactNode, useState } from 'react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'

/**
 * TanStack Query boundary — REAL (P0 owns this). `staleTime: 30s`, `retry: 1`
 * for queries; a global `MutationCache.onError` surfaces failures as a toast so
 * every mutation gets baseline error feedback without per-call wiring.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
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
