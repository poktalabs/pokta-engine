import { Hono } from 'hono'
import { desc, sql } from 'drizzle-orm'
import { db, schema } from '@godin-engine/db'
import { listManifests } from '@godin-engine/workflows'
import type { WorkflowManifest } from '@godin-engine/contract'
import { buildOverview, type Overview } from './dashboard'
import { consolePage } from './console-page'

/**
 * Operator CONSOLE (alternate UI for /dashboard) — a left-nav, multi-section
 * surface: Jobs · Workflows · Integrations · Policies · Observability ·
 * Database/State. Read-only, same data discipline as the dashboard: it reuses
 * the pure buildOverview() assembler and adds three console-only reads
 * (workflow config, quota ledger, raw table state). NEVER writes.
 *
 * Kept side-by-side with /dashboard for comparison (D4: own surface).
 */

type ManifestView = {
  id: string
  version: string
  runtime: string
  timeoutMs: number
  policies: Array<{ kind: string; detail: string }>
}

function policyDetail(p: WorkflowManifest['policy'][number]): { kind: string; detail: string } {
  if (p.kind === 'quota') return { kind: 'quota', detail: `${p.perDay}/day · ${p.scope} · ${p.tier}` }
  if (p.kind === 'approval') return { kind: 'approval', detail: `${p.approver} → ${p.onApprove}` }
  return { kind: (p as { kind: string }).kind, detail: '' }
}

function serializeManifest(m: WorkflowManifest): ManifestView {
  return {
    id: m.id,
    version: m.version,
    runtime: m.runtime,
    timeoutMs: m.timeoutMs,
    policies: m.policy.map(policyDetail),
  }
}

/**
 * Integration config status. Best-effort from engine-api's own env — note the
 * WORKER is what actually runs the integrations, so on Railway (separate service)
 * this reflects the api's view, not the worker's. Local dev shares one env.
 */
function integrationStatus(): Array<{ provider: string; configured: boolean; detail: string }> {
  const notionOk = Boolean(process.env.NOTION_API_KEY && process.env.NOTION_CRM_DB_ID)
  const resendOk = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM)
  return [
    {
      provider: 'notion',
      configured: notionOk,
      detail: notionOk ? 'NOTION_API_KEY + NOTION_CRM_DB_ID set' : 'set NOTION_API_KEY + NOTION_CRM_DB_ID',
    },
    {
      provider: 'resend',
      configured: resendOk,
      detail: resendOk ? 'RESEND_API_KEY + RESEND_FROM set' : 'set RESEND_API_KEY + RESEND_FROM',
    },
  ]
}

export interface ConsoleData {
  overview: Overview
  workflows: ManifestView[]
  integrations: Array<{ provider: string; configured: boolean; detail: string }>
  quotaLedger: Array<typeof schema.engineQuotaLedger.$inferSelect>
  tables: Array<{ name: string; count: number; recent: unknown[] }>
  generatedAt: string
}

async function tableCount(table: 'engine_runs' | 'engine_approvals' | 'engine_quota_ledger'): Promise<number> {
  const t =
    table === 'engine_runs'
      ? schema.engineRuns
      : table === 'engine_approvals'
        ? schema.engineApprovals
        : schema.engineQuotaLedger
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(t)
  return row?.c ?? 0
}

async function fetchConsole(): Promise<ConsoleData> {
  const runs = await db
    .select()
    .from(schema.engineRuns)
    .orderBy(desc(schema.engineRuns.createdAt))
    .limit(100)
  const approvals = await db
    .select()
    .from(schema.engineApprovals)
    .orderBy(desc(schema.engineApprovals.createdAt))
    .limit(100)
  const quotaLedger = await db.select().from(schema.engineQuotaLedger).limit(100)
  const manifests = listManifests()

  const [runCount, approvalCount, quotaCount] = await Promise.all([
    tableCount('engine_runs'),
    tableCount('engine_approvals'),
    tableCount('engine_quota_ledger'),
  ])

  return {
    overview: buildOverview(runs, approvals, manifests),
    workflows: manifests.map(serializeManifest),
    integrations: integrationStatus(),
    quotaLedger,
    tables: [
      { name: 'engine_runs', count: runCount, recent: runs.slice(0, 10) },
      { name: 'engine_approvals', count: approvalCount, recent: approvals.slice(0, 10) },
      { name: 'engine_quota_ledger', count: quotaCount, recent: quotaLedger.slice(0, 10) },
    ],
    generatedAt: new Date().toISOString(),
  }
}

export function mountConsole(app: Hono): void {
  app.get('/console', (c) => c.html(consolePage()))
  app.get('/console/api/data', async (c) => c.json(await fetchConsole()))
}
