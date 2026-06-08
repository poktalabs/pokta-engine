import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasProvider, makeIntegrationResolver, unregisterProvider } from './integration-resolver'
// Importing the module runs its side-effect: register the env-backed factories.
import { registerEngineProviders } from './provider-config'

/**
 * T9 — the env-backed per-tenant provider wiring (D2 / D9). Verifies the seam
 * between engine env and the resolver:
 *   - importing the module registers shopify + mercadolibre factories
 *   - a configured tenant (MIPASE_* present) resolves a real client
 *   - an unconfigured tenant fail-softs into the resolver's "not configured" throw
 *   - asking for one provider never reads the OTHER provider's env (blast radius)
 */

const MIPASE_VARS = [
  'MIPASE_SHOPIFY_BASE_URL',
  'MIPASE_SHOPIFY_ACCESS_TOKEN',
  'MIPASE_ML_ACCESS_TOKEN',
  'MIPASE_ML_REFRESH_TOKEN',
  'MIPASE_ML_CLIENT_ID',
  'MIPASE_ML_CLIENT_SECRET',
  'MIPASE_ML_REDIRECT_URI',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of MIPASE_VARS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  // The import already registered once; re-register so each test starts clean
  // regardless of registry mutations elsewhere (idempotent — last wins).
  registerEngineProviders()
})

afterEach(() => {
  for (const k of MIPASE_VARS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('registerEngineProviders (T9)', () => {
  it('registers both M1 provider factories with the resolver', () => {
    expect(hasProvider('shopify')).toBe(true)
    expect(hasProvider('mercadolibre')).toBe(true)
  })

  it('resolves a Shopify client for a configured mi-pase tenant', () => {
    process.env.MIPASE_SHOPIFY_BASE_URL = 'https://mi-pase-dev.myshopify.com/admin/api/2024-04'
    process.env.MIPASE_SHOPIFY_ACCESS_TOKEN = 'shpat_test'

    const client = makeIntegrationResolver('mi-pase')('shopify')
    expect(client).toBeDefined()
    expect(typeof (client as { getCatalog: unknown }).getCatalog).toBe('function')
    expect(typeof (client as { updateVariantPrice: unknown }).updateVariantPrice).toBe('function')
  })

  it('resolves a Mercado Libre client for a configured mi-pase tenant', () => {
    process.env.MIPASE_ML_ACCESS_TOKEN = 'ml_test'

    const client = makeIntegrationResolver('mi-pase')('mercadolibre')
    expect(client).toBeDefined()
    expect((client as { configured: boolean }).configured).toBe(true)
    expect(typeof (client as { search: unknown }).search).toBe('function')
  })

  it('Shopify throws "not configured" when this tenant has no Shopify env', () => {
    // ML configured, Shopify NOT — proves per-provider isolation.
    process.env.MIPASE_ML_ACCESS_TOKEN = 'ml_test'
    expect(() => makeIntegrationResolver('mi-pase')('shopify')).toThrow(
      /not configured for consumer 'mi-pase'/i,
    )
  })

  it('Mercado Libre throws "not configured" when this tenant has no ML env', () => {
    process.env.MIPASE_SHOPIFY_BASE_URL = 'https://mi-pase-dev.myshopify.com/admin/api/2024-04'
    process.env.MIPASE_SHOPIFY_ACCESS_TOKEN = 'shpat_test'
    expect(() => makeIntegrationResolver('mi-pase')('mercadolibre')).toThrow(
      /not configured for consumer 'mi-pase'/i,
    )
  })

  it('an unmapped consumer is unconfigured for every provider', () => {
    process.env.MIPASE_SHOPIFY_BASE_URL = 'https://x/admin/api/2024-04'
    process.env.MIPASE_SHOPIFY_ACCESS_TOKEN = 'shpat_test'
    process.env.MIPASE_ML_ACCESS_TOKEN = 'ml_test'

    expect(() => makeIntegrationResolver('unknown-tenant')('shopify')).toThrow(/not configured/i)
    expect(() => makeIntegrationResolver('unknown-tenant')('mercadolibre')).toThrow(/not configured/i)
  })

  it('cleans up after itself (registry restored for downstream tests)', () => {
    // sanity: the seam helper still works against the registered providers
    unregisterProvider('shopify')
    expect(hasProvider('shopify')).toBe(false)
    registerEngineProviders()
    expect(hasProvider('shopify')).toBe(true)
  })
})
