import { useQuery } from '@tanstack/react-query'
import type { ApprovalListResponse } from '@godin-engine/contract'
import { ApiError, apiFetch } from '@/lib/api'

/**
 * Approvals read hook (P5b Wave 2).
 *
 * LIVE against the merged Wave-1 backend (GET /v1/approvals is in `LIVE_PATHS`,
 * so it bypasses the mock registry even under `VITE_USE_MOCKS`). The tenant is
 * resolved server-side from the Privy JWT — there is NO `?tenant=` param. Modeled
 * on TenantProvider's `useQuery` + ApiError pattern; `retry: false` so a 4xx is a
 * terminal state the surface renders.
 */
export function useApprovals() {
  return useQuery<ApprovalListResponse, ApiError>({
    queryKey: ['approvals'],
    queryFn: () => apiFetch<ApprovalListResponse>('/v1/approvals'),
    retry: false,
  })
}
