import type { IntegrationModule } from '../types.js'
import { commitCrmEntry, notionConfigured, notionInfo } from './index.js'

/**
 * The Notion integration as a registry module. Notion reads its own env (D1 — it
 * is NOT a per-tenant `ctx.integration` provider in M1; proposal-step imports
 * `commitCrmEntry` directly), so `create` ignores config and returns the env-bound
 * surface. The descriptor exists so it appears in `listIntegrations()`.
 */
export const notionModule: IntegrationModule<{
  commitCrmEntry: typeof commitCrmEntry
  notionConfigured: typeof notionConfigured
  notionInfo: typeof notionInfo
}> = {
  descriptor: {
    id: 'notion',
    displayName: 'Notion CRM',
    category: 'crm',
    secretKeys: ['NOTION_API_KEY', 'NOTION_CRM_DB_ID'],
  },
  create: () => ({ commitCrmEntry, notionConfigured, notionInfo }),
}
