/**
 * Reports surface barrel (M2 P4-B).
 *
 * The route tree (P1-B owns App.tsx) lazy-imports these defaults to swap the
 * Reports placeholder for the real index + detail surfaces:
 *
 *   const Reports = lazy(() => import('@/pages/reports/ReportsPage'))
 *   const ReportDetail = lazy(() => import('@/pages/reports/ReportDetailPage'))
 */
export { default as ReportsPage } from './ReportsPage'
export { default as ReportDetailPage } from './ReportDetailPage'
export { useReports, useReport } from './use-reports'
