import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ReportListResponse, ReportDetail } from '@/mocks/reports'
// Side-effect import: registers the `GET /v1/reports*` mock handlers. The mocks
// barrel (`@/mocks`) does NOT import this surface yet, so the page lane carries
// the registration itself — harmless in the network build (mocks are tree-shaken
// behind `VITE_USE_MOCKS`).
import '@/mocks/reports'

/**
 * Reports data hooks (M2 P4-B).
 *
 * Mock-data-first: `apiFetch` resolves these from the in-process mock registry
 * when `VITE_USE_MOCKS` is on, and from the real `GET /v1/reports*` endpoints
 * (P5a) otherwise — the page never changes. Response shapes are the LOCAL mock
 * types until the `Report` contract type lands in P5a; importing them from the
 * mock module keeps the index/detail pages and fixtures in lockstep.
 */

/** `GET /v1/reports?tenant=` — the per-tenant report index. */
export function useReports(tenantId: string) {
  return useQuery({
    queryKey: ['reports', tenantId],
    queryFn: () =>
      apiFetch<ReportListResponse>(`/v1/reports?tenant=${encodeURIComponent(tenantId)}`),
  })
}

/** `GET /v1/reports/:id` — one opened report (summary + table/chart). */
export function useReport(id: string | undefined) {
  return useQuery({
    queryKey: ['reports', 'detail', id],
    queryFn: () => apiFetch<ReportDetail>(`/v1/reports/${id}`),
    enabled: !!id,
  })
}
