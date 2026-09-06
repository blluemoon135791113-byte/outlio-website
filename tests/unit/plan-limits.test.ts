/**
 * Plan limits, and the one that guards automatic spend.
 *
 * `contact_enrichments_per_month` is the only bound on enrichment that runs
 * without anyone pressing a button. Its default behaviour is therefore a
 * security property, not a convenience: an absent key must mean a safe cap, and
 * never unlimited.
 */
import { describe, expect, it } from 'vitest'

import { planLimitsSchema } from '@/lib/limits/plans'

const BASE = {
  credits_per_month: 100,
  files_per_extraction: 10,
  leads_per_credit: 25,
  extractions_per_day: null,
  extractions_per_month: null,
  records_per_extraction: null,
  records_per_month: 2500,
  storage_bytes: 1073741824,
  exports_per_month: null,
  retention_days: 30,
}

describe('contact_enrichments_per_month', () => {
  it('defaults to a CAP when the key is absent', () => {
    /*
     * ⚠️ THE FAILURE THIS PREVENTS. Every plan in the database predates this
     * key. Defaulting to null — "unlimited" — would have turned automatic
     * enrichment loose on every existing account the moment it shipped, and
     * the first anyone would know is the provider invoice.
     */
    const parsed = planLimitsSchema.parse(BASE)
    expect(parsed.contact_enrichments_per_month).toBe(250)
  })

  it('honours an explicit number', () => {
    expect(
      planLimitsSchema.parse({ ...BASE, contact_enrichments_per_month: 1000 })
        .contact_enrichments_per_month,
    ).toBe(1000)
  })

  it('honours an EXPLICIT null as genuinely unlimited', () => {
    // Unlimited has to be stated, not inherited.
    expect(
      planLimitsSchema.parse({ ...BASE, contact_enrichments_per_month: null })
        .contact_enrichments_per_month,
    ).toBeNull()
  })

  it('falls back to the cap rather than throwing on a malformed value', () => {
    // A hand-edited plan row must degrade to safe, not take enrichment down —
    // and must certainly not degrade to unlimited.
    for (const bad of ['lots', {}, [], true]) {
      const parsed = planLimitsSchema.safeParse({
        ...BASE,
        contact_enrichments_per_month: bad,
      })
      expect(parsed.success, JSON.stringify(bad)).toBe(true)
      if (parsed.success) {
        expect(parsed.data.contact_enrichments_per_month).toBe(250)
      }
    }
  })

  it('still rejects a plan whose other limits are malformed', () => {
    // The lenient default is scoped to this one key; the rest must fail loudly.
    expect(planLimitsSchema.safeParse({ ...BASE, records_per_month: 'many' }).success).toBe(false)
  })
})

describe('credits_per_month', () => {
  /*
   * ⚠️ Deliberately NOT defaulted. It is the paid product: an absent key must
   * fail loudly rather than parse as `null`, because `null` means unlimited
   * everywhere it is read — consume_credit, credit_balance, and
   * grant_fastspring_period_credits would all hand out free extractions.
   */
  it('rejects a plan whose allowance is missing', () => {
    const { credits_per_month: _omitted, ...withoutCredits } = BASE
    expect(planLimitsSchema.safeParse(withoutCredits).success).toBe(false)
  })

  it('honours an EXPLICIT null as genuinely unlimited', () => {
    expect(
      planLimitsSchema.parse({ ...BASE, credits_per_month: null }).credits_per_month,
    ).toBeNull()
  })

  it('reads the seeded allowance back unchanged', () => {
    expect(planLimitsSchema.parse({ ...BASE, credits_per_month: 300 }).credits_per_month).toBe(300)
  })
})

describe('every live plan parses', () => {
  it('accepts the shapes seeded in the database', () => {
    // These are the real blobs from `plans.limits`, none of which carry the new
    // key — the case the default exists for.
    const live = [
      { ...BASE, credits_per_month: 1000, retention_days: 730, records_per_month: 300000, extractions_per_day: 100 },
      { ...BASE, credits_per_month: 10, retention_days: 3, records_per_month: 250, files_per_extraction: 5 },
      { ...BASE, credits_per_month: 300, retention_days: 90, records_per_month: 7500, files_per_extraction: 30 },
    ]

    for (const limits of live) {
      const parsed = planLimitsSchema.safeParse(limits)
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(parsed.data.contact_enrichments_per_month).toBe(250)
    }
  })
})
