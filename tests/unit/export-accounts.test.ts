import { describe, expect, it } from 'vitest'

import type { ParsedAccount } from '@/lib/companies/parse-account-list'
import { buildAccountCsv, normalizeExportAccount } from '@/lib/export/accounts'

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
  it('writes the shared company and optional decision-maker contract', () => {
    const header = lines(buildAccountCsv([account()]))[0]!

    expect(header).toContain('Company')
    expect(header).toContain('Company Sales Navigator URL')
    expect(header).toContain('Company Industry')
    expect(header).toContain('Record Type')
  })

  it('keeps the two identifying columns even when every other field is empty', () => {
    const csv = buildAccountCsv([
      account({ industry: null, connectionPaths: null, alert: null }),
    ])
    const [header, row] = lines(csv)

    // Pinned, so an importer mapped against a richer run still resolves.
    expect(header).toBe('Name,Sales Navigator URL,Job Title,Company,Company Sales Navigator URL,Lead Source,Record Type')
    expect(row).toContain('Fabricated Widgets')
    expect(row).toContain('https://www.linkedin.com/sales/company/38150452')
    expect(row).toContain('Company only')
    expect(row.endsWith(',Account')).toBe(true)
  })

  it('neutralises a company name that is a spreadsheet formula', () => {
    const csv = buildAccountCsv([account({ companyName: "=cmd|'/c calc'!A1" })])

    // Prefixed with an apostrophe by sanitizeCell, and the original characters
    // preserved rather than stripped.
    expect(lines(csv)[1]).toContain("'=cmd|'/c calc'!A1")
    expect(lines(csv)[1]!.startsWith('=')).toBe(false)
  })

  it('flattens the real recommended person into the shared person columns', () => {
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

    expect(header).toContain('Name')
    expect(header).toContain('Job Title')
    expect(header).toContain('LinkedIn Profile')
    expect(lines(csv)[1]).toContain('Fabricated Person')
    expect(lines(csv)[1]).toContain('Head of Operations')
  })

  it('keeps company and decision-maker contacts distinct', () => {
    const normalized = normalizeExportAccount({
      id: 'account-1',
      companyId: 'company-1',
      companyName: 'Fabricated Widgets',
      companySalesNavigatorUrl: 'https://www.linkedin.com/sales/company/1',
      sourceList: 'Targets',
      industry: 'Software',
      connectionPaths: null,
      alert: null,
      recommendedName: 'Fabricated Person',
      recommendedJobTitle: 'COO',
      recommendedLinkedInUrl: 'https://www.linkedin.com/in/fabricated-person',
      recommendedSalesNavigatorUrl: 'https://www.linkedin.com/sales/lead/fabricated-person',
      recommendedConnectionDegree: '2nd',
      companyDomain: 'fabricated.example',
      companyPublicLinkedInUrl: 'https://www.linkedin.com/company/1',
      companyEmployeeCount: 42,
      companyHeadquarters: 'London',
      companyContactEmail: 'sales@fabricated.example',
      companyContactEmailStatus: 'publicly_found',
      companyContactPhone: '+44 20 7946 0000',
      companyContactPhoneStatus: 'publicly_found',
      workEmail: 'person@fabricated.example',
      emailStatus: 'verified',
      mobilePhone: '+44 7700 900000',
      phoneStatus: 'publicly_found',
    })

    expect(normalized.companyContactEmail).toBe('sales@fabricated.example')
    expect(normalized.companyContactPhone).toBe('+44 20 7946 0000')
    expect(normalized.workEmail).toBe('person@fabricated.example')
    expect(normalized.mobilePhone).toBe('+44 7700 900000')
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
