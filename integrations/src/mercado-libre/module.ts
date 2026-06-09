import type { IntegrationModule } from '../types.js'
import {
  createMercadoLibreClient,
  type MercadoLibreClient,
  type MercadoLibreConfig,
} from './index.js'

/**
 * The Mercado Libre integration as a registry module. Per-tenant
 * `ctx.integration('mercado-libre')` provider (D2): `create(config)` is the same
 * `createMercadoLibreClient` the worker's provider wiring calls with each
 * tenant's resolved tokens. Provider key is KEBAB ('mercado-libre').
 */
export const mercadoLibreModule: IntegrationModule<MercadoLibreClient, MercadoLibreConfig> = {
  descriptor: {
    id: 'mercado-libre',
    displayName: 'Mercado Libre MX',
    category: 'marketplace',
    secretKeys: [
      'ML_ACCESS_TOKEN',
      'ML_REFRESH_TOKEN',
      'ML_CLIENT_ID',
      'ML_CLIENT_SECRET',
      'ML_REDIRECT_URI',
    ],
  },
  create: (config) => createMercadoLibreClient(config),
}
