import 'server-only'

import { billingIntervalForProductPath, planKeyForProductPath } from '@/lib/fastspring/config'
import { getPlanByKey } from '@/lib/limits/plans'

export type ProductMapping = {
  productPath: string
  planKey: 'starter' | 'professional' | 'custom' | null
  billingInterval: 'month' | 'year' | null
  creditsPerMonth: number | null
}

/**
 * The server-side product mapping: FastSpring product path → Outlio plan →
 * monthly credit allowance → billing interval.
 *
 * The product path is the ONLY catalog value taken from a webhook. Price,
 * quantity and any credit count in the payload are ignored entirely: the plan
 * comes from the path-to-plan table in `lib/fastspring/config.ts`, which is
 * built from environment variables, and the allowance is read from
 * `plans.limits` at runtime rather than hardcoded.
 *
 * `creditsPerMonth` is returned for logging and reporting. Allocation itself
 * re-reads the allowance inside `grant_fastspring_period_credits`, in the same
 * transaction as the grant, so a stale read here cannot allocate a wrong amount.
 */
export async function resolveProductMapping(
  productPath: string | null,
): Promise<ProductMapping | null> {
  if (!productPath) return null

  const planKey = planKeyForProductPath(productPath)
  const billingInterval = billingIntervalForProductPath(productPath)

  if (!planKey) {
    // A path outside the configured catalog. Reported so it can be logged and
    // investigated; it never grants a plan or credits.
    return { productPath, planKey: null, billingInterval, creditsPerMonth: null }
  }

  const plan = await getPlanByKey(planKey)

  return {
    productPath,
    planKey,
    billingInterval,
    creditsPerMonth: plan?.limits.credits_per_month ?? null,
  }
}
