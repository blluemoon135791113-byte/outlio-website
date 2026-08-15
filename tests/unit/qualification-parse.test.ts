/**
 * Parsing what a user typed into a criterion value.
 *
 * The rule under test: **an unparseable value is an error, never a default.**
 * Coercing "ten to fifty" into `[0, 0]` would produce a profile that scores
 * confidently against criteria nobody expressed, and the first sign of trouble
 * would be a wrong list weeks later.
 */
import { describe, expect, it } from 'vitest'

import { parseCriterionValue, parseHumanNumber, valueHint } from '@/lib/qualification/parse'

describe('parseHumanNumber', () => {
  it('reads what people actually paste', () => {
    expect(parseHumanNumber('5000000')).toBe(5_000_000)
    expect(parseHumanNumber('5,000,000')).toBe(5_000_000)
    expect(parseHumanNumber('$5M')).toBe(5_000_000)
    expect(parseHumanNumber('5m')).toBe(5_000_000)
    expect(parseHumanNumber('50k')).toBe(50_000)
    expect(parseHumanNumber('1.5M')).toBe(1_500_000)
    expect(parseHumanNumber('£2bn')).toBe(2_000_000_000)
    expect(parseHumanNumber(' 42 ')).toBe(42)
  })

  it('returns null rather than guessing', () => {
    for (const input of ['', '  ', 'a few million', 'five', '5M+', '1..2', 'M5']) {
      expect(parseHumanNumber(input), input).toBeNull()
    }
  })
})

describe('parseCriterionValue', () => {
  it('needs no value for `exists`', () => {
    const result = parseCriterionValue('exists', '')
    expect(result).toEqual({ ok: true, value: null })
  })

  it('rejects an empty value for every other operator', () => {
    for (const operator of ['equals', 'in', 'gte', 'between', 'contains'] as const) {
      expect(parseCriterionValue(operator, '   ').ok, operator).toBe(false)
    }
  })

  it('parses a range in the forms people type', () => {
    for (const input of ['10-50', '10,50', '10 to 50', '10 – 50']) {
      expect(parseCriterionValue('between', input), input).toEqual({ ok: true, value: [10, 50] })
    }
  })

  it('rejects a malformed or reversed range', () => {
    expect(parseCriterionValue('between', '10').ok).toBe(false)
    expect(parseCriterionValue('between', 'ten to fifty').ok).toBe(false)
    expect(parseCriterionValue('between', '50-10').ok).toBe(false)
    expect(parseCriterionValue('between', '1-2-3').ok).toBe(false)
  })

  it('parses numeric comparisons, including shorthand', () => {
    expect(parseCriterionValue('gte', '5M')).toEqual({ ok: true, value: 5_000_000 })
    expect(parseCriterionValue('lte', '50')).toEqual({ ok: true, value: 50 })
    expect(parseCriterionValue('gte', 'lots').ok).toBe(false)
  })

  it('parses a comma-separated list', () => {
    expect(parseCriterionValue('in', 'Seed, Series A')).toEqual({
      ok: true,
      value: ['Seed', 'Series A'],
    })
    expect(parseCriterionValue('not_in', 'Series C')).toEqual({ ok: true, value: ['Series C'] })
  })

  it('drops empty entries from a list without failing', () => {
    expect(parseCriterionValue('in', 'Seed, , Series A,')).toEqual({
      ok: true,
      value: ['Seed', 'Series A'],
    })
  })

  it('rejects a list that is only separators', () => {
    expect(parseCriterionValue('in', ' , , ').ok).toBe(false)
  })

  it('keeps text operators as trimmed text', () => {
    expect(parseCriterionValue('contains', '  software  ')).toEqual({
      ok: true,
      value: 'software',
    })
    expect(parseCriterionValue('not_contains', 'salesforce')).toEqual({
      ok: true,
      value: 'salesforce',
    })
  })
})

describe('valueHint', () => {
  it('describes what each operator expects', () => {
    expect(valueHint('exists')).toContain('No value')
    expect(valueHint('between')).toContain('range')
    expect(valueHint('in')).toContain('Comma-separated')
    expect(valueHint('gte')).toContain('number')
  })
})
