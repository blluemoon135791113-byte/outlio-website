/**
 * Parser + dedupe + export tests against FABRICATED fixtures.
 *
 * Fixtures contain invented names and example.com-style identifiers only.
 * A real saved page must never enter this directory.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { toCsv, sanitizeCell } from '@/lib/export/sanitize'
import { dedupeLeads, resolveKey, slug } from '@/lib/leads/dedupe'
import { ParseError, extractTenure, parseSearchResults } from '@/lib/leads/parse'

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'html')
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8')

describe('parseSearchResults — valid page', () => {
  const { leads, skippedRows } = parseSearchResults(read('valid-search-results.html'))

  it('finds exactly the lead rows, ignoring sidebar items', () => {
    // The fixture has 5 leads plus 2 `li.artdeco-list__item` decoys.
    expect(leads).toHaveLength(5)
    expect(skippedRows).toBe(0)
  })

  it('extracts the member URN and builds a public /in/ profile URL', () => {
    expect(leads[0]?.memberUrn).toBe('ACwAAFAKE0001AAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(leads[0]?.linkedinUrl).toBe(
      'https://www.linkedin.com/in/ACwAAFAKE0001AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    )
  })

  it('keeps the Sales Navigator URL separately', () => {
    expect(leads[0]?.salesNavUrl).toContain('/sales/lead/')
  })

  it('discards the volatile session token from the identifier', () => {
    for (const l of leads) {
      expect(l.memberUrn).not.toContain(',')
      expect(l.memberUrn).not.toContain('NAME_SEARCH')
    }
  })

  it('reads the REAL job title, not the tenure div', () => {
    expect(leads[0]?.jobTitle).toBe('Founder')
    expect(leads[1]?.jobTitle).toBe('Head of Sales')
    // Regression guard for the trap: a title must never start with a digit.
    for (const l of leads) expect(l.jobTitle ?? '').not.toMatch(/^\d/)
  })

  it('splits tenure into two separate fields', () => {
    expect(leads[0]?.tenureInRole).toBe('3 years 2 months in role')
    expect(leads[0]?.tenureInCompany).toBe('3 years 2 months in company')
  })

  it('extracts company name and URL when the company has a page', () => {
    expect(leads[0]?.companyName).toBe('Northwind Example')
    expect(leads[0]?.companyUrl).toBe(
      'https://www.linkedin.com/sales/company/1000001?_ntb=FAKE',
    )
  })

  it('THE FALLBACK: recovers company name when there is no company page', () => {
    const cy = leads[2]
    expect(cy?.fullName).toBe('Cy Fabricated')
    expect(cy?.companyName).toBe('Independent Fabricated Ltd')
    expect(cy?.companyUrl).toBeNull() // genuinely absent, not invented
  })

  it('preserves non-ASCII names and locations', () => {
    const zoe = leads[4]
    expect(zoe?.fullName).toBe('Zoë Müller-Fabricated')
    expect(zoe?.location).toContain('München')
  })

  it('extracts a name containing a formula payload verbatim', () => {
    // The parser does NOT sanitise — that is the export layer's job.
    expect(leads[3]?.fullName).toBe("=cmd|'/c calc'!A1")
  })
})

describe('parseSearchResults — current table layout', () => {
  const { leads, skippedRows } = parseSearchResults(read('current-table-results.html'))

  it('finds only people rows and ignores table decoys', () => {
    expect(leads).toHaveLength(2)
    expect(skippedRows).toBe(0)
  })

  it('maps the current job-title field to the actual role', () => {
    expect(leads.map((lead) => lead.jobTitle)).toEqual(['VP of Revenue', 'Founder'])
    expect(leads[0]?.tenureInRole).toBeNull()
    expect(leads[0]?.tenureInCompany).toBeNull()
  })

  it('extracts names, companies, locations, and stable identities', () => {
    expect(leads[0]).toMatchObject({
      fullName: 'Avery Fabricated',
      companyName: 'Table Example Inc',
      companyUrl: null,
      location: 'Toronto, Canada',
      memberUrn: 'ACwAATABLE0001AAAAAAAAAAAAAAAAAAAAAAAAAA',
    })
    expect(leads[1]?.companyUrl).toBe('https://www.linkedin.com/sales/company/2000002')
  })
})

describe('parseSearchResults — hostile and empty inputs', () => {
  it('throws ERR_FILE_FORMAT on a page with zero results', () => {
    expect(() => parseSearchResults(read('zero-results.html'))).toThrow(ParseError)
    try {
      parseSearchResults(read('zero-results.html'))
    } catch (e) {
      expect((e as ParseError).code).toBe('ERR_FILE_FORMAT')
    }
  })

  it('throws on an empty file — never a silent empty success', () => {
    expect(() => parseSearchResults(read('empty.html'))).toThrow(ParseError)
  })

  it('throws on valid HTML that is not a results page', () => {
    expect(() => parseSearchResults(read('not-a-results-page.html'))).toThrow(ParseError)
  })

  it('throws on binary content renamed .html', () => {
    expect(() => parseSearchResults(read('binary-renamed.html'))).toThrow(ParseError)
  })

  it('survives a 2000-deep div bomb without stack overflow', () => {
    // Must fail loudly, not crash the process.
    expect(() => parseSearchResults(read('nested-div-bomb.html'))).toThrow(ParseError)
  })

  it('parses a page containing an inline <script> without executing anything', () => {
    const { leads } = parseSearchResults(read('with-script.html'))
    expect(leads).toHaveLength(1)
    expect(JSON.stringify(leads)).not.toContain('alert')
  })
})

describe('extractTenure — the job-title trap', () => {
  it('splits when the halves are WELDED (one text node)', () => {
    expect(extractTenure('3 years 2 months in role3 years 2 months in company')).toEqual({
      inRole: '3 years 2 months in role',
      inCompany: '3 years 2 months in company',
    })
  })

  it('splits when the halves are SEPARATE nodes (whitespace between)', () => {
    expect(extractTenure('8 years 7 months in role 8 years 7 months in company')).toEqual({
      inRole: '8 years 7 months in role',
      inCompany: '8 years 7 months in company',
    })
  })

  it('handles a role with no company half', () => {
    expect(extractTenure('1 year in role')).toEqual({
      inRole: '1 year in role',
      inCompany: null,
    })
  })

  it('handles non-numeric durations', () => {
    expect(extractTenure('Less than a year in role2 years in company')).toEqual({
      inRole: 'Less than a year in role',
      inCompany: '2 years in company',
    })
  })

  it('returns nulls for empty or missing input', () => {
    expect(extractTenure(null)).toEqual({ inRole: null, inCompany: null })
    expect(extractTenure('')).toEqual({ inRole: null, inCompany: null })
    expect(extractTenure('   ')).toEqual({ inRole: null, inCompany: null })
  })

  it('never returns the welded string as a single value', () => {
    const r = extractTenure('3 years in role3 years in company')
    expect(r.inRole).not.toContain('in company')
  })
})

describe('dedupe', () => {
  const { leads } = parseSearchResults(read('duplicate-leads.html'))

  it('fixture contains 3 rows, one a repeat', () => {
    expect(leads).toHaveLength(3)
  })

  it('keys on the member URN, without storing it', () => {
    const { key, strategy } = resolveKey(leads[0]!)
    expect(strategy).toBe('linkedin_url_canonical')
    // The URN identifies the key but is hashed, never embedded — dedupe keys
    // outlive the lead rows. See tests/unit/dedupe-keys.test.ts.
    expect(key).toMatch(/^li:[0-9a-f]{32}$/)
    expect(key).not.toContain('ACwAAFAKE0001')
  })

  it('remove_exact drops the repeat', () => {
    const r = dedupeLeads(leads, 'remove_exact')
    expect(r.kept).toHaveLength(2)
    expect(r.report.duplicatesFound).toBe(1)
    expect(r.report.duplicatesRemoved).toBe(1)
  })

  it('keep_all keeps everything', () => {
    const r = dedupeLeads(leads, 'keep_all')
    expect(r.kept).toHaveLength(3)
    expect(r.report.duplicatesRemoved).toBe(0)
  })

  it('review keeps everything but reports the duplicate', () => {
    const r = dedupeLeads(leads, 'review')
    expect(r.kept).toHaveLength(3)
    expect(r.report.duplicatesFound).toBe(1)
    expect(r.report.duplicatesRemoved).toBe(0) // NEVER deletes silently
  })

  it('detects a cross-job duplicate from existing keys', () => {
    // Derived rather than hardcoded: the stored key is a hash, and pinning the
    // literal here would just restate the implementation.
    const existing = new Set([resolveKey(leads[0]!).key])
    const r = dedupeLeads(leads, 'remove_exact', existing)
    expect(r.kept).toHaveLength(1) // both copies of lead 1 removed
  })

  it('slug strips diacritics and punctuation', () => {
    expect(slug('Zoë Müller-Fabricated')).toBe('zoemullerfabricated')
    expect(slug(null)).toBe('')
  })
})

describe('sanitizeCell — formula injection', () => {
  it('THE ACCEPTANCE CASE: neutralises =cmd|\'/c calc\'!A1', () => {
    expect(sanitizeCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1")
  })

  it('neutralises every risky prefix', () => {
    for (const p of ['=', '+', '-', '@', '\t', '\r']) {
      const out = String(sanitizeCell(`${p}danger`))
      expect(out.startsWith("'"), p).toBe(true)
    }
  })

  it('preserves the original characters rather than stripping them', () => {
    expect(String(sanitizeCell('=1+1'))).toContain('=1+1')
  })

  it('leaves ordinary text untouched', () => {
    expect(sanitizeCell('Ada Fabricated')).toBe('Ada Fabricated')
    expect(sanitizeCell('Zoë Müller')).toBe('Zoë Müller')
  })

  it('keeps numbers numeric', () => {
    expect(sanitizeCell(42)).toBe(42)
    expect(sanitizeCell(Number.NaN)).toBeNull()
  })

  it('strips control characters', () => {
    expect(sanitizeCell('a bc')).toBe('abc')
  })

  it('maps null and undefined to null', () => {
    expect(sanitizeCell(null)).toBeNull()
    expect(sanitizeCell(undefined)).toBeNull()
  })
})

describe('toCsv', () => {
  const rows = [{ a: "=cmd|'/c calc'!A1", b: 'has, comma' }, { a: 'plain', b: 'has "quote"' }]
  const cols = [
    { header: 'A', value: (r: (typeof rows)[0]) => r.a },
    { header: 'B', value: (r: (typeof rows)[0]) => r.b },
  ]

  it('emits a UTF-8 BOM for Excel', () => {
    expect(toCsv(rows, cols).charCodeAt(0)).toBe(0xfeff)
  })

  it('uses CRLF line endings per RFC 4180', () => {
    expect(toCsv(rows, cols, { bom: false })).toContain('\r\n')
  })

  it('quotes fields containing commas and doubles embedded quotes', () => {
    const csv = toCsv(rows, cols, { bom: false })
    expect(csv).toContain('"has, comma"')
    expect(csv).toContain('"has ""quote"""')
  })

  it('runs every cell through sanitizeCell', () => {
    expect(toCsv(rows, cols, { bom: false })).toContain("'=cmd|")
  })
})
