/**
 * Extraction credit pricing.
 *
 * An extraction is charged per BLOCK of files. The block size is the plan limit
 * `files_per_credit`, read from `plans.limits` at runtime — nothing here
 * hardcodes a per-plan number.
 *
 *   cost = ceil(fileCount / filesPerCredit), minimum 1
 *
 * `null` (or a non-positive block size) means a flat 1 credit per extraction.
 *
 * ⚠️ This mirrors `public.extraction_credit_cost` in
 * supabase/migrations/0027_tiered_extraction_credits.sql. The database is what
 * actually bills; this exists so the UI can quote the price before the run.
 * Keep the two in step.
 */
import type { PlanLimits } from '@/types/database'

/**
 * CSV downloads are free on every plan — credits buy extraction, not delivery.
 * See the rationale in `getDownloadUrlAction` (lib/jobs/actions.ts).
 */
export const EXPORT_CREDIT_COST = 0

export function creditsForFiles(
  fileCount: number,
  filesPerCredit: number | null,
): number {
  const files = Math.max(0, Math.trunc(fileCount))
  if (filesPerCredit === null || filesPerCredit <= 0) return 1
  return Math.max(1, Math.ceil(files / filesPerCredit))
}

export function extractionCreditCost(
  fileCount: number,
  limits: PlanLimits | null,
): number {
  return creditsForFiles(fileCount, limits?.files_per_credit ?? null)
}
