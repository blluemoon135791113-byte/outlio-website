import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  companiesHouseProvider,
  extractCompaniesHouseFacts,
  formatRegisteredOffice,
  pickCompaniesHouseCompany,
  type CompaniesHouseFacts,
} from '@/lib/intelligence/providers/companies-house'
import type { ResearchTask } from '@/lib/intelligence/types'

const originalKey = process.env.COMPANIES_HOUSE_API_KEY
const COMPANY_ID = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalKey === undefined) delete process.env.COMPANIES_HOUSE_API_KEY
  else process.env.COMPANIES_HOUSE_API_KEY = originalKey
})

function task(fields: ResearchTask['fields'] = ['company_status']): ResearchTask {
  return {
    id: 'company_profile:company:test',
    category: 'company_profile',
    entity: {
      type: 'company',
      id: COMPANY_ID,
      name: 'Acme Systems',
      domain: 'acme.example',
      linkedinUrl: null,
    },
    fields,
  }
}

const PROFILE = {
  company_name: 'ACME SYSTEMS LIMITED',
  company_number: '01234567',
  company_status: 'active',
  type: 'ltd',
  jurisdiction: 'england-wales',
  date_of_creation: '2019-04-12',
  sic_codes: ['62012', '62020', 'bad'],
  registered_office_address: {
    premises: '10',
    address_line_1: 'Example Street',
    locality: 'London',
    postal_code: 'SW1A 1AA',
    country: 'United Kingdom',
  },
  accounts: { next_accounts: { overdue: false }, overdue: true },
  confirmation_statement: { overdue: true },
  has_insolvency_history: false,
}

describe('Companies House identity matching', () => {
  it('accepts one exact legal-name match and ignores legal suffix differences', () => {
    expect(
      pickCompaniesHouseCompany('Acme Systems', [
        { title: 'ACME SYSTEMS LIMITED', company_number: '01234567' },
        { title: 'Acme Systems Consulting Ltd', company_number: '76543210' },
      ]),
    ).toEqual({ companyNumber: '01234567', companyName: 'ACME SYSTEMS LIMITED' })
  })

  it('decodes search highlighting and HTML entities before comparing', () => {
    expect(
      pickCompaniesHouseCompany('Smith & Sons', [
        { title: '<strong>SMITH &amp; SONS</strong> LTD', company_number: 'SC123456' },
      ]),
    ).toEqual({ companyNumber: 'SC123456', companyName: 'SMITH & SONS LTD' })
  })

  it('refuses two registrations with the same normalized legal name', () => {
    expect(
      pickCompaniesHouseCompany('Acme Systems', [
        { title: 'ACME SYSTEMS LTD', company_number: '01234567' },
        { title: 'ACME SYSTEMS LIMITED', company_number: '76543210' },
      ]),
    ).toBeNull()
  })

  it('refuses near matches, malformed numbers, and absent names', () => {
    expect(
      pickCompaniesHouseCompany('Acme Systems', [
        { title: 'Acme System Holdings Ltd', company_number: '01234567' },
      ]),
    ).toBeNull()
    expect(
      pickCompaniesHouseCompany('Acme Systems', [
        { title: 'Acme Systems Ltd', company_number: '../secret' },
      ]),
    ).toBeNull()
    expect(pickCompaniesHouseCompany(null, [])).toBeNull()
  })
})

