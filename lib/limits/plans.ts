import 'server-only'

/**
 * Plan limits.
 *
 * EVERY limit is read from `plans.limits` (jsonb) at runtime.
 * NOTHING here hardcodes a numeric limit — see CLAUDE.md.
 *
 * `null` means unlimited.
 */
import { z } from 'zod'

import { createAdminClient } from '@/lib/supabase/admin'
import type { PlanKey, PlanLimits, PlanRow } from '@/types/database'

const nullableInt = z.number().int().nonnegative().nullable()

/**
 * Validates what the database actually returned. A malformed `limits` blob is a
 * configuration error and must fail loudly rather than silently granting
 * unlimited usage.
 */
export const planLimitsSchema = z.object({
  files_per_extraction: nullableInt,
  // Leads billed per credit. Absent on legacy tiers seeded before 0030 — those
  // bill a flat 1 credit per run.
  leads_per_credit: nullableInt.optional().default(null),
  extractions_per_day: nullableInt,
  extractions_per_month: nullableInt,
  records_per_extraction: nullableInt,
  records_per_month: nullableInt,
  storage_bytes: nullableInt,
  exports_per_month: nullableInt,
  retention_days: nullableInt,
  /*
   * Contact lookups per month.
   *
   * ⚠️ THE ONLY THING STANDING BETWEEN AUTO-ENRICHMENT AND A RUNAWAY BILL.
   * Every lookup costs real money at Prospeo or Apollo, and enrichment runs
   * automatically after each extraction — so an account that uploads all day
   * spends all day. `optional()` with a conservative default rather than
   * `null`: absent must mean "a safe cap", never "unlimited". A plan that
   * genuinely has no cap must say so with an explicit null.
   */
  contact_enrichments_per_month: nullableInt.catch(250).default(250),
})

export type Plan = {
  id: string
  key: PlanKey
  name: string
  isActive: boolean
  limits: PlanLimits
}

function toPlan(row: PlanRow): Plan {
  const parsed = planLimitsSchema.safeParse(row.limits)
  if (!parsed.success) {
    throw new Error(
      `Plan "${row.key}" has a malformed limits blob: ${parsed.error.message}`,
    )
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    isActive: row.is_active,
    limits: parsed.data,
  }
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle()

  if (error) throw new Error(`getPlanById failed: ${error.message}`)
  return data ? toPlan(data as PlanRow) : null
}

export async function getPlanByKey(key: PlanKey): Promise<Plan | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('key', key)
    .maybeSingle()

  if (error) throw new Error(`getPlanByKey failed: ${error.message}`)
  return data ? toPlan(data as PlanRow) : null
}

export async function listActivePlans(): Promise<Plan[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`listActivePlans failed: ${error.message}`)
  return (data as PlanRow[]).map(toPlan)
}

/** `null` limit means unlimited. */
export function isWithinLimit(limit: number | null, current: number): boolean {
  if (limit === null) return true
  return current < limit
}

/** Remaining allowance, or `null` when unlimited. */
export function remaining(limit: number | null, current: number): number | null {
  if (limit === null) return null
  return Math.max(0, limit - current)
}
