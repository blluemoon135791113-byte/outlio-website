export type BillingInterval = 'month' | 'year'

export interface Tier {
  name: 'Lead Engine' | 'Pro' | 'Pro + Hubble'
  description: string
  features: string[]
  /** FastSpring product paths, not IDs. These are the storefront path slugs. */
  productPath: { month: string; year: string }
  planKey: 'starter' | 'professional' | 'custom'
  featured?: boolean
}

/**
 * FastSpring subscription states.
 *
 * `canceled` does NOT mean access has ended — the subscription stays paid
 * through its current period and carries `active: true` until FastSpring emits
 * `subscription.deactivated`. See `fastSpringSubscriptionGrantsAccess`.
 */
export type FastSpringSubscriptionState =
  | 'active'
  | 'trial'
  | 'overdue'
  | 'canceled'
  | 'deactivated'
