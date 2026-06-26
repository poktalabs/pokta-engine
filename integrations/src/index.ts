/**
 * THE INTEGRATION REGISTRY — single source for every integration client.
 *
 * Mirrors `packages/workflows/src/index.ts`: a static `modules` array →
 * `Map<id, module>` → `getIntegration(id)` / `listIntegrations()`. Each module
 * (under `src/<provider>/module.ts`) exposes an {@link IntegrationDescriptor}
 * (identity + secret keys) plus a `create(config)` factory.
 *
 * This file ALSO re-exports each integration's `create*` factory + client/config
 * TYPES so callers import everything from `@pokta-engine/integrations` (the only
 * import specifier for integrations now). And it OWNS the contract type registry:
 * the `IntegrationClients` declaration-merge below teaches `ctx.integration(name)`
 * the concrete client type for each per-tenant provider.
 */

import type { IntegrationDescriptor, IntegrationModule } from './types.js'

import { notionModule } from './notion/module.js'
import { resendModule } from './resend/module.js'
import { shopifyModule } from './shopify/module.js'
import { mercadoLibreModule } from './mercado-libre/module.js'
import { amazonMxModule } from './amazon-mx/module.js'

// ── Registry (mirrors the workflow registry) ─────────────────────────────────

const modules: IntegrationModule[] = [
  notionModule as IntegrationModule,
  resendModule as IntegrationModule,
  shopifyModule as IntegrationModule,
  mercadoLibreModule as IntegrationModule,
  amazonMxModule as IntegrationModule,
]

export const registry: ReadonlyMap<string, IntegrationModule> = new Map(
  modules.map((m) => [m.descriptor.id, m]),
)

export function getIntegration(id: string): IntegrationModule | undefined {
  return registry.get(id)
}

export function listIntegrations(): IntegrationDescriptor[] {
  return [...registry.values()].map((m) => m.descriptor)
}

// ── Type exports ─────────────────────────────────────────────────────────────

export type { IntegrationDescriptor, IntegrationModule } from './types.js'

// ── The generic per-tenant resolver (moved here from the worker) ─────────────

export {
  registerProvider,
  unregisterProvider,
  hasProvider,
  makeIntegrationResolver,
  type ProviderFactory,
} from './resolver.js'

// ── Re-exports: notion ───────────────────────────────────────────────────────

export {
  commitCrmEntry,
  notionConfigured,
  notionInfo,
  type CrmRow,
  type NotionPage,
} from './notion/index.js'

// ── Re-exports: resend ───────────────────────────────────────────────────────

export {
  sendEmail,
  resendConfigured,
  resendInfo,
  type EmailInput,
  type SentMessage,
} from './resend/index.js'

// ── Re-exports: shopify ──────────────────────────────────────────────────────

export {
  createShopifyClient,
  ShopifyApiError,
  type ShopifyClient,
  type ShopifyConfig,
  type ShopifyVariant,
  type ShopifyProduct,
  type VariantPriceUpdate,
  type UpdatedVariant,
  type Catalog,
} from './shopify/index.js'

// ── Re-exports: mercado-libre ────────────────────────────────────────────────

export {
  createMercadoLibreClient,
  refreshAccessToken,
  type MercadoLibreClient,
  type MercadoLibreConfig,
  type SearchOptions,
  type MLSearchResult,
  type MLFailureReason,
  type MLOAuthConfig,
  type MLTokenResponse,
} from './mercado-libre/index.js'

// ── Re-exports: competitor seam ──────────────────────────────────────────────

export type { CompetitorSource, CompetitorQuote } from './competitor/types.js'
export { mercadoLibreSource } from './mercado-libre/competitor-source.js'

// ── Re-exports: amazon-mx (competitor source) ────────────────────────────────

export {
  createAmazonMxSource,
  parseAmazonSearchHtml,
  parseMxnPrice,
  amazonSearchUrl,
  AMAZON_MX_SOURCE_ID,
  type AmazonMxConfig,
  type AmazonParseResult,
  type AmazonParseReason,
} from './amazon-mx/index.js'

// ── Module factory re-exports ────────────────────────────────────────────────

export { notionModule } from './notion/module.js'
export { resendModule } from './resend/module.js'
export { shopifyModule } from './shopify/module.js'
export { mercadoLibreModule } from './mercado-libre/module.js'
export { amazonMxModule } from './amazon-mx/module.js'

// ── Contract type registry (OWNED here, D2) ──────────────────────────────────

import type { ShopifyClient } from './shopify/index.js'
import type { MercadoLibreClient } from './mercado-libre/index.js'
import type { CompetitorSource } from './competitor/types.js'

/**
 * Declaration merging (D2): teach the contract's `IntegrationClients` map the
 * concrete client type for each per-tenant provider. After this,
 * `ctx.integration('shopify')` is typed `ShopifyClient` and
 * `ctx.integration('mercado-libre')` is typed `MercadoLibreClient` for every
 * workflow, WITHOUT the contract package importing this package. The integrations
 * package OWNS this registry (moved out of the worker's provider-config).
 */
declare module '@pokta-engine/contract' {
  interface IntegrationClients {
    shopify: ShopifyClient
    'mercado-libre': MercadoLibreClient
    /** The Amazon MX competitor source (PR2). `ctx.integration('amazon-mx')`. */
    'amazon-mx': CompetitorSource
  }
}
