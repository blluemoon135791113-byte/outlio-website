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
  /*
   * The monthly extraction-credit allowance, and the number the whole credit
   * system is built on — `consume_credit`, `credit_balance` and
   * `grant_fastspring_period_credits` all read it from this blob. It was
   * absent from this schema (so silently stripped) until FastSpring needed to
   * report a plan's allowance; `null` means unlimited.
   */
  credits_per_month: nullableInt,
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
   * ⚠️ ONLY MEANINGFUL WHEN PAID PROVIDERS ARE EXPLICITLY ENABLED. Automatic
   * enrichment is free-only and cannot produce a contact at all, so today this
   * caps nothing. It stays because the moment someone sets
   * OUTLIO_ALLOW_PAID_PROVIDERS this becomes the bound on a real bill, and a
   * cap that has to be invented at that point is a cap nobody sets.
   *
   * Absent means a safe number, never unlimited. Unlimited has to be stated.
   */
  contact_enrichments_per_month: nullableInt.catch(250).default(250),

  /*
   * ── Platform module entitlements (Ledger D5) ────────────────────────────
   *
   * The GTM platform's modules are entitled here rather than in a new table,
   * because `plans.limits` is already THE runtime source of every allowance
   * and CLAUDE.md forbids a second one.
   *
   * A workspace feature flag can additionally switch a module OFF, never on:
   * the effective answer is `entitlement AND flag`. See
   * `lib/workspaces/entitlements.ts`.
   *
   * Defaults describe TODAY's product, so existing plan rows — none of which
   * carry these keys yet — keep behaving exactly as they do now:
   *   • crm/email/flows/reports  → false. Not built. Nothing to grant.
   *   • integrations             → true.  Shipped and in use.
   *   • hubble                   → true.  The real Hubble boundary remains
   *     `requireHubbleAccess`, which resolves the paid tier from
   *     fastspring_subscriptions. Defaulting false here would silently revoke
   *     Hubble from every paying customer on deploy.
   */
  crm_enabled: z.boolean().catch(false).default(false),
  email_enabled: z.boolean().catch(false).default(false),
  flows_enabled: z.boolean().catch(false).default(false),
  reports_enabled: z.boolean().catch(false).default(false),
  integrations_enabled: z.boolean().catch(true).default(true),
  hubble_enabled: z.boolean().catch(true).default(true),

  /*
   * Seats per workspace, owner included. `null` is unlimited.
   *
   * Defaults to 1 — one person, which is exactly what every plan sells today.
   * ⚠️ No plan can be invited into until a seat count is set on it. That is a
   * PRICING decision, not an engineering one, and is recorded as Ledger Q6.
   * Support can widen a single account meanwhile via
   * `workspaces.member_limit_override`.
   */
  workspace_member_limit: nullableInt.catch(1).default(1),
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
