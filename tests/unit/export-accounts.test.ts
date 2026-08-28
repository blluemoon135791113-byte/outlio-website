import { describe, expect, it } from 'vitest'

import type { ParsedAccount } from '@/lib/companies/parse-account-list'
import { buildAccountCsv } from '@/lib/export/accounts'

function account(overrides: Partial<ParsedAccount> = {}): ParsedAccount {
  return {
    companyName: 'Fabricated Widgets',
    salesNavUrl: 'https://www.linkedin.com/sales/company/38150452',
    companyId: '38150452',
    industry: 'Software Development',
    connectionPaths: '3 connections',
    alert: null,
    recommendation: null,
    sourceRowIndex: 0,
    ...overrides,
  }
}

/** Splits an RFC 4180 line, given none of these fixtures embed newlines. */
function lines(csv: string): string[] {
  return csv.replace(/^﻿/, '').trim().split('\r\n')
}

describe('buildAccountCsv', () => {
  it('writes company columns, never the lead writer’s person columns', () => {
    const header = lines(buildAccountCsv([account()]))[0]!

    expect(header).toContain('Company Name')
    expect(header).toContain('Industry')
    // The account list holds no extracted person, so no person header may
    // appear — a column of blanks reads as a failed extraction.
    expect(header).not.toContain('Full Name')
    expect(header).not.toContain('Email')
    expect(header).not.toContain('Job Title')
  })

  it('keeps the two identifying columns even when every other field is empty', () => {
    const csv = buildAccountCsv([
      account({ industry: null, connectionPaths: null, alert: null }),
    ])
    const [header, row] = lines(csv)

    // Pinned, so an importer mapped against a richer run still resolves.
    expect(header).toBe('Company Name,LinkedIn URL')
    expect(row).toBe(
      'Fabricated Widgets,https://www.linkedin.com/sales/company/38150452',
    )
  })

  it('neutralises a company name that is a spreadsheet formula', () => {
    const csv = buildAccountCsv([account({ companyName: "=cmd|'/c calc'!A1" })])

    // Prefixed with an apostrophe by sanitizeCell, and the original characters
    // preserved rather than stripped.
    expect(lines(csv)[1]).toContain("'=cmd|'/c calc'!A1")
    expect(lines(csv)[1]!.startsWith('=')).toBe(false)
  })

  it('flattens the recommended person without calling them a lead', () => {
    const csv = buildAccountCsv([
      account({
        recommendation: {
          fullName: 'Fabricated Person',
          salesNavUrl: 'https://www.linkedin.com/sales/lead/fabricated-1',
          memberId: 'fabricated-1',
          jobTitle: 'Head of Operations',
          connectionDegree: '2nd',
        },
      }),
    ])
    const header = lines(csv)[0]!

    expect(header).toContain('Recommended Contact')
    expect(header).toContain('Recommended Contact Title')
    expect(lines(csv)[1]).toContain('Fabricated Person')
    expect(lines(csv)[1]).toContain('Head of Operations')
  })

  it('marks a looked-for but absent value rather than leaving it ambiguous', () => {
    // Industry is present on one row, so the column survives; the row that
    // lacks it must say N/A rather than sit empty.
    const csv = buildAccountCsv([
      account({ companyName: 'Has Industry' }),
      account({ companyName: 'No Industry', industry: null }),
    ])

    expect(lines(csv)[2]).toContain('N/A')
  })
})
