import type { IntegrationModule } from '../types.js'
import type { CompetitorSource } from '../competitor/types.js'
import { createAmazonMxSource, type AmazonMxConfig } from './index.js'

/**
 * The Amazon MX integration as a registry module (plan §3.3). A per-tenant
 * `ctx.integration('amazon-mx')` competitor source: `create(config)` is the same
 * `createAmazonMxSource` the worker's provider wiring calls with each tenant's
 * resolved `${PREFIX}_AMAZON_MX_*` config. `create` throws when disabled, which
 * the resolver turns into the canonical "not configured" — the workflow then
 * omits the source (fail-soft). Provider key is KEBAB ('amazon-mx').
 */
export const amazonMxModule: IntegrationModule<CompetitorSource, AmazonMxConfig> = {
  descriptor: {
    id: 'amazon-mx',
    displayName: 'Amazon MX',
    category: 'competitor',
    secretKeys: ['AMAZON_MX_ENABLED', 'AMAZON_MX_PROXY_URL', 'AMAZON_MX_USER_AGENT'],
  },
  create: (config) => createAmazonMxSource(config),
}
