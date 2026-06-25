import { describe, expect, it } from 'vitest'
import { getIntegration, listIntegrations } from '@pokta-engine/integrations'

describe('integration registry', () => {
  it('lists the five integration descriptors with stable ids', () => {
    const ids = listIntegrations()
      .map((d) => d.id)
      .sort()
    expect(ids).toEqual(['amazon-mx', 'mercado-libre', 'notion', 'resend', 'shopify'])
  })

  it('getIntegration resolves a descriptor + create factory by id', () => {
    const shopify = getIntegration('shopify')
    expect(shopify?.descriptor.displayName).toBe('Shopify Admin')
    expect(typeof shopify?.create).toBe('function')
    // mercado-libre is the KEBAB provider key
    expect(getIntegration('mercado-libre')?.descriptor.id).toBe('mercado-libre')
    expect(getIntegration('mercadolibre')).toBeUndefined()
    // amazon-mx is the PR2 competitor source, categorised 'competitor'
    expect(getIntegration('amazon-mx')?.descriptor.category).toBe('competitor')
  })
})
