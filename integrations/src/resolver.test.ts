import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hasProvider,
  makeIntegrationResolver,
  registerProvider,
  unregisterProvider,
} from '@pokta-engine/integrations'

// Stub provider clients — stand-ins for the shopify + mercado-libre modules,
// which plug into the same registry seam via the worker's provider wiring.
interface ShopifyStub {
  provider: 'shopify'
  consumerId: string
}
interface MlStub {
  provider: 'mercado-libre'
  consumerId: string
}

afterEach(() => {
  // Reset the module-level registry between tests so registrations don't leak.
  unregisterProvider()
})

describe('makeIntegrationResolver (T2 / D2)', () => {
  it('returns ONLY the requested provider, scoped to the run consumer', () => {
    const shopifyFactory = vi.fn(
      (consumerId: string): ShopifyStub => ({ provider: 'shopify', consumerId }),
    )
    const mlFactory = vi.fn((consumerId: string): MlStub => ({ provider: 'mercado-libre', consumerId }))
    registerProvider('shopify', shopifyFactory)
    registerProvider('mercado-libre', mlFactory)

    const integration = makeIntegrationResolver('mi-pase')
    // `as unknown as` because the integrations package declaration-merges the REAL
    // ShopifyClient onto IntegrationClients['shopify']; these tests use a
    // structural stub, which no longer overlaps that concrete type.
    const shopify = integration('shopify') as unknown as ShopifyStub

    expect(shopify).toEqual({ provider: 'shopify', consumerId: 'mi-pase' })
    // The requested provider's factory ran with the run's consumer...
    expect(shopifyFactory).toHaveBeenCalledTimes(1)
    expect(shopifyFactory).toHaveBeenCalledWith('mi-pase')
    // ...and NO other provider was built/touched (narrow blast radius, Codex #5).
    expect(mlFactory).not.toHaveBeenCalled()
  })

  it('is lazy — building the accessor touches no provider until one is asked for', () => {
    const shopifyFactory = vi.fn((consumerId: string): ShopifyStub => ({ provider: 'shopify', consumerId }))
    registerProvider('shopify', shopifyFactory)

    makeIntegrationResolver('mi-pase')
    expect(shopifyFactory).not.toHaveBeenCalled()
  })

  it('scopes resolution by consumerId — each resolver passes its own consumer', () => {
    const factory = vi.fn((consumerId: string): ShopifyStub => ({ provider: 'shopify', consumerId }))
    registerProvider('shopify', factory)

    const a = makeIntegrationResolver('mi-pase')('shopify') as unknown as ShopifyStub
    const b = makeIntegrationResolver('other-tenant')('shopify') as unknown as ShopifyStub

    expect(a.consumerId).toBe('mi-pase')
    expect(b.consumerId).toBe('other-tenant')
    expect(factory).toHaveBeenNthCalledWith(1, 'mi-pase')
    expect(factory).toHaveBeenNthCalledWith(2, 'other-tenant')
  })

  it('throws when the requested provider is not registered', () => {
    const integration = makeIntegrationResolver('mi-pase')
    expect(() => integration('shopify')).toThrow(/not registered/i)
  })

  it('throws "not configured" when the provider factory throws (unconfigured tenant)', () => {
    registerProvider('shopify', (consumerId: string): ShopifyStub => {
      throw new Error(`MIPASE_SHOPIFY_TOKEN missing for ${consumerId}`)
    })

    const integration = makeIntegrationResolver('mi-pase')
    expect(() => integration('shopify')).toThrow(/not configured for consumer 'mi-pase'/i)
    // the underlying detail is preserved for debugging
    expect(() => integration('shopify')).toThrow(/MIPASE_SHOPIFY_TOKEN missing/)
  })

  it('throws "not configured" when the provider factory returns null', () => {
    registerProvider('shopify', () => null)
    const integration = makeIntegrationResolver('mi-pase')
    expect(() => integration('shopify')).toThrow(/not configured for consumer 'mi-pase'/i)
  })

  it('asking for one provider never invokes a co-registered provider factory', () => {
    const shopifyFactory = vi.fn((c: string): ShopifyStub => ({ provider: 'shopify', consumerId: c }))
    const mlFactory = vi.fn((c: string): MlStub => {
      throw new Error(`ML unconfigured for ${c}`)
    })
    registerProvider('shopify', shopifyFactory)
    registerProvider('mercado-libre', mlFactory)

    const integration = makeIntegrationResolver('mi-pase')
    expect(() => integration('shopify')).not.toThrow()
    // mercado-libre's (throwing) factory was never consulted
    expect(mlFactory).not.toHaveBeenCalled()
  })
})

describe('provider registry seam', () => {
  it('hasProvider reflects registration without building a client', () => {
    const factory = vi.fn((c: string): ShopifyStub => ({ provider: 'shopify', consumerId: c }))
    expect(hasProvider('shopify')).toBe(false)
    registerProvider('shopify', factory)
    expect(hasProvider('shopify')).toBe(true)
    expect(factory).not.toHaveBeenCalled()
  })

  it('unregisterProvider(name) removes a single provider', () => {
    registerProvider('shopify', (c: string): ShopifyStub => ({ provider: 'shopify', consumerId: c }))
    registerProvider('mercado-libre', (c: string): MlStub => ({ provider: 'mercado-libre', consumerId: c }))
    unregisterProvider('shopify')
    expect(hasProvider('shopify')).toBe(false)
    expect(hasProvider('mercado-libre')).toBe(true)
  })

  it('re-registering a name overrides the prior factory (last wins)', () => {
    registerProvider('shopify', () => ({ provider: 'shopify', consumerId: 'v1' }) as ShopifyStub)
    registerProvider('shopify', () => ({ provider: 'shopify', consumerId: 'v2' }) as ShopifyStub)
    const client = makeIntegrationResolver('ignored')('shopify') as unknown as ShopifyStub
    expect(client.consumerId).toBe('v2')
  })
})
