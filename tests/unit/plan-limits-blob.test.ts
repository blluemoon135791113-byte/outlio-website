/**
 * A malformed plan must not take down the plans page for everybody else.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ PRODUCTION'S `agency` BLOB IS MISSING `credits_per_month` ENTIRELY.    ║
 * ║                                                                           ║
 * ║  It is a REQUIRED key — no `.optional()`, no `.catch()` — so `toPlan`      ║
 * ║  throws on that row. Today the plan is `is_active = false` with zero       ║
 * ║  profiles on it, so nothing is broken and nobody has noticed.             ║
 * ║                                                                           ║
 * ║  ⚠️ THE TRIGGER IS ONE BOOLEAN. `listActivePlans` maps `toPlan` over every ║
 * ║  active row and one throw rejects the whole call — so the moment somebody  ║
 * ║  flips `agency.is_active` to true, /admin and /dashboard/access break for  ║
 * ║  EVERY user, not just agency ones. The blast radius is the whole product   ║
 * ║  and the trigger is an admin change that looks completely safe.           ║
 * ║                                                                           ║
 * ║  ⚠️ SKIPPING IS FAIL-CLOSED, WHICH IS WHY IT IS ALLOWED HERE AND NOWHERE   ║
 * ║  ELSE. A dropped row cannot be seen or bought. DEFAULTING its limits       ║
 * ║  would be fail-OPEN — it would invent an allowance nobody set, which is    ║
 * ║  exactly what `planLimitsSchema`'s "fail loudly" comment forbids.         ║
 * ║  `getPlanById` and `getPlanByKey` therefore still throw: an access         ║
 * ║  decision made against a plan we cannot read is not a decision.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { planLimitsSchema } from '@/lib/limits/plans'

/**
 * The literal blobs in production on 2026-09-05, verbatim.
 *
 * ⚠️ COPIED, NOT FETCHED. A unit test that queried the database would go green
 * the moment somebody fixed the row by hand — and this file's job is to pin the
 * BEHAVIOUR when a row is malformed, which must hold whether or not this
 * particular row still is.
 */
const AGENCY_BLOB_AS_DEPLOYED = {
  crm_enabled: true,
  email_enabled: true,
  flows_enabled: true,
  storage_bytes: 53687091200,
  hubble_enabled: true,
  retention_days: 730,
  reports_enabled: true,
  leads_per_credit: null,
  exports_per_month: null,
  records_per_month: 300000,
  extractions_per_day: 100,
  files_per_extraction: 250,
  integrations_enabled: true,
  extractions_per_month: 500,
  records_per_extraction: 100000,
  workspace_member_limit: 25,
  // ⚠️ `credits_per_month` IS ABSENT. That is the defect, reproduced exactly.
}

const CUSTOM_BLOB_AS_DEPLOYED = {
  ...AGENCY_BLOB_AS_DEPLOYED,
  credits_per_month: 1000,
  leads_per_credit: 25,
  retention_days: 365,
}

describe('the production agency blob', () => {
  it('does not parse, and says which key is missing', () => {
    const result = planLimitsSchema.safeParse(AGENCY_BLOB_AS_DEPLOYED)
    expect(result.success, 'the agency blob parses now — has it been fixed?').toBe(false)
    if (result.success) return

    // Naming the key is the whole value of the error. "Invalid input" sends
    // somebody reading a sixteen-key blob by eye.
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('credits_per_month')
  })

  it('parses once the missing key is supplied', () => {
    /*
     * The positive control. Without it, the assertion above would pass just as
     * happily against a schema that rejects EVERYTHING — and a guard that
     * cannot tell a broken blob from a working one is not a guard.
     */
    const repaired = { ...AGENCY_BLOB_AS_DEPLOYED, credits_per_month: 3000 }
    expect(planLimitsSchema.safeParse(repaired).success).toBe(true)
  })

  it('the other live plans parse today', () => {
    expect(planLimitsSchema.safeParse(CUSTOM_BLOB_AS_DEPLOYED).success).toBe(true)
  })
})

describe('credits_per_month is required on purpose', () => {
  it('is not defaulted to a number nobody chose', () => {
    /*
     * ⚠️ THE TEMPTING WRONG FIX. Adding `.catch(0).default(0)` would make the
     * agency row parse and the symptom vanish — and every future plan seeded
     * without an allowance would silently sell zero credits, or, with any other
     * default, an allowance no human ever priced.
     *
     * `credits_per_month` is what `consume_credit`, `credit_balance` and
     * `grant_fastspring_period_credits` all read. It is a PRICING number. It
     * has to be stated.
     */
    const withoutCredits = { ...AGENCY_BLOB_AS_DEPLOYED }
    expect(
      planLimitsSchema.safeParse(withoutCredits).success,
      'credits_per_month acquired a default — an unpriced plan now sells silently',
    ).toBe(false)
  })

  it('accepts an explicit null, which means unlimited', () => {
    // Unlimited is a real, stateable answer. The rule is that it must be
    // STATED, not that the key must be a number.
    const unlimited = { ...AGENCY_BLOB_AS_DEPLOYED, credits_per_month: null }
    expect(planLimitsSchema.safeParse(unlimited).success).toBe(true)
  })
})
