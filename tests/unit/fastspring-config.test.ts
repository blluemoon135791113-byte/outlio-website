import { afterEach, describe, expect, it } from 'vitest'

import {
  billingIntervalForProductPath,
  countryCodeFromHeader,
  getPricingTiers,
  getStorefront,
  planKeyForProductPath,
} from '@/lib/fastspring/config'

const PRODUCT_ENV = [
  'FASTSPRING_LEAD_ENGINE_MONTH_PRODUCT',
  'FASTSPRING_LEAD_ENGINE_YEAR_PRODUCT',
  'FASTSPRING_PRO_MONTH_PRODUCT',
  'FASTSPRING_PRO_YEAR_PRODUCT',
  'FASTSPRING_PRO_HUBBLE_MONTH_PRODUCT',
  'FASTSPRING_PRO_HUBBLE_YEAR_PRODUCT',
] as const

const originals = new Map<string, string | undefined>(
  [...PRODUCT_ENV, 'NEXT_PUBLIC_FASTSPRING_STOREFRONT'].map((name) => [name, process.env[name]]),
)

function setProducts() {
  process.env.FASTSPRING_LEAD_ENGINE_MONTH_PRODUCT = 'lead-engine-monthly'
  process.env.FASTSPRING_LEAD_ENGINE_YEAR_PRODUCT = 'lead-engine-yearly'
  process.env.FASTSPRING_PRO_MONTH_PRODUCT = 'pro-monthly'
  process.env.FASTSPRING_PRO_YEAR_PRODUCT = 'pro-yearly'
  process.env.FASTSPRING_PRO_HUBBLE_MONTH_PRODUCT = 'pro-hubble-monthly'
  process.env.FASTSPRING_PRO_HUBBLE_YEAR_PRODUCT = 'pro-hubble-yearly'
}

afterEach(() => {
  for (const [name, value] of originals) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('getStorefront', () => {
  it('fails loudly when the storefront is absent', () => {
    delete process.env.NEXT_PUBLIC_FASTSPRING_STOREFRONT
    expect(() => getStorefront()).toThrow('NEXT_PUBLIC_FASTSPRING_STOREFRONT')
  })

  it('rejects a bare store name with no storefront path', () => {
    process.env.NEXT_PUBLIC_FASTSPRING_STOREFRONT = 'husnain.onfastspring.com'
    expect(() => getStorefront()).toThrow('store.onfastspring.com/storefront-path')
  })

  it('rejects a full URL', () => {
    process.env.NEXT_PUBLIC_FASTSPRING_STOREFRONT =
      'https://husnain.onfastspring.com/popup-husnain'
    expect(() => getStorefront()).toThrow('store.onfastspring.com/storefront-path')
  })

  it('flags a test storefront so test money cannot look live', () => {
    process.env.NEXT_PUBLIC_FASTSPRING_STOREFRONT = 'husnain.test.onfastspring.com/popup-husnain'
    expect(getStorefront()).toEqual({
      storefront: 'husnain.test.onfastspring.com/popup-husnain',
      isTest: true,
    })
  })

  it('reports a live storefront as live', () => {
    process.env.NEXT_PUBLIC_FASTSPRING_STOREFRONT = 'husnain.onfastspring.com/popup-husnain'
    expect(getStorefront()).toEqual({
      storefront: 'husnain.onfastspring.com/popup-husnain',
      isTest: false,
    })
  })
})

describe('product path configuration', () => {
  it('rejects a value that is a URL rather than a path', () => {
    setProducts()
    process.env.FASTSPRING_PRO_MONTH_PRODUCT = 'https://example.com/pro-monthly'
    expect(() => getPricingTiers()).toThrow('FASTSPRING_PRO_MONTH_PRODUCT')
  })

  it('fails loudly on a missing product path', () => {
    setProducts()
    delete process.env.FASTSPRING_PRO_HUBBLE_YEAR_PRODUCT
    expect(() => getPricingTiers()).toThrow('FASTSPRING_PRO_HUBBLE_YEAR_PRODUCT')
  })

  it('maps each configured path back to its plan and interval', () => {
    setProducts()
    expect(planKeyForProductPath('pro-hubble-yearly')).toBe('custom')
    expect(billingIntervalForProductPath('pro-hubble-yearly')).toBe('year')
    expect(planKeyForProductPath('lead-engine-monthly')).toBe('starter')
    expect(billingIntervalForProductPath('lead-engine-monthly')).toBe('month')
  })

  it('returns null for a path outside the catalog', () => {
    setProducts()
    expect(planKeyForProductPath('some-other-product')).toBeNull()
    expect(billingIntervalForProductPath('some-other-product')).toBeNull()
  })
})

describe('countryCodeFromHeader', () => {
  it('normalizes a valid Vercel country code', () => {
    expect(countryCodeFromHeader(' gb ')).toBe('GB')
  })

  it.each([null, '', 'OTHERS', 'unknown', 'USA', '1A'])('omits invalid country %s', (value) => {
    expect(countryCodeFromHeader(value)).toBeUndefined()
  })
})
