/**
 * Phase 4's two plan defaults, and why each is what it is.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  BOTH ARE DEFAULTS THE OWNER SHOULD OVERRIDE, NOT ANSWERS.               ║
 * ║                                                                           ║
 * ║  `linkedin_enabled` starts false because the module is not built, matching ║
 * ║  how crm/email/flows already default. Which TIER it belongs on is a        ║
 * ║  pricing decision and is deliberately not made in code.                   ║
 * ║                                                                           ║
 * ║  The sender cap falls back to the SEAT count, which is the one that could ║
 * ║  be mistaken for arbitrary and is not: §4.10 defines a sender as one real  ║
 * ║  person performing their own actions, and warns that borrowed or shared    ║
 * ║  accounts are "not the supported way to scale". More senders than seats    ║
 * ║  means somebody is operating an account that is not theirs.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { planLimitsSchema } from '@/lib/limits/plans'
import { resolveSenderLimit } from '@/lib/workspaces/entitlements'

/** A blob with only the keys the schema truly requires. */
const MINIMAL = {
  credits_per_month: 100,
  files_per_extraction: 10,
  extractions_per_day: null,
  extractions_per_month: null,
  records_per_extraction: 1000,
  records_per_month: 2500,
  storage_bytes: 1_000_000,
  exports_per_month: null,
  retention_days: 365,
}

describe('the LinkedIn module is off until somebody turns it on', () => {
  it('defaults to false when the key is absent', () => {
    /*
     * Same posture as crm/email/flows when they were unbuilt: "Not built.
     * Nothing to grant." Granting it by default would put the capability in
     * front of customers before the Action Inbox exists.
     */
    const parsed = planLimitsSchema.parse(MINIMAL)
    expect(parsed.linkedin_enabled).toBe(false)
  })

  it('can be turned on per plan', () => {
    const parsed = planLimitsSchema.parse({ ...MINIMAL, linkedin_enabled: true })
    expect(parsed.linkedin_enabled).toBe(true)
  })

  it('does not throw on a malformed value', () => {
    // `.catch` rather than a hard failure: one bad key must not take down
    // getPlanById, which is the defect the agency plan already demonstrated.
    const parsed = planLimitsSchema.parse({ ...MINIMAL, linkedin_enabled: 'yes' })
    expect(parsed.linkedin_enabled).toBe(false)
  })
})

describe('an unset sender cap means the seat count, never unlimited', () => {
  it('falls back to the workspace seat limit', () => {
    /*
     * ⚠️ THE LOAD-BEARING DEFAULT. A five-seat workspace linking forty senders
     * is the shape §4.10 warns about, and it is what an "unlimited" fallback
     * would have permitted silently.
     */
    expect(resolveSenderLimit({ ...MINIMAL } as never, 5)).toBe(5)
  })

  it('respects an explicit lower cap', () => {
    expect(resolveSenderLimit({ ...MINIMAL, linkedin_senders_max: 2 } as never, 25)).toBe(2)
  })

  it('respects an explicit cap ABOVE the seat count', () => {
    // A deliberate pricing choice is still a choice; the fallback only applies
    // when nobody has made one.
    expect(resolveSenderLimit({ ...MINIMAL, linkedin_senders_max: 40 } as never, 5)).toBe(40)
  })

  it('allows zero, which is not the same as unset', () => {
    // A plan that grants the module but no senders is coherent — and `?? `
    // would have turned this into the seat count.
    expect(resolveSenderLimit({ ...MINIMAL, linkedin_senders_max: 0 } as never, 5)).toBe(0)
  })

  it('passes unlimited seats through as unlimited senders', () => {
    // `null` seats means unlimited, and the cap inherits that rather than
    // inventing a number.
    expect(resolveSenderLimit({ ...MINIMAL } as never, null)).toBeNull()
  })

  it('falls back to the seat count when there is no plan at all', () => {
    expect(resolveSenderLimit(null, 3)).toBe(3)
  })
})