describe('Companies House profile extraction', () => {
  it('projects official profile facts without turning SIC into a guessed industry', () => {
    expect(extractCompaniesHouseFacts(PROFILE)).toEqual({
      companyName: 'ACME SYSTEMS LIMITED',
      companyNumber: '01234567',
      companyStatus: 'active',
      companyType: 'ltd',
      jurisdiction: 'england-wales',
      incorporationDate: '2019-04-12',
      sicCodes: ['62012', '62020'],
      registeredOffice: '10, Example Street, London, SW1A 1AA, United Kingdom',
      accountsOverdue: false,
      confirmationStatementOverdue: true,
      hasInsolvencyHistory: false,
    })
  })

  it('preserves unknown booleans as null rather than false', () => {
    const facts = extractCompaniesHouseFacts({
      company_name: 'Acme Systems Ltd',
      company_number: '01234567',
    })

    expect(facts).toMatchObject({
      accountsOverdue: null,
      confirmationStatementOverdue: null,
      hasInsolvencyHistory: null,
    })
  })

  it('prefers current account and insolvency fields over deprecated fallbacks', () => {
    const facts = extractCompaniesHouseFacts({
      company_name: 'Acme Systems Ltd',
      company_number: '01234567',
      accounts: { next_accounts: { overdue: false }, overdue: true },
      links: { insolvency: '/company/01234567/insolvency' },
      has_insolvency_history: false,
    })

    expect(facts).toMatchObject({
      accountsOverdue: false,
      hasInsolvencyHistory: true,
    })
  })

  it('rejects a profile with no trustworthy identity', () => {
    expect(extractCompaniesHouseFacts({ company_name: 'Acme' })).toBeNull()
    expect(extractCompaniesHouseFacts({ company_number: '01234567' })).toBeNull()
  })

  it('deduplicates repeated registered-office components', () => {
    expect(
      formatRegisteredOffice({
        address_line_1: '1 High Street',
        address_line_2: '1 HIGH STREET',
        locality: 'London',
      }),
    ).toBe('1 High Street, London')
  })
})

describe('Companies House provider', () => {
  it('calls search then the requested company profile with Basic auth', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'unit-test-companies-house-key'
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe(
        `Basic ${Buffer.from('unit-test-companies-house-key:').toString('base64')}`,
      )
      expect(href).not.toContain('unit-test-companies-house-key')

      if (href.includes('/search/companies?')) {
        return Response.json({
          items: [{ title: 'ACME SYSTEMS LIMITED', company_number: '01234567' }],
        })
      }
      expect(href.endsWith('/company/01234567')).toBe(true)
      return Response.json(PROFILE)
    })
    vi.stubGlobal('fetch', fetchMock)

    const facts = await companiesHouseProvider.execute(task())

    expect(facts).toMatchObject({ companyNumber: '01234567', companyStatus: 'active' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not buy a profile call when search identity is ambiguous', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'unit-test-companies-house-key'
    const fetchMock = vi.fn(async () =>
      Response.json({
        items: [
          { title: 'ACME SYSTEMS LTD', company_number: '01234567' },
          { title: 'ACME SYSTEMS LIMITED', company_number: '76543210' },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(companiesHouseProvider.execute(task())).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('emits all facts from one call so unrequested values can be cached as bonus evidence', () => {
    const facts = extractCompaniesHouseFacts(PROFILE) as CompaniesHouseFacts
    const evidence = companiesHouseProvider.normalize(facts, task(['company_status']))
    const byField = new Map(evidence.map((item) => [item.field, item]))

    expect(byField.get('company_status')?.value).toEqual({ value: 'active' })
    expect(byField.get('company_number')?.value).toEqual({ value: '01234567' })
    expect(byField.get('accounts_overdue')?.value).toEqual({ value: false })
    expect(byField.get('confirmation_statement_overdue')?.value).toEqual({ value: true })
    expect(evidence.every((item) => item.sourceConfidence === 'high')).toBe(true)
    expect(evidence.every((item) => item.sourceUrl?.endsWith('/01234567'))).toBe(true)
  })

  it('declines without a key and declines unrelated company-profile fields', () => {
    delete process.env.COMPANIES_HOUSE_API_KEY
    expect(companiesHouseProvider.canHandle(task())).toBe(false)

    process.env.COMPANIES_HOUSE_API_KEY = 'unit-test-companies-house-key'
    expect(companiesHouseProvider.canHandle(task(['employee_count']))).toBe(false)
    expect(companiesHouseProvider.canHandle(task(['company_status']))).toBe(true)
  })
})
