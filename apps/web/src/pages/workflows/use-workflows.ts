import { useQuery } from '@tanstack/react-query'
import type {
  RunListResponse,
  WorkspaceWorkflowsResponse,
} from '@godin-engine/contract'
import { ApiError, apiFetch } from '@/lib/api'

/**
 * Workspace workflow read-model hooks (P5b Wave 2).
 *
 * LIVE against the merged Wave-1 backend, modeled on TenantProvider's
 * `useQuery({ queryFn: () => apiFetch(...), retry: false })` + ApiError pattern:
 *   - `useWorkspaceWorkflows()` → GET /v1/workspace/workflows → WorkflowCard[].
 *   - `useWorkflowRuns(id)`     → GET /v1/workflows/:id/runs → RunListItem[].
 *
 * Both are in `LIVE_PATHS` (see lib/api.ts), so they bypass the mock registry and
 * hit the network even under `VITE_USE_MOCKS`. Callers branch on `ApiError.code`
 * for graceful-degradation copy (the page renders ErrorState/EmptyState, never a
 * white screen). `retry: false` mirrors the tenant query — a 4xx (404/403) is a
 * terminal state the surface renders, not something to retry.
 */

/** GET /v1/workspace/workflows — the tenant's workflow CARDS. */
export function useWorkspaceWorkflows() {
  return useQuery<WorkspaceWorkflowsResponse, ApiError>({
    queryKey: ['workspace', 'workflows'],
    queryFn: () => apiFetch<WorkspaceWorkflowsResponse>('/v1/workspace/workflows'),
    retry: false,
  })
}

/** GET /v1/workflows/:id/runs — the runs across the workflow FAMILY rooted at `id`. */
export function useWorkflowRuns(id: string | undefined) {
  return useQuery<RunListResponse, ApiError>({
    queryKey: ['workflows', id, 'runs'],
    queryFn: () =>
      apiFetch<RunListResponse>(`/v1/workflows/${encodeURIComponent(id ?? '')}/runs`),
    enabled: !!id,
    retry: false,
  })
}
