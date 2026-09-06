/**
 * CSV import — M2 Phase 3.
 *
 * Two things are being defended here:
 *
 *   1. The parser survives what real tools emit — Excel's BOM, European
 *      semicolons, CRLF, quoted commas and newlines.
 *   2. A bad row fails ALONE. Nine malformed rows in a 5,000-row file must
 *      cost nine people, not five thousand.
 */
import { describe, expect, it } from 'vitest'

import {
  buildImportPlan,
  CsvParseError,
  parseCsv,
  suggestMapping,
  summarizePlan,
  type ImportMapping,
} from '@/lib/crm/csv-import'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('reads a plain comma file', () => {
    const parsed = parseCsv('name,email\nSam,sam@acme.com\nPat,pat@acme.com')
    expect(parsed.headers).toEqual(['name', 'email'])
    expect(parsed.rows).toEqual([
      ['Sam', 'sam@acme.com'],
      ['Pat', 'pat@acme.com'],
    ])
  })

  it('strips the BOM Excel writes on every export', () => {
    // Without this the first header is "﻿name" and matches no alias, so
    // the whole mapping silently comes back empty.
    const parsed = parseCsv('﻿name,email\nSam,sam@acme.com')
    expect(parsed.headers[0]).toBe('name')
  })

  it('handles CRLF', () => {
    const parsed = parseCsv('name,email\r\nSam,sam@acme.com\r\n')
    expect(parsed.rows).toEqual([['Sam', 'sam@acme.com']])
  })

  it('detects a semicolon delimiter, as European Excel emits', () => {
    // Read as commas this file is one giant column and a baffled user.
    const parsed = parseCsv('name;email\nSam;sam@acme.com')
    expect(parsed.headers).toEqual(['name', 'email'])
    expect(parsed.rows).toEqual([['Sam', 'sam@acme.com']])
  })

  it('detects tabs', () => {
    const parsed = parseCsv('name\temail\nSam\tsam@acme.com')
    expect(parsed.rows).toEqual([['Sam', 'sam@acme.com']])
  })

  it('keeps commas inside quoted fields', () => {
    const parsed = parseCsv('name,title\n"Ellis, Sam","Head of Sales, EMEA"')
    expect(parsed.rows).toEqual([['Ellis, Sam', 'Head of Sales, EMEA']])
  })

  it('keeps newlines inside quoted fields', () => {
    const parsed = parseCsv('name,notes\nSam,"line one\nline two"')
    expect(parsed.rows).toEqual([['Sam', 'line one\nline two']])
  })

  it('unescapes doubled quotes', () => {
    const parsed = parseCsv('name,nickname\nSam,"the ""closer"""')
    expect(parsed.rows).toEqual([['Sam', 'the "closer"']])
  })

  it('reads a final row with no trailing newline', () => {
    const parsed = parseCsv('name\nSam')
    expect(parsed.rows).toEqual([['Sam']])
  })

  it('ignores blank trailing lines', () => {
    const parsed = parseCsv('name,email\nSam,sam@acme.com\n\n\n')
    expect(parsed.rows).toHaveLength(1)
  })

  it('rejects a file with nothing in it', () => {
    for (const value of ['', '   ', '\n\n']) {
      expect(() => parseCsv(value)).toThrow(CsvParseError)
    }
  })
})

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

