import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { detectSavedPageType, savedPageTypeLabel } from '@/lib/leads/page-type'
import { toIngestPayload } from '@/lib/companies/ingest-accounts'

import { AccountListParseError, parseAccountList } from '@/lib/companies/parse-account-list'

const fixture = readFileSync(
  path.join(process.cwd(), 'tests/fixtures/html/account-list-valid.html'),
  'utf8',
)

describe('parseAccountList', () => {
  it('extracts canonical companies, list provenance and visible signals', () => {
    const result = parseAccountList(fixture)

    expect(result.listName).toBe('Priority accounts')
    expect(result.skippedRows).toBe(0)
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0]).toMatchObject({
      companyName: 'Example Systems',
      companyId: '10001',
      industry: 'Software Development',
      connectionPaths: '2 of 5',
      alert: 'A senior executive recently joined Example Systems.',
      recommendation: {
        fullName: 'Ada Example',
        memberId: 'ACwFABRICATED001',
        jobTitle: 'Chief Revenue Officer',
        connectionDegree: '2nd',
      },
    })
  })

  it('does not treat Notes as extracted account intelligence', () => {
    const result = parseAccountList(fixture)
    expect(JSON.stringify(result)).not.toContain('Private note')
  })

  it('converts rendered None values to unknown', () => {
    const second = parseAccountList(fixture).accounts[1]!
    expect(second.connectionPaths).toBeNull()
    expect(second.alert).toBeNull()
    expect(second.recommendation).toBeNull()
  })

  it('fails loudly when the Account Hub row anchor is absent', () => {
    expect(() => parseAccountList('<!doctype html><html><body></body></html>'))
      .toThrow(AccountListParseError)
  })
})

describe('saved page type detection', () => {
  const accountList = readFileSync('tests/fixtures/html/account-list-valid.html', 'utf8')

  it('recognises a real Account Hub fixture', () => {
    expect(detectSavedPageType(accountList)).toBe('account_list')
  })

  it('recognises a lead search page', () => {
    expect(
      detectSavedPageType('<li><span data-anonymize="person-name">Ada Lovelace</span></li>'),
    ).toBe('lead_search')
  })

  it('⚠️ prefers account list when a page carries BOTH anchors', () => {
    /*
     * An Account Hub row can recommend a PERSON, so the page may contain a
     * person-name anchor. A lead search page never carries the account-hub
     * table hooks, so the account test must run first. Reversing the order
     * silently routes account pages to the lead parser — the exact bug this
     * module exists to prevent.
     */
    const both =
      '<div data-x--account-hub--table-data-row>' +
      '<span data-anonymize="person-name">Ada Lovelace</span></div>'

    expect(detectSavedPageType(both)).toBe('account_list')
  })

  it('⚠️ returns unknown rather than guessing', () => {
    // Defaulting to the lead parser would turn "we cannot tell what this is"
    // into "this is a broken lead page".
    expect(detectSavedPageType('<html><body><p>Nothing familiar.</p></body></html>')).toBe(
      'unknown',
    )
    expect(detectSavedPageType('')).toBe('unknown')
  })

  it('names each type for an error a user has to act on', () => {
    expect(savedPageTypeLabel('account_list')).toContain('account list')
    expect(savedPageTypeLabel('unknown')).toContain('unrecognised')
  })
})

function account(over: Partial<Parameters<typeof toIngestPayload>[0][number]> = {}) {
  return {
    companyName: 'Acme Corp',
    salesNavUrl: 'https://www.linkedin.com/sales/company/12345',
    companyId: '12345',
    industry: 'Software Development',
    connectionPaths: null,
    alert: null,
    recommendation: null,
    sourceRowIndex: 0,
    ...over,
  }
}

describe('account list ingestion mapping', () => {
  it('⚠️ converts the Sales Navigator URL to the PUBLIC company page', () => {
    /*
     * THE DUPLICATE THIS PREVENTS. `companies.normalized_linkedin_url` is
     * deduped against values written by the lead pipeline, which stores the
     * public `linkedin.com/company/<slug>` page. A `/sales/company/` URL never
     * matches one, so the same company would land twice — once per page type.
     */
    const { payload } = toIngestPayload([account()])

    expect(payload).toHaveLength(1)
    expect(payload[0]!.linkedin_url).toContain('/company/')
    expect(payload[0]!.linkedin_url).not.toContain('/sales/')
    expect(payload[0]!.normalized_linkedin_url).not.toContain('/sales/')
  })

  it('carries the captured industry through', () => {
    expect(toIngestPayload([account()]).payload[0]!.industry).toBe('Software Development')
  })

  it('normalises the name for name-strategy dedupe', () => {
    const { payload } = toIngestPayload([account({ companyName: 'Acme Corp.' })])
    expect(payload[0]!.normalized_name).toBe('acme')
  })

  it('⚠️ counts unidentifiable rows rather than dropping them silently', () => {
    // "25 rows in, 18 companies out" needs the missing seven accounted for.
    const { payload, unidentified } = toIngestPayload([
      account(),
      account({ companyName: '', salesNavUrl: '' }),
    ])

    expect(payload).toHaveLength(1)
    expect(unidentified).toBe(1)
  })

  it('handles an empty list without inventing a company', () => {
    expect(toIngestPayload([])).toEqual({ payload: [], unidentified: 0 })
  })
})

describe('the whole chain, on the real fixture', () => {
  /*
   * ⚠️ THE UNIT TESTS ABOVE USE SYNTHETIC ROWS. This one runs the ACTUAL saved
   * Account Hub markup through every stage a real upload takes — detect,
   * parse, map — because the bugs that survive unit tests are the ones between
   * two components that each pass their own.
   */
  const html = readFileSync('tests/fixtures/html/account-list-valid.html', 'utf8')

  it('routes, parses and maps without losing a company', () => {
    expect(detectSavedPageType(html)).toBe('account_list')

    const parsed = parseAccountList(html)
    expect(parsed.accounts.length).toBeGreaterThan(0)

    const { payload, unidentified } = toIngestPayload(parsed.accounts)

    // Nothing may vanish between parsing and the upsert payload.
    expect(payload.length + unidentified).toBe(parsed.accounts.length)
  })

  it('gives every payload row something the database can dedupe on', () => {
    /*
     * `companies_has_identity` (0043) rejects a row carrying no normalized
     * name, domain or LinkedIn URL. A payload row that fails it would be
     * skipped by the RPC and silently lost, so the mapping must never emit one.
     */
    const { payload } = toIngestPayload(parseAccountList(html).accounts)

    for (const row of payload) {
      const identified =
        Boolean(row.normalized_name) ||
        Boolean(row.normalized_domain) ||
        Boolean(row.normalized_linkedin_url)
      expect(identified).toBe(true)
    }
  })

  it('never emits a Sales Navigator URL as the company identity', () => {
    const { payload } = toIngestPayload(parseAccountList(html).accounts)
    for (const row of payload) {
      expect(row.normalized_linkedin_url ?? '').not.toContain('/sales/')
    }
  })
})
