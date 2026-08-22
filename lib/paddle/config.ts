import 'server-only'

import type { PaddleEnvironment, Tier } from '@/lib/paddle/types'

const PRICE_ENV = {
  starter: {
    month: 'PADDLE_LEAD_ENGINE_MONTH_PRICE_ID',
    year: 'PADDLE_LEAD_ENGINE_YEAR_PRICE_ID',
  },
  professional: {
    month: 'PADDLE_PRO_MONTH_PRICE_ID',
    year: 'PADDLE_PRO_YEAR_PRICE_ID',
  },
  custom: {
    month: 'PADDLE_PRO_HUBBLE_MONTH_PRICE_ID',
    year: 'PADDLE_PRO_HUBBLE_YEAR_PRICE_ID',
  },
} as const

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

function priceId(name: string): string {
  const value = required(name)
  if (!/^pri_[a-z0-9]+$/i.test(value)) {
    throw new Error(`${name} must be a Paddle price ID beginning with pri_`)
  }
  return value
}

export function getPaddleEnvironment(): PaddleEnvironment {
  const value = required('PADDLE_ENVIRONMENT')
  if (value !== 'production' && value !== 'sandbox') {
    throw new Error('PADDLE_ENVIRONMENT must be exactly "production" or "sandbox"')
  }
  return value
}

export function getPaddleBrowserConfig(): {
  environment: PaddleEnvironment
  token: string
} {
  const environment = getPaddleEnvironment()
  const token = required('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN')
  const expectedPrefix = environment === 'production' ? 'live_' : 'test_'

  if (!token.startsWith(expectedPrefix)) {
    throw new Error(
      `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN must start with ${expectedPrefix} for ${environment}`,
    )
  }

  return { environment, token }
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
      priceId: {
        month: priceId(PRICE_ENV.starter.month),
        year: priceId(PRICE_ENV.starter.year),
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
      priceId: {
        month: priceId(PRICE_ENV.professional.month),
        year: priceId(PRICE_ENV.professional.year),
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
      priceId: {
        month: priceId(PRICE_ENV.custom.month),
        year: priceId(PRICE_ENV.custom.year),
      },
    },
  ]
}

export function planKeyForPriceId(priceIdValue: string): Tier['planKey'] | null {
  const tier = getPricingTiers().find(
    ({ priceId: ids }) => ids.month === priceIdValue || ids.year === priceIdValue,
  )
  return tier?.planKey ?? null
}

export function countryCodeFromHeader(value: string | null): string | undefined {
  const normalized = value?.trim().toUpperCase()
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined
}
