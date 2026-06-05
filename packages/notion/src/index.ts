/**
 * Notion CRM integration client (Phase 0 stub — implemented by Lane A / TASK-001).
 *
 * Mirrors the `packages/llm` discipline: reads its own env, throws when
 * unconfigured or on error, and the CALLER owns the fallback. The workflow
 * (`proposal-step`) wraps `commitCrmEntry` in try/catch and records an
 * `IntegrationResult` (fail-soft, D3) — this module never returns a failure
 * shape, it throws and lets the workflow decide.
 *
 * Env (read at call time, see PLAN-demo-integrations.md):
 *   NOTION_API_KEY     — integration token
 *   NOTION_CRM_DB_ID   — target CRM database id
 */

const API_KEY = process.env.NOTION_API_KEY ?? ''
const CRM_DB_ID = process.env.NOTION_CRM_DB_ID ?? ''

export function notionConfigured(): boolean {
  return API_KEY.length > 0 && CRM_DB_ID.length > 0
}

export function notionInfo(): { configured: boolean; dbId: string } {
  return { configured: notionConfigured(), dbId: CRM_DB_ID ? `${CRM_DB_ID.slice(0, 8)}…` : '' }
}

/** Fields a CRM row needs. Lane A maps these onto the Notion DB's properties. */
export interface CrmRow {
  account: string
  contactName: string
  opportunityName: string
  stage: string
  estimatedValue: string
  summary: string
  tags: string[]
}

/** Created-page handle returned to the workflow on success. */
export interface NotionPage {
  pageId: string
  url: string
}

/**
 * Create a CRM row in Notion. THROWS when unconfigured or on API error — the
 * caller catches and records the failure (D3). Implemented by Lane A.
 */
export async function commitCrmEntry(_row: CrmRow): Promise<NotionPage> {
  if (!notionConfigured()) throw new Error('Notion not configured (set NOTION_API_KEY / NOTION_CRM_DB_ID)')
  throw new Error('commitCrmEntry not implemented yet (Phase 0 stub — TASK-001)')
}
