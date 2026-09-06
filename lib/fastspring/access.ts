import type { FastSpringSubscriptionState } from '@/lib/fastspring/types'

/**
 * FastSpring keeps a canceled subscription usable until the period the customer
 * already paid for runs out: `state: 'canceled'` arrives with `active: true`,
 * and only `subscription.deactivated` flips `active` to false.
 *
 * Access therefore follows the `active` flag, and a cancellation scheduled for
 * the end of the period never revokes an otherwise paid subscription. `overdue`
 * is denied even while FastSpring dunning keeps the record active.
 *
 * This mirrors `public.fastspring_subscription_grants_access` in SQL. Both must
 * change together.
 */
export function fastSpringSubscriptionGrantsAccess(
  state: FastSpringSubscriptionState | string,
  active: boolean,
): boolean {
  return active && (state === 'active' || state === 'trial' || state === 'canceled')
}