describe('suggestMapping', () => {
  it('recognises the spellings real exports use', () => {
    const mapping = suggestMapping([
      'Full Name',
      'E-Mail Address',
      'Job Title',
      'Company Name',
      'LinkedIn URL',
      'Mobile Phone',
    ])

    expect(mapping).toEqual({
      'Full Name': 'full_name',
      'E-Mail Address': 'email',
      'Job Title': 'job_title',
      'Company Name': 'company_name',
      'LinkedIn URL': 'linkedin_url',
      'Mobile Phone': 'phone',
    })
  })

  it('ignores punctuation and casing', () => {
    expect(suggestMapping(['email_address'])).toEqual({ email_address: 'email' })
    expect(suggestMapping(['  EMAIL  '])).toEqual({ '  EMAIL  ': 'email' })
  })

  it('maps each field at most once, leaving the rest to the user', () => {
    // Guessing which of two email columns is the real one is not the
    // computer's call.
    const mapping = suggestMapping(['Email', 'Work Email'])
    expect(mapping.Email).toBe('email')
    expect(mapping['Work Email']).toBeUndefined()
  })

  it('leaves unrecognised columns alone rather than guessing', () => {
    const mapping = suggestMapping(['Salesforce ID', 'Internal Notes', 'Owner'])
    expect(mapping).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

const HEADERS = ['Name', 'Email', 'Phone', 'Company', 'Title']
const MAPPING: ImportMapping = {
  Name: 'full_name',
  Email: 'email',
  Phone: 'phone',
  Company: 'company_name',
  Title: 'job_title',
}

function plan(body: string[][], mapping: ImportMapping = MAPPING, options = {}) {
  return buildImportPlan({ headers: HEADERS, rows: body }, mapping, options)
}

describe('buildImportPlan', () => {
  it('turns a good row into a contact and a company', () => {
    const result = plan([['Sam Ellis', 'Sam@Acme.com', '+1 415 555 0132', 'Acme Ltd', 'CTO']])

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      line: 2,
      contact: {
        fullName: 'Sam Ellis',
        jobTitle: 'CTO',
        emails: ['sam@acme.com'],
      },
      company: { name: 'Acme Ltd' },
    })
  })

  it('numbers lines the way a spreadsheet does', () => {
    // The header is line 1, so the first data row is line 2. Reporting a
    // 0-based index sends the user to the wrong row.
    const result = plan([
      ['A Person', 'a@acme.com', '', '', ''],
      ['', 'not-an-email', '', '', ''],
    ])
    expect(result.rows[0]?.line).toBe(2)
    expect(result.errors[0]?.line).toBe(3)
  })

  it('reconstructs a name from separate first and last columns', () => {
    const result = buildImportPlan(
      { headers: ['First', 'Last', 'Email'], rows: [['Sam', 'Ellis', 'sam@acme.com']] },
      { First: 'first_name', Last: 'last_name', Email: 'email' },
    )
    expect(result.rows[0]?.contact.fullName).toBe('Sam Ellis')
  })

  describe('partial failure', () => {
    it('imports the good rows and reports only the bad ones', () => {
      const result = plan([
        ['Good One', 'good1@acme.com', '', '', ''],
        ['Bad Row', 'not-an-email', '', '', ''],
        ['Good Two', 'good2@acme.com', '', '', ''],
        ['', '', '', 'Acme', 'CTO'], // identifies nobody
        ['Good Three', 'good3@acme.com', '', '', ''],
      ])

      expect(result.rows).toHaveLength(3)
      expect(result.errors).toHaveLength(2)
      expect(result.errors.map((e) => e.line)).toEqual([3, 5])
      expect(summarizePlan(result)).toEqual({
        rowsTotal: 5,
        rowsValid: 3,
        rowsFailed: 2,
        errorsTruncated: false,
      })
    })

    it('names the offending value so the user can find it', () => {
      const result = plan([['Bad', 'nope@@acme.com', '', '', '']])
      expect(result.errors[0]?.reason).toContain('nope@@acme.com')
    })

    it('caps the error report but keeps the count honest', () => {
      const rows = Array.from({ length: 150 }, () => ['Bad', 'not-an-email', '', '', ''])
      const result = plan(rows)

      expect(result.errors).toHaveLength(100)
      // The report is truncated; the arithmetic is not.
      expect(summarizePlan(result)).toEqual({
        rowsTotal: 150,
        rowsValid: 0,
        rowsFailed: 150,
        errorsTruncated: true,
      })
    })
  })

  describe('a bad phone never costs a person', () => {
    it('keeps the contact when the number cannot be parsed', () => {
      const result = plan([['Sam Ellis', 'sam@acme.com', 'call reception', '', '']])
      expect(result.errors).toEqual([])
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]?.contact.phones).toEqual([])
    })

    it('keeps an ambiguous national number for a human to read', () => {
      const result = plan([['Sam Ellis', 'sam@acme.com', '07400 123456', '', '']])
      // Stored raw. Ledger D12: no region is guessed, but nothing is discarded.
      expect(result.rows[0]?.contact.phones).toEqual(['07400 123456'])
    })

    it('resolves it when the user supplied a country', () => {
      const result = plan([['Sam', 'sam@acme.com', '07400 123456', '', '']], MAPPING, {
        defaultPhoneCountry: 'GB',
      })
      expect(result.rows[0]?.contact.defaultPhoneCountry).toBe('GB')
    })
  })

  describe('mapping guards', () => {
    it('refuses a mapping in which no row could ever identify anyone', () => {
      const result = plan([['Sam', 'sam@acme.com', '', 'Acme', 'CTO']], {
        Company: 'company_name',
        Title: 'job_title',
      })

      // The MAPPING is wrong, not the data — so this is one error about the
      // file, not one per row.
      expect(result.rows).toEqual([])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.reason).toMatch(/Email, LinkedIn URL, or a name/)
    })

    it('accepts first + last as an identity', () => {
      const result = buildImportPlan(
        { headers: ['First', 'Last'], rows: [['Sam', 'Ellis']] },
        { First: 'first_name', Last: 'last_name' },
      )
      expect(result.rows).toHaveLength(1)
    })

    it('ignores columns the user left unmapped', () => {
      const result = buildImportPlan(
        { headers: ['Name', 'Secret'], rows: [['Sam', 'do-not-import']] },
        { Name: 'full_name' },
      )
      expect(JSON.stringify(result.rows[0])).not.toContain('do-not-import')
    })
  })

  it('marks every imported contact as csv_import', () => {
    // The funnel in M4 groups by source; a contact that lies about where it
    // came from corrupts every batch report it appears in.
    const result = plan([['Sam', 'sam@acme.com', '', '', '']])
    expect(result.rows[0]?.contact.source).toBe('csv_import')
  })

  it('assigns an owner when one was chosen', () => {
    const result = plan([['Sam', 'sam@acme.com', '', '', '']], MAPPING, {
      ownerUserId: '00000000-0000-4000-8000-000000000001',
    })
    expect(result.rows[0]?.contact.ownerUserId).toBe('00000000-0000-4000-8000-000000000001')
  })

  it('produces no company when the row carried none', () => {
    const result = plan([['Sam', 'sam@acme.com', '', '', 'CTO']])
    expect(result.rows[0]?.company).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// End to end, on a file shaped like a real export
// ---------------------------------------------------------------------------

describe('a realistic export', () => {
  const FILE = [
    '﻿"Full Name";"E-Mail Address";"Job Title";"Company Name";"Mobile Phone"',
    '"Ellis, Sam";"Sam@Acme.com";"Head of Sales, EMEA";"Acme Ltd";"+1 415 555 0132"',
    '"Pat Chen";"pat@globex.example.com";"CTO";"Globex";""',
    '"Broken Row";"not-an-email";"";"";""',
    '',
  ].join('\r\n')

  it('parses, maps and validates without losing the good rows', () => {
    const parsed = parseCsv(FILE)
    expect(parsed.headers).toEqual([
      'Full Name',
      'E-Mail Address',
      'Job Title',
      'Company Name',
      'Mobile Phone',
    ])

    const mapping = suggestMapping(parsed.headers)
    const result = buildImportPlan(parsed, mapping)

    expect(summarizePlan(result)).toEqual({
      rowsTotal: 3,
      rowsValid: 2,
      rowsFailed: 1,
      errorsTruncated: false,
    })

    expect(result.rows[0]?.contact).toMatchObject({
      fullName: 'Ellis, Sam',
      jobTitle: 'Head of Sales, EMEA',
      emails: ['sam@acme.com'],
    })
    expect(result.rows[0]?.company?.name).toBe('Acme Ltd')
    expect(result.errors[0]?.line).toBe(4)
  })
})
