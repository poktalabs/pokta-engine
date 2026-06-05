import { Hono } from 'hono'
import { dashboardShellPage } from './dashboard-page'

/**
 * Operator dashboard mount (Phase 0 shell — Lane C / TASK-003 fills in the views).
 *
 * Read-only surface, separate from /demo (D4). Lane C adds the JSON endpoints
 * (e.g. /dashboard/api/overview) that assemble runs + approvals + the derived
 * workflow node graph + the outcome registry, then the page renders them.
 */
export function mountDashboard(app: Hono): void {
  app.get('/dashboard', (c) => c.html(dashboardShellPage()))
}
