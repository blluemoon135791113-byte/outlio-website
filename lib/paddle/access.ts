import type { PaddleSubscriptionStatus } from '@/lib/paddle/types'

/**
 * A scheduled change is only intent. Paddle access follows the current status,
 * so a future cancel/pause never revokes an otherwise active subscription.
 */
export function paddleSubscriptionGrantsAccess(
  status: PaddleSubscriptionStatus | string,
): boolean {
  return status === 'active' || status === 'trialing'
}

