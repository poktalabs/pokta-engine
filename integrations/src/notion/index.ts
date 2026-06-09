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

import { Client } from '@notionhq/client'

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

let client: Client | null = null
function getClient(): Client {
  if (!notionConfigured()) throw new Error('Notion not configured (set NOTION_API_KEY / NOTION_CRM_DB_ID)')
  if (!client) client = new Client({ auth: API_KEY })
  return client
}

function richText(value: string) {
  return { rich_text: [{ type: 'text' as const, text: { content: value.slice(0, 2000) } }] }
}

/**
 * Create a CRM row in Notion. THROWS when unconfigured or on API error — the
 * caller catches and records the failure (D3).
 *
 * Field mapping (CrmRow -> Notion DB property):
 *   opportunityName -> "Opportunity" (title)   [the DB's title property]
 *   account         -> "Account"     (rich_text)
 *   contactName     -> "Contact"     (rich_text)
 *   stage           -> "Stage"       (select)
 *   estimatedValue  -> "Estimated Value" (rich_text — value is a formatted
 *                       string like "$135,000", not a clean number)
 *   summary         -> "Summary"     (rich_text)
 *   tags            -> "Tags"        (multi_select)
 */
export async function commitCrmEntry(row: CrmRow): Promise<NotionPage> {
  const notion = getClient()
  const res = await notion.pages.create({
    parent: { database_id: CRM_DB_ID },
    properties: {
      Opportunity: { title: [{ type: 'text', text: { content: row.opportunityName.slice(0, 2000) } }] },
      Account: richText(row.account),
      Contact: richText(row.contactName),
      Stage: { select: { name: row.stage } },
      'Estimated Value': richText(row.estimatedValue),
      Summary: richText(row.summary),
      Tags: { multi_select: row.tags.map((name) => ({ name })) },
    },
  })
  const pageId = res.id
  // The Notion SDK types `pages.create` as a union; `url` exists on full page
  // objects. Read it defensively so a partial response never crashes the caller.
  const url = (res as { url?: string }).url ?? `https://www.notion.so/${pageId.replace(/-/g, '')}`
  return { pageId, url }
}
