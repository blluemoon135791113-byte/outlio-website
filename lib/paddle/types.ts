export type BillingInterval = 'month' | 'year'

export interface Tier {
  name: 'Lead Engine' | 'Pro' | 'Pro + Hubble'
  description: string
  features: string[]
  priceId: { month: string; year: string }
  planKey: 'starter' | 'professional' | 'custom'
  featured?: boolean
}

export type PaddleEnvironment = 'production' | 'sandbox'

export type PaddleSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'paused'
  | 'past_due'
  | 'canceled'
