import 'server-only'

import type { Tier } from '@/lib/fastspring/types'

const PRODUCT_ENV = {
  starter: {
    month: 'FASTSPRING_LEAD_ENGINE_MONTH_PRODUCT',
    year: 'FASTSPRING_LEAD_ENGINE_YEAR_PRODUCT',
  },
  professional: {
    month: 'FASTSPRING_PRO_MONTH_PRODUCT',
    year: 'FASTSPRING_PRO_YEAR_PRODUCT',
  },
  custom: {
    month: 'FASTSPRING_PRO_HUBBLE_MONTH_PRODUCT',
    year: 'FASTSPRING_PRO_HUBBLE_YEAR_PRODUCT',
  },
} as const

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

function productPath(name: string): string {
  const value = required(name)
  // FastSpring product paths are storefront slugs: letters, digits, and the
  // separators FastSpring permits. Anything else is a mis-pasted product ID.
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    throw new Error(`${name} must be a FastSpring product path, not a product ID or URL`)
  }
  return value
}

/**
 * The `data-storefront` value for the Store Builder Library script, in
 * FastSpring's `store.onfastspring.com/storefront-path` form.
 *
 * A test storefront (`*.test.onfastspring.com`) processes no real money. It is
 * a valid value — the swap to live is one environment variable — but callers
 * that care are told which one they got.
 */
export function getStorefront(): { storefront: string; isTest: boolean } {
  const storefront = required('NEXT_PUBLIC_FASTSPRING_STOREFRONT')

  if (!/^[a-z0-9][a-z0-9.-]*\.onfastspring\.com\/[a-z0-9][a-z0-9._-]*$/i.test(storefront)) {
    throw new Error(
      'NEXT_PUBLIC_FASTSPRING_STOREFRONT must look like "store.onfastspring.com/storefront-path"',
    )
  }

  return { storefront, isTest: /\.test\.onfastspring\.com\//i.test(storefront) }
}

export function getPricingTiers(): Tier[] {
  return [
    {
      name: 'Lead Engine',
      planKey: 'starter',
      description: 'For founders and small teams building a consistent prospecting habit.',
      features: [
        '3-day free trial with 10 credits',
        '100 credits each billing period',
        'Up to 2,500 leads',
        'Duplicate removal and CSV exports',
        '30-day export retention',
      ],
      productPath: {
        month: productPath(PRODUCT_ENV.starter.month),
        year: productPath(PRODUCT_ENV.starter.year),
      },
    },
    {
      name: 'Pro',
      planKey: 'professional',
      description: 'For teams researching and enriching new lead lists every day.',
      features: [
        '3-day free trial with 10 credits',
        '300 credits each billing period',
        'Up to 7,500 leads',
        'Everything in Lead Engine',
        '90-day export retention and priority support',
      ],
      productPath: {
        month: productPath(PRODUCT_ENV.professional.month),
        year: productPath(PRODUCT_ENV.professional.year),
      },
      featured: true,
    },
    {
      name: 'Pro + Hubble',
      planKey: 'custom',
      description: 'For teams that want high-volume extraction plus Hubble intelligence.',
      features: [
        '3-day free trial with 10 credits',
        '1,000 credits each billing period',
        'Up to 25,000 leads',
        'Everything in Pro plus Hubble intelligence',
        '365-day retention and direct support',
      ],
      productPath: {
        month: productPath(PRODUCT_ENV.custom.month),
        year: productPath(PRODUCT_ENV.custom.year),
      },
    },
  ]
}

export function planKeyForProductPath(path: string): Tier['planKey'] | null {
  const tier = getPricingTiers().find(
    ({ productPath: paths }) => paths.month === path || paths.year === path,
  )
  return tier?.planKey ?? null
}

export function billingIntervalForProductPath(path: string): 'month' | 'year' | null {
  for (const tier of getPricingTiers()) {
    if (tier.productPath.month === path) return 'month'
    if (tier.productPath.year === path) return 'year'
  }
  return null
}

export function countryCodeFromHeader(value: string | null): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined
}
