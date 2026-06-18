import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RunDetail } from '@pokta-engine/contract'
import { ApiError, apiFetch } from '@/lib/api'

/**
 * Run-detail read/write hooks (P5b Wave 2).
 *
 * LIVE against the merged Wave-1 backend (both paths are in `LIVE_PATHS`, so they
 * bypass the mock registry even under `VITE_USE_MOCKS`). Modeled on
 * TenantProvider's `useQuery` + ApiError pattern:
 *   - `useRunDetail(id)` → GET /v1/runs/:id → RunDetail.
 *   - `useRerunWorkflow()` → POST /v1/workflows/:id/runs → dispatches a child run.
 *
 * Callers branch on `ApiError.code` for graceful-degradation copy. `retry: false`
 * mirrors the tenant query — a 404/403 is a terminal state the surface renders.
 */

/** Response of POST /v1/workflows/:id/runs (the dispatch envelope). */
export interface DispatchRunResponse {
  runId: string
  status: 'queued'
  traceId: string
}

/** GET /v1/runs/:id — one run's full row. */
export function useRunDetail(id: string | undefined) {
  return useQuery<RunDetail, ApiError>({
    queryKey: ['runs', id],
    queryFn: () => apiFetch<RunDetail>(`/v1/runs/${encodeURIComponent(id ?? '')}`),
    enabled: !!id,
    retry: false,
  })
}

/**
 * POST /v1/workflows/:id/runs — re-run a workflow (dispatch a fresh run). On
 * success the workflow's run list + cards are stale, so we invalidate them.
 */
export function useRerunWorkflow() {
  const queryClient = useQueryClient()
  return useMutation<DispatchRunResponse, ApiError, { workflowId: string; input?: unknown }>({
    mutationFn: ({ workflowId, input }) =>
      apiFetch<DispatchRunResponse>(`/v1/workflows/${encodeURIComponent(workflowId)}/runs`, {
        method: 'POST',
        body: JSON.stringify({ input: input ?? {} }),
      }),
    onSuccess: (_data, { workflowId }) => {
      void queryClient.invalidateQueries({ queryKey: ['workflows', workflowId, 'runs'] })
      void queryClient.invalidateQueries({ queryKey: ['workspace', 'workflows'] })
    },
  })
}
