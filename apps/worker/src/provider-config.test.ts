import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasProvider, makeIntegrationResolver, unregisterProvider } from '@pokta-engine/integrations'

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
// Registry-backed fake: the secret PREFIX is read from each tenant ROW
// (`tenant.secretPrefix`), NOT a hardcoded consumer→prefix map. Multiple tenants
// with DISTINCT prefixes + an INACTIVE tenant + an UNKNOWN id let us prove the
// T7 source-of-prefix swap and the split-brain guard. `getTenant` returns the row
// regardless of status (status-gating is the caller's job).
type FakeRow = { tenantId: string; status: string; secretPrefix: string | null }
const REGISTRY: Record<string, FakeRow> = {
  'mi-pase': { tenantId: 'mi-pase', status: 'active', secretPrefix: 'MIPASE' },
  vino: { tenantId: 'vino', status: 'active', secretPrefix: 'VINO' },
  'disabled-co': { tenantId: 'disabled-co', status: 'disabled', secretPrefix: 'DISABLEDCO' },
  'pending-co': { tenantId: 'pending-co', status: 'pending', secretPrefix: 'PENDINGCO' },
}
vi.mock('../../engine-api/src/tenants', () => ({
  getTenant: async (id: string) => REGISTRY[id],
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
  // VINO_* let the registry-prefix tests prove the prefix is read from the row,
  // not a hardcoded 'mi-pase'→'MIPASE' map.
  'VINO_SHOPIFY_BASE_URL',
  'VINO_SHOPIFY_ACCESS_TOKEN',
  'VINO_ML_ACCESS_TOKEN',
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

/**
 * SECRET_PREFIX block (PR2 §6 / T7). Two claims the plan makes:
 *   1. The worker resolves a tenant's env prefix FROM THE REGISTRY row
 *      (`tenant.secretPrefix`) — NOT a hardcoded ENV_PREFIX map. We prove this by
 *      driving TWO active tenants with DIFFERENT prefixes through the SAME seam:
 *      'mi-pase' reads MIPASE_*, 'vino' reads VINO_* — a hardcoded mi-pase→MIPASE
 *      map could never satisfy the vino case.
 *   2. A run whose tenant is unresolvable or NON-ACTIVE is rejected BEFORE any
 *      side effect (the split-brain guard). `loadTenantSecrets` is that guard: it
 *      returns `{exists, active, prefix}` so the worker can refuse the run, and it
 *      leaves NO usable prefix in the cache for such a tenant, so even if a caller
 *      ignored the result the provider factory would fail-soft ("not configured")
 *      rather than act with a stale/foreign secret prefix.
 */
describe('SECRET_PREFIX — prefix sourced from the registry row (T7)', () => {
  afterEach(() => {
    __resetProviderConfig()
  })

  it("resolves 'mi-pase' env prefix MIPASE from the registry (exists+active+prefix)", async () => {
    const res = await loadTenantSecrets('mi-pase')
    expect(res).toEqual({ exists: true, active: true, prefix: 'MIPASE' })

    process.env.MIPASE_SHOPIFY_BASE_URL = 'https://mi-pase-dev.myshopify.com/admin/api/2024-04'
    process.env.MIPASE_SHOPIFY_ACCESS_TOKEN = 'shpat_mipase'
    const client = makeIntegrationResolver('mi-pase')('shopify')
    expect(client).toBeDefined()
  })

  it("resolves a DIFFERENT tenant ('vino') to its OWN prefix VINO — not a hardcoded map", async () => {
    const res = await loadTenantSecrets('vino')
    expect(res).toEqual({ exists: true, active: true, prefix: 'VINO' })

    // vino's Shopify env is under VINO_* — proving the prefix came from the row.
    process.env.VINO_SHOPIFY_BASE_URL = 'https://vino-dev.myshopify.com/admin/api/2024-04'
    process.env.VINO_SHOPIFY_ACCESS_TOKEN = 'shpat_vino'
    const client = makeIntegrationResolver('vino')('shopify')
    expect(client).toBeDefined()
  })

  it("does NOT read a foreign tenant's env: vino prefix ignores MIPASE_* vars", async () => {
    await loadTenantSecrets('vino')
    // Only MIPASE_* present; vino resolves VINO_* → unconfigured (fail-soft), it
    // must NOT borrow MIPASE_* just because mi-pase is the historical default.
    process.env.MIPASE_SHOPIFY_BASE_URL = 'https://mi-pase-dev.myshopify.com/admin/api/2024-04'
    process.env.MIPASE_SHOPIFY_ACCESS_TOKEN = 'shpat_mipase'
    expect(() => makeIntegrationResolver('vino')('shopify')).toThrow(
      /not configured for consumer 'vino'/i,
    )
  })
})

describe('SECRET_PREFIX — split-brain guard rejects unresolvable/inactive tenants', () => {
  afterEach(() => {
    __resetProviderConfig()
  })

  it('an UNKNOWN tenant resolves to not-exists/not-active with no prefix', async () => {
    const res = await loadTenantSecrets('ghost-tenant')
    expect(res).toEqual({ exists: false, active: false, prefix: null })
  })

  it('a DISABLED tenant exists but is not active — run must be refused', async () => {
    const res = await loadTenantSecrets('disabled-co')
    expect(res.exists).toBe(true)
    expect(res.active).toBe(false)
  })

  it('a PENDING tenant exists but is not active — run must be refused', async () => {
    const res = await loadTenantSecrets('pending-co')
    expect(res.exists).toBe(true)
    expect(res.active).toBe(false)
  })

  it('leaves NO usable prefix for an inactive tenant → factory fail-softs (no side effects)', async () => {
    // Even with the disabled tenant's env present, an inactive tenant must not be
    // able to cause side effects: loadTenantSecrets does NOT cache its prefix, so
    // the synchronous factory throws "not configured" rather than acting.
    process.env.DISABLEDCO_SHOPIFY_BASE_URL = 'https://x/admin/api/2024-04'
    process.env.DISABLEDCO_SHOPIFY_ACCESS_TOKEN = 'shpat_disabled'
    const res = await loadTenantSecrets('disabled-co')
    expect(res.active).toBe(false)
    expect(() => makeIntegrationResolver('disabled-co')('shopify')).toThrow(
      /not configured for consumer 'disabled-co'/i,
    )
    delete process.env.DISABLEDCO_SHOPIFY_BASE_URL
    delete process.env.DISABLEDCO_SHOPIFY_ACCESS_TOKEN
  })

  it('an inactive tenant leaves no USABLE (cached) prefix even though the result reports the row prefix (re-validate before side effects)', async () => {
    // Simulate split-brain: mi-pase was active (prefix cached), then a later
    // loadTenantSecrets for an inactive tenant. The RESULT surfaces the row's
    // configured prefix (so the caller can log/diagnose), but the guard reports
    // active===false and does NOT cache it — so the synchronous factory for that
    // tenant fail-softs instead of acting with the foreign/stale prefix.
    await loadTenantSecrets('mi-pase') // active → cached
    const res = await loadTenantSecrets('disabled-co')
    expect(res.active).toBe(false)
    expect(res.prefix).toBe('DISABLEDCO') // row prefix surfaced...
    // ...but NOT usable: the factory has no cached prefix for disabled-co.
    expect(() => makeIntegrationResolver('disabled-co')('mercado-libre')).toThrow(
      /not configured/i,
    )
  })
})
