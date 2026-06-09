import type { IntegrationModule } from '../types.js'
import { createShopifyClient, type ShopifyClient, type ShopifyConfig } from './index.js'

/**
 * The Shopify integration as a registry module. Unlike notion/resend, Shopify is
 * a per-tenant `ctx.integration('shopify')` provider (D2): `create(config)` is
 * the same `createShopifyClient` the worker's provider wiring calls with each
 * tenant's resolved config.
 */
export const shopifyModule: IntegrationModule<ShopifyClient, ShopifyConfig> = {
  descriptor: {
    id: 'shopify',
    displayName: 'Shopify Admin',
    category: 'commerce',
    secretKeys: ['SHOPIFY_BASE_URL', 'SHOPIFY_ACCESS_TOKEN'],
  },
  create: (config) => createShopifyClient(config),
}
