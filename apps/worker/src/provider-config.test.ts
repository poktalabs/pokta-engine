import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasProvider, makeIntegrationResolver, unregisterProvider } from '@godin-engine/integrations'

/**
 * T9 — the per-tenant provider wiring (D2 / D9), now sourcing the env secret
 * PREFIX from the tenant registry (PR2 T7) instead of a hardcoded ENV_PREFIX map.
 * Verifies the seam between engine env and the resolver:
 *   - importing the module registers shopify + mercado-libre factories
 *   - after `loadTenantSecrets(consumer)` resolves the tenant's registry prefix,
 *     a configured tenant (MIPASE_* present) resolves a real client
 *   - an unconfigured / unresolved tenant fail-softs into "not configured"
 *   - asking for one provider never reads the OTHER provider's env (blast radius)
 *
 * The registry read is MOCKED here: `getTenant('mi-pase')` returns an ACTIVE row
 * with `secretPrefix: 'MIPASE'`; any other id returns undefined (unresolved). This
 * proves the prefix now comes from the registry — not a hardcoded map — without a
 * real DB. No assertion below is weakened; only the prefix source changed.
 */
vi.mock('../../engine-api/src/tenants', () => ({
  getTenant: async (id: string) =>
    id === 'mi-pase' ? { tenantId: 'mi-pase', status: 'active', secretPrefix: 'MIPASE' } : undefined,
  isActive: (row: { status: string }) => row.status === 'active',
}))

// Importing the module runs its side-effect: register the env-backed factories.
const { registerEngineProviders, loadTenantSecrets, __resetProviderConfig } = await import('./provider-config')

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

beforeEach(async () => {
  for (const k of MIPASE_VARS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  // The import already registered once; re-register so each test starts clean
  // regardless of registry mutations elsewhere (idempotent — last wins).
  registerEngineProviders()
  // Resolve mi-pase's secret_prefix ('MIPASE') from the (mocked) registry so the
  // synchronous provider factories can read it — this is the T7 source-of-prefix.
  __resetProviderConfig()
  await loadTenantSecrets('mi-pase')
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
    expect(hasProvider('mercado-libre')).toBe(true)
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

    const client = makeIntegrationResolver('mi-pase')('mercado-libre')
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
    expect(() => makeIntegrationResolver('mi-pase')('mercado-libre')).toThrow(
      /not configured for consumer 'mi-pase'/i,
    )
  })

  it('an unmapped consumer is unconfigured for every provider', () => {
    process.env.MIPASE_SHOPIFY_BASE_URL = 'https://x/admin/api/2024-04'
    process.env.MIPASE_SHOPIFY_ACCESS_TOKEN = 'shpat_test'
    process.env.MIPASE_ML_ACCESS_TOKEN = 'ml_test'

    expect(() => makeIntegrationResolver('unknown-tenant')('shopify')).toThrow(/not configured/i)
    expect(() => makeIntegrationResolver('unknown-tenant')('mercado-libre')).toThrow(/not configured/i)
  })

  it('cleans up after itself (registry restored for downstream tests)', () => {
    // sanity: the seam helper still works against the registered providers
    unregisterProvider('shopify')
    expect(hasProvider('shopify')).toBe(false)
    registerEngineProviders()
    expect(hasProvider('shopify')).toBe(true)
  })
})
