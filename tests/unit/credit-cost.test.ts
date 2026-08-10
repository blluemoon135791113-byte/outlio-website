/**
 * Tiered extraction pricing — migration 0027.
 *
 * These cases are the pricing table the plans were sold on. They must match
 * `public.extraction_credit_cost` exactly; the database is what bills.
 */
import { describe, expect, it } from 'vitest'

import { creditsForFiles, extractionCreditCost } from '@/lib/limits/credits'
import type { PlanLimits } from '@/types/database'

function limits(over: Partial<PlanLimits>): PlanLimits {
  return {
    files_per_extraction: null,
    files_per_credit: null,
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

describe('starter — 10 files, blocks of 5', () => {
  const block = 5

  it.each([
    [1, 1],
    [4, 1],
    [5, 1],
    [6, 2],
    [9, 2],
    [10, 2],
  ])('%i files costs %i credits', (files, cost) => {
    expect(creditsForFiles(files, block)).toBe(cost)
  })
})

describe('professional — 30 files, blocks of 10', () => {
  const block = 10

  it.each([
    [1, 1],
    [10, 1],
    [11, 2],
    [20, 2],
    [21, 3],
    [30, 3],
  ])('%i files costs %i credits', (files, cost) => {
    expect(creditsForFiles(files, block)).toBe(cost)
  })
})

describe('custom — 50 files, blocks of 10', () => {
  const block = 10

  it.each([
    [10, 1],
    [20, 2],
    [30, 3],
    [40, 4],
    [50, 5],
  ])('%i files costs %i credits', (files, cost) => {
    expect(creditsForFiles(files, block)).toBe(cost)
  })
})

describe('trial — 5 files, blocks of 5', () => {
  it('never exceeds one credit at the plan ceiling', () => {
    expect(creditsForFiles(5, 5)).toBe(1)
  })
})

describe('degenerate inputs', () => {
  it('charges a flat credit when the plan sets no block size', () => {
    expect(creditsForFiles(30, null)).toBe(1)
  })

  it('charges a flat credit for a zero or negative block size', () => {
    expect(creditsForFiles(30, 0)).toBe(1)
    expect(creditsForFiles(30, -5)).toBe(1)
  })

  it('never charges less than one credit', () => {
    expect(creditsForFiles(0, 10)).toBe(1)
    expect(creditsForFiles(-3, 10)).toBe(1)
  })
})

describe('extractionCreditCost reads the plan limits', () => {
  it('uses files_per_credit', () => {
    expect(extractionCreditCost(6, limits({ files_per_credit: 5 }))).toBe(2)
  })

  it('falls back to a flat credit without a plan', () => {
    expect(extractionCreditCost(6, null)).toBe(1)
  })
})
