/**
 * Extraction credit pricing.
 *
 * An extraction is charged per BLOCK of LEADS, aggregated across the whole run.
 * The block size is the plan limit `leads_per_credit`, read from `plans.limits`
 * at runtime — nothing here hardcodes a per-plan number.
 *
 *   cost = ceil(leadCount / leadsPerCredit), minimum 1
 *
 * Aggregation across the run is the point: three files holding 10 leads each is
 * 30 leads = 2 credits, NOT 3 credits. Credits are consumed by leads, never by
 * files.
 *
 * `null` (or a non-positive block size) means a flat 1 credit per extraction.
 *
 * ⚠️ This mirrors `public.lead_credit_cost` in
 * supabase/migrations/0030_lead_based_credits.sql. The database is what
 * actually bills; this exists so the UI can quote a price. Keep the two in
 * step.
 *
 * ⚠️ A lead count does not exist until the files are parsed, so this CANNOT be
 * used to charge at upload time. The charge happens in the worker, via
 * `charge_extraction_leads`. Anything here is an estimate for display.
 */
import type { PlanLimits } from '@/types/database'

/**
 * CSV downloads are free on every plan — credits buy extraction, not delivery.
 * See the rationale in `getDownloadUrlAction` (lib/jobs/actions.ts).
 */
export const EXPORT_CREDIT_COST = 0

/**
 * Typical leads on one saved Sales Navigator results page. Used only to
 * estimate a run's cost before it is parsed; the real charge uses the actual
 * parsed count.
 */
export const TYPICAL_LEADS_PER_PAGE = 25

export function creditsForLeads(
  leadCount: number,
  leadsPerCredit: number | null,
): number {
  const leads = Math.max(0, Math.trunc(leadCount))
  if (leadsPerCredit === null || leadsPerCredit <= 0) return 1
  return Math.max(1, Math.ceil(leads / leadsPerCredit))
}

export function extractionCreditCost(
  leadCount: number,
  limits: PlanLimits | null,
): number {
  return creditsForLeads(leadCount, limits?.leads_per_credit ?? null)
}

/**
 * Upper-bound estimate for a run before anything is parsed, assuming every file
 * is a full page. Quote it as a maximum, never as the price.
 */
export function estimatedCreditCostForFiles(
  fileCount: number,
  leadsPerCredit: number | null,
): number {
  const files = Math.max(0, Math.trunc(fileCount))
  return creditsForLeads(files * TYPICAL_LEADS_PER_PAGE, leadsPerCredit)
}
