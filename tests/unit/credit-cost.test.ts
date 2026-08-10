/**
 * Lead-based extraction pricing — migration 0030.
 *
 * These cases are the pricing table the plans were sold on. They must match
 * `public.lead_credit_cost` exactly; the database is what bills.
 *
 * The rule on every active plan: 1 credit per 25 leads, counted across the
 * WHOLE RUN rather than per file.
 */
import { describe, expect, it } from 'vitest'

import {
  creditsForLeads,
  estimatedCreditCostForFiles,
  extractionCreditCost,
  TYPICAL_LEADS_PER_PAGE,
} from '@/lib/limits/credits'
import type { PlanLimits } from '@/types/database'

const BLOCK = 25

function limits(over: Partial<PlanLimits>): PlanLimits {
  return {
    files_per_extraction: null,
    leads_per_credit: null,
    extractions_per_day: null,
    extractions_per_month: null,
    records_per_extraction: null,
    records_per_month: null,
    storage_bytes: null,
    exports_per_month: null,
    retention_days: null,
    ...over,
  }
}

describe('the 25-leads-per-credit rule', () => {
  it.each([
    [1, 1],
    [24, 1],
    [25, 1],
    [26, 2],
    [49, 2],
    [50, 2],
    [51, 3],
    [75, 3],
    [76, 4],
  ])('%i leads costs %i credits', (leads, cost) => {
    expect(creditsForLeads(leads, BLOCK)).toBe(cost)
  })
})

describe('credits are consumed by leads, not by files', () => {
  it('bills three 10-lead files as one 30-lead run, not as three runs', () => {
    // 30 leads spread over 3 files. Per-file rounding would charge 3.
    expect(creditsForLeads(10 + 10 + 10, BLOCK)).toBe(2)
  })

  it('bills ten 2-lead files as a single credit', () => {
    expect(creditsForLeads(20, BLOCK)).toBe(1)
  })

  it('charges the same for one 50-lead run however the files are split', () => {
    expect(creditsForLeads(50, BLOCK)).toBe(creditsForLeads(25 + 25, BLOCK))
  })
})

describe('monthly ceilings match the advertised lead limits', () => {
  it.each([
    ['trial', 10, 250],
    ['starter', 100, 2500],
    ['professional', 300, 7500],
    ['custom', 1000, 25000],
  ])('%s: %i credits buys %i leads', (_plan, credits, leads) => {
    expect(creditsForLeads(leads, BLOCK)).toBe(credits)
    // One lead past the ceiling needs a credit the plan does not have.
    expect(creditsForLeads(leads + 1, BLOCK)).toBe(credits + 1)
  })
})

describe('degenerate inputs', () => {
  it('charges a flat credit when the plan sets no block size', () => {
    expect(creditsForLeads(300, null)).toBe(1)
  })

  it('charges a flat credit for a zero or negative block size', () => {
    expect(creditsForLeads(300, 0)).toBe(1)
    expect(creditsForLeads(300, -5)).toBe(1)
  })

  it('never charges less than one credit', () => {
    expect(creditsForLeads(0, BLOCK)).toBe(1)
    expect(creditsForLeads(-3, BLOCK)).toBe(1)
  })

  it('ignores a fractional lead count', () => {
    expect(creditsForLeads(25.9, BLOCK)).toBe(1)
  })
})

describe('extractionCreditCost reads the plan limits', () => {
  it('uses leads_per_credit', () => {
    expect(extractionCreditCost(26, limits({ leads_per_credit: 25 }))).toBe(2)
  })

  it('falls back to a flat credit without a plan', () => {
    expect(extractionCreditCost(600, null)).toBe(1)
  })
})

describe('estimatedCreditCostForFiles is an upper bound for the UI', () => {
  it('assumes every file is a full page', () => {
    expect(estimatedCreditCostForFiles(4, 25)).toBe(
      creditsForLeads(4 * TYPICAL_LEADS_PER_PAGE, 25),
    )
  })

  it('never quotes below the real cost of a full-page run', () => {
    for (const files of [1, 3, 10, 30, 50]) {
      const quoted = estimatedCreditCostForFiles(files, 25)
      const actual = creditsForLeads(files * TYPICAL_LEADS_PER_PAGE, 25)
      expect(quoted).toBeGreaterThanOrEqual(actual)
    }
  })
})
