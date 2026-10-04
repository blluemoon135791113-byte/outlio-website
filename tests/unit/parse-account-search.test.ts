/**
 * Sales Navigator account SEARCH results — the third saved-page type.
 *
 * The fixture is fabricated and mirrors the structure of a real page validated
 * on 2026-10-03. Pinned: the full About text comes from `title` (never the
 * clipped preview), headcount ranges are never turned into counts, rows with
 * no LinkedIn company link are skipped, and the page is routed as accounts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseAccountSearch, readHeadcount } from '@/lib/companies/parse-account-search'
import { detectSavedPageType } from '@/lib/leads/page-type'

const HTML = readFileSync(join(__dirname, '../fixtures/html/account-search-valid.html'), 'utf8')
const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/html', name), 'utf8')

describe('page type', () => {
  it('an account search page is recognised as such', () => {
    expect(detectSavedPageType(HTML)).toBe('account_search')
  })

  it('the other page types are unchanged', () => {
    expect(detectSavedPageType(fixture('account-list-valid.html'))).toBe('account_list')
    expect(detectSavedPageType(fixture('valid-search-results.html'))).toBe('lead_search')
    expect(detectSavedPageType(fixture('not-a-results-page.html'))).toBe('unknown')
  })
})

describe('parseAccountSearch', () => {
  const { accounts, skippedRows } = parseAccountSearch(HTML)

  it('reads every row with a LinkedIn company link; skips the rest', () => {
    expect(accounts.map((a) => a.companyName)).toEqual([
      'Fabricated Widgets Inc',
      'Example Health Holdings',
      "=cmd|'/c calc'!A1",
    ])
    expect(skippedRows).toBe(2)
  })

  it('the link loses its session query; the id is the Sales Navigator id', () => {
    expect(accounts[0]).toMatchObject({
      salesNavUrl: 'https://www.linkedin.com/sales/company/100000001',
      companyId: '100000001',
    })
    expect(accounts[1]!.salesNavUrl).toBe('https://www.linkedin.com/sales/company/100000002')
  })

  it('the FULL About text comes from title — line breaks kept, never the clipped preview', () => {
    expect(accounts[0]!.summary).toBe(
      'Fabricated Widgets builds imaginary widgets for example.com.\nFounded in a test fixture, it has never existed.',
    )
    // No title: NULL, not "A preview with no title attribute".
    expect(accounts[1]!.summary).toBeNull()
  })

  it('an exact headcount is a count; a range stays a range; anything else is neither', () => {
    expect(accounts[0]).toMatchObject({ employeeCount: 253, employeeCountRange: null })
    expect(accounts[1]).toMatchObject({ employeeCount: null, employeeCountRange: '1.2K+' })
    expect(accounts[2]).toMatchObject({ employeeCount: null, employeeCountRange: null })
  })

  it('location only when the page shows one', () => {
    expect(accounts[0]!.location).toBeNull()
    expect(accounts[1]!.location).toBe('Springfield, Example State')
  })

  it('signals are LinkedIn keys, de-duplicated, in page order', () => {
    expect(accounts[0]!.signals).toEqual(['hiring_on_linkedin'])
    expect(accounts[1]!.signals).toEqual(['aiq_strategic_priorities', 'hiring_on_linkedin'])
    expect(accounts[2]!.signals).toEqual([])
  })

  it('rows are marked as account search, with nothing an Account Hub row would carry', () => {
    for (const account of accounts) {
      expect(account).toMatchObject({ pageKind: 'account_search', recommendation: null, connectionPaths: null, alert: null })
    }
  })

  it('a page with no result cards is a loud error, never an empty success', () => {
    expect(() => parseAccountSearch('<html><body><main></main></body></html>')).toThrow(/account search layout/)
    expect(() =>
      parseAccountSearch('<div data-x-search-result="ACCOUNT"><span data-anonymize="company-name">No link</span></div>'),
    ).toThrow(/no usable company identities/)
  })
})

describe('readHeadcount', () => {
  it.each([
    ['253 employees', 253, null],
    ['1 employee', 1, null],
    ['10,001 employees', 10001, null],
    ['10,001+ employees', null, '10,001+'],
    ['1.2K+ employees', null, '1.2K+'],
    ['51-200 employees', null, '51-200'],
    ['many employees', null, null],
    ['', null, null],
  ])('%s', (text, count, range) => {
    expect(readHeadcount(text)).toEqual({ count, range })
  })
})
