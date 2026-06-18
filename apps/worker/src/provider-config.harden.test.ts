import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeIntegrationResolver } from '@pokta-engine/integrations'

/**
 * PR2 harden regression for the worker secret-prefix path (isolation-panel
 * findings 4 + 5):
 *
 *   (4 / charset) loadTenantSecrets RE-VALIDATES the registry's secret_prefix
 *       against ^[A-Z][A-Z0-9_]*$ before using it to index process.env. A
 *       malformed/foreign prefix (only reachable via an out-of-band write that
 *       bypasses the seed validator + DB UNIQUE) is treated as "no prefix" — the
 *       provider factory fail-softs rather than reaching into another env namespace.
 *
 *   (5 / stale cache) loadTenantSecrets reads the registry FORCE-FRESH (bypassing
 *       the ~60s positive TTL cache) so a tenant disabled <TTL before this run
 *       executes is seen as disabled NOW. The split-brain guard then refuses the
 *       run instead of acting on a stale 'active' snapshot.
 *
 * The registry is faked at the module boundary with a MUTABLE row + a call-count
 * so we can (a) flip a tenant's status mid-test and (b) prove the read is fresh.
 * `getTenant` honors the `forceFresh` opt by always reading the live `row` here
 * (a real cache would otherwise serve the stale snapshot).
 */

type FakeRow = { tenantId: string; status: 'active' | 'pending' | 'disabled'; secretPrefix: string | null }

// One mutable row whose status/prefix tests flip between calls. `reads` counts how
// often the registry was actually hit (proving force-fresh re-reads, not a cache).
const live: { row: FakeRow | undefined; reads: number } = { row: undefined, reads: 0 }

vi.mock('../../engine-api/src/tenants', () => ({
  // A faithful-enough getTenant: a real cache would skip the read on a cache hit;
  // forceFresh must NOT. We model that by counting reads and (since forceFresh is
  // passed by loadTenantSecrets) always returning the LIVE row.
  getTenant: async (id: string, _db?: unknown, _opts?: { forceFresh?: boolean }) => {
    live.reads += 1
    return live.row && live.row.tenantId === id ? live.row : undefined
  },
  isActive: (row: { status: string }) => row.status === 'active',
}))

const { loadTenantSecrets, __resetProviderConfig, registerEngineProviders } = await import('./provider-config')

const ENV_KEYS = [
  'MIPASE_SHOPIFY_BASE_URL',
  'MIPASE_SHOPIFY_ACCESS_TOKEN',
  'mi-pase_SHOPIFY_BASE_URL', // a foreign/lowercase namespace a bad prefix might target
] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  live.row = undefined
  live.reads = 0
  __resetProviderConfig()
  registerEngineProviders()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  __resetProviderConfig()
})

describe('secret_prefix charset re-validation on read (finding 4)', () => {
  it('a malformed prefix (lowercase) is treated as no prefix → factory fail-softs', async () => {
    // An out-of-band write set a lowercase prefix that does NOT match the charset.
    live.row = { tenantId: 'mi-pase', status: 'active', secretPrefix: 'mi-pase' }
    process.env['mi-pase_SHOPIFY_BASE_URL'] = 'https://evil/admin/api/2024-04'
    const res = await loadTenantSecrets('mi-pase')
    // The result reports active (status is fine) but NO usable prefix.
    expect(res.exists).toBe(true)
    expect(res.active).toBe(true)
    expect(res.prefix).toBeNull()
    // The factory must NOT have borrowed the 'mi-pase_*' env namespace.
    expect(() => makeIntegrationResolver('mi-pase')('shopify')).toThrow(/not configured/i)
  })

  it('a well-formed prefix is accepted and usable', async () => {
    live.row = { tenantId: 'mi-pase', status: 'active', secretPrefix: 'MIPASE' }
    process.env.MIPASE_SHOPIFY_BASE_URL = 'https://mi-pase-dev.myshopify.com/admin/api/2024-04'
    process.env.MIPASE_SHOPIFY_ACCESS_TOKEN = 'shpat_ok'
    const res = await loadTenantSecrets('mi-pase')
    expect(res.prefix).toBe('MIPASE')
    expect(makeIntegrationResolver('mi-pase')('shopify')).toBeDefined()
  })
})

describe('force-fresh split-brain guard (finding 5)', () => {
  it('a tenant disabled between two loads is seen as inactive on the SECOND load (no stale cache)', async () => {
    live.row = { tenantId: 'mi-pase', status: 'active', secretPrefix: 'MIPASE' }
    const first = await loadTenantSecrets('mi-pase')
    expect(first.active).toBe(true)

    // Operator disables the tenant in the registry between enqueue and execution.
    live.row = { tenantId: 'mi-pase', status: 'disabled', secretPrefix: 'MIPASE' }
    const second = await loadTenantSecrets('mi-pase')
    // Force-fresh: the guard sees the live 'disabled' status immediately, not a
    // stale 'active' snapshot from the first (cached) read.
    expect(second.active).toBe(false)
  })

  it('every loadTenantSecrets performs a fresh registry read (forceFresh bypasses the TTL cache)', async () => {
    live.row = { tenantId: 'mi-pase', status: 'active', secretPrefix: 'MIPASE' }
    await loadTenantSecrets('mi-pase')
    await loadTenantSecrets('mi-pase')
    await loadTenantSecrets('mi-pase')
    // Three guard calls → three live reads. A cache-served guard would read once.
    expect(live.reads).toBe(3)
  })
})
