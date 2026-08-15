import 'server-only'

/**
 * Companies House — official UK company registry facts.
 *
 * Outlio starts with a LinkedIn company name, not a Companies House number, so
 * a safe lookup is two-stage: exact legal-name search, then the profile endpoint
 * the user requested. A name shared by two registrations is ambiguous and is
 * refused. The cost of an empty cell is lower than attaching another legal
 * entity's filing status to a lead.
 *
 * The profile's registered office is deliberately NOT mapped to `headquarters`.
 * A registered office may be an accountant or formation agent; calling it HQ
 * would turn an official fact into a misleading one.
 */
import { Buffer } from 'node:buffer'

import { normalizeCompanyName } from '@/lib/companies/normalize'
import { ProviderHttpError, requestJson, setHostPacing } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
} from '@/lib/intelligence/types'

const HOST = 'api.company-information.service.gov.uk'
const API_BASE = `https://${HOST}`
const PUBLIC_BASE = 'https://find-and-update.company-information.service.gov.uk/company'

// The published limit is 600 calls per five minutes (two per second). A lookup
// normally needs search + profile, so 500ms pacing keeps concurrent workers
// inside the application-wide quota.
setHostPacing(HOST, 500)

type CompaniesHouseAddress = {
  premises?: unknown
  address_line_1?: unknown
  address_line_2?: unknown
  care_of?: unknown
  po_box?: unknown
  locality?: unknown
  region?: unknown
  postal_code?: unknown
  country?: unknown
}

export type CompaniesHouseSearchItem = {
  title?: unknown
  company_number?: unknown
  company_status?: unknown
  company_type?: unknown
}

type CompaniesHouseSearchResponse = {
  items?: unknown
}

export type CompaniesHouseProfile = {
  company_name?: unknown
  company_number?: unknown
  company_status?: unknown
  type?: unknown
  jurisdiction?: unknown
  date_of_creation?: unknown
  sic_codes?: unknown
  registered_office_address?: CompaniesHouseAddress
  accounts?: {
    next_accounts?: { overdue?: unknown }
    overdue?: unknown
  }
  confirmation_statement?: { overdue?: unknown }
  has_insolvency_history?: unknown
  links?: { insolvency?: unknown }
}

export type CompaniesHouseFacts = {
  companyName: string
  companyNumber: string
  companyStatus: string | null
  companyType: string | null
  jurisdiction: string | null
  incorporationDate: string | null
  sicCodes: string[]
  registeredOffice: string | null
  accountsOverdue: boolean | null
  confirmationStatementOverdue: boolean | null
  hasInsolvencyHistory: boolean | null
}

export const COMPANIES_HOUSE_FIELDS: readonly ResearchField[] = [
  'company_number',
  'company_status',
  'company_type',
  'jurisdiction',
  'incorporation_date',
  'sic_codes',
  'registered_office',
  'accounts_overdue',
  'confirmation_statement_overdue',
  'insolvency_history',
]

function cleanString(value: unknown, maxLength = 300): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, maxLength) : null
}

function cleanSearchTitle(value: unknown): string | null {
  const text = cleanString(value)
  if (!text) return null

  // Search titles are normally plain text, but highlighting/entity encoding
  // has appeared in Companies House clients. Strip markup before identity
  // comparison; none of it is part of a legal company name.
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCompanyNumber(value: unknown): string | null {
  const number = cleanString(value, 12)?.toUpperCase() ?? null
  return number && /^[A-Z0-9]{6,10}$/.test(number) ? number : null
}

/**
 * Selects one exact legal-name match. Near matches and duplicate legal names
 * are not enough evidence to bind a Companies House registration to an Outlio
 * company.
 */
export function pickCompaniesHouseCompany(
  companyName: string | null,
  candidates: readonly CompaniesHouseSearchItem[],
): { companyNumber: string; companyName: string } | null {
  const target = normalizeCompanyName(companyName)
  if (!target) return null

  const exact = candidates.flatMap((candidate) => {
    const name = cleanSearchTitle(candidate.title)
    const companyNumber = cleanCompanyNumber(candidate.company_number)
    if (!name || !companyNumber || normalizeCompanyName(name) !== target) return []
    return [{ companyNumber, companyName: name }]
  })

  return exact.length === 1 ? exact[0]! : null
}

export function formatRegisteredOffice(address: CompaniesHouseAddress | undefined): string | null {
  if (!address || typeof address !== 'object') return null

  const parts = [
    address.care_of,
    address.po_box,
    address.premises,
    address.address_line_1,
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ]
    .map((part) => cleanString(part, 160))
    .filter((part): part is string => Boolean(part))

  const seen = new Set<string>()
  const unique = parts.filter((part) => {
    const key = part.toLocaleLowerCase('en-GB')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return unique.length > 0 ? unique.join(', ').slice(0, 600) : null
}

function cleanDate(value: unknown): string | null {
  const date = cleanString(value, 10)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Pure, defensive projection of the profile response. */
export function extractCompaniesHouseFacts(
  profile: CompaniesHouseProfile,
): CompaniesHouseFacts | null {
  const companyName = cleanString(profile.company_name)
  const companyNumber = cleanCompanyNumber(profile.company_number)
  if (!companyName || !companyNumber) return null

  const sicCodes = Array.isArray(profile.sic_codes)
    ? [...new Set(profile.sic_codes.flatMap((code) => {
        const clean = cleanString(code, 5)
        return clean && /^\d{5}$/.test(clean) ? [clean] : []
      }))].slice(0, 20)
    : []

  return {
    companyName,
    companyNumber,
    companyStatus: cleanString(profile.company_status, 80),
    companyType: cleanString(profile.type, 100),
    jurisdiction: cleanString(profile.jurisdiction, 100),
    incorporationDate: cleanDate(profile.date_of_creation),
    sicCodes,
    registeredOffice: formatRegisteredOffice(profile.registered_office_address),
    // Prefer the current fields while retaining deprecated values as response
    // compatibility fallbacks for older/sparse company profiles.
    accountsOverdue:
      optionalBoolean(profile.accounts?.next_accounts?.overdue) ??
      optionalBoolean(profile.accounts?.overdue),
    confirmationStatementOverdue: optionalBoolean(profile.confirmation_statement?.overdue),
    hasInsolvencyHistory: cleanString(profile.links?.insolvency) !== null
      ? true
      : optionalBoolean(profile.has_insolvency_history),
  }
}

function authorization(apiKey: string): string {
  // Companies House uses HTTP Basic with the API key as username and an empty
  // password. The encoded header is never logged or persisted.
  return `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}`
}

async function searchCompanies(
  companyName: string,
  apiKey: string,
): Promise<CompaniesHouseSearchItem[]> {
  const params = new URLSearchParams({ q: companyName, items_per_page: '20' })
  const response = await requestJson<CompaniesHouseSearchResponse>({
    url: `${API_BASE}/search/companies?${params.toString()}`,
    headers: { authorization: authorization(apiKey) },
  })

  return Array.isArray(response.items)
    ? response.items.filter(
        (item): item is CompaniesHouseSearchItem => Boolean(item && typeof item === 'object'),
      )
    : []
}

async function fetchProfile(
  companyNumber: string,
  apiKey: string,
): Promise<CompaniesHouseProfile | null> {
  try {
    return await requestJson<CompaniesHouseProfile>({
      url: `${API_BASE}/company/${encodeURIComponent(companyNumber)}`,
      headers: { authorization: authorization(apiKey) },
    })
  } catch (error) {
    // A company can disappear between search and profile retrieval. That is a
    // real no-match, not an outage worth poisoning the rest of the run with.
    if (error instanceof ProviderHttpError && error.status === 404) return null
    throw error
  }
}

export const companiesHouseProvider: IntelligenceProvider<CompaniesHouseFacts | null> = {
  name: 'companies-house',
  category: 'company_profile',

  canHandle: (task) =>
    Boolean(process.env.COMPANIES_HOUSE_API_KEY) &&
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    task.fields.some((field) => COMPANIES_HOUSE_FIELDS.includes(field)),

  estimateCost: async () => 0,

  execute: async (task) => {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY
    const company = task.entity as CompanyEntity
    if (!apiKey || !company.name) return null

    const match = pickCompaniesHouseCompany(
      company.name,
      await searchCompanies(company.name, apiKey),
    )
    if (!match) return null

    const profile = await fetchProfile(match.companyNumber, apiKey)
    if (!profile) return null

    const facts = extractCompaniesHouseFacts(profile)
    // Search and profile must agree on identity. A stale or malformed search
    // result cannot redirect evidence onto another registration.
    if (
      !facts ||
      facts.companyNumber !== match.companyNumber ||
      normalizeCompanyName(facts.companyName) !== normalizeCompanyName(match.companyName)
    ) {
      return null
    }

    return facts
  },

  normalize: (facts, task): NormalizedEvidence[] => {
    if (!facts) return []

    const retrievedAt = new Date()
    const sourceUrl = `${PUBLIC_BASE}/${encodeURIComponent(facts.companyNumber)}`
    const evidence: NormalizedEvidence[] = []
    const push = (field: ResearchField, value: unknown, confidence = 0.97) => {
      if (value === null || value === undefined) return
      if (Array.isArray(value) && value.length === 0) return

      evidence.push({
        field,
        entityType: 'company',
        entityId: task.entity.id,
        value: { value },
        sourceProvider: 'companies-house',
        sourceUrl,
        sourceConfidence: 'high',
        confidence,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
      })
    }

    // Emit the whole profile from the same two-call lookup. The executor marks
    // unrequested facts as bonus evidence, stores them for reuse, and still
    // returns only the columns the user asked for.
    push('company_number', facts.companyNumber, 0.99)
    push('company_status', facts.companyStatus)
    push('company_type', facts.companyType)
    push('jurisdiction', facts.jurisdiction)
    push('incorporation_date', facts.incorporationDate)
    push('sic_codes', facts.sicCodes, 0.95)
    push('registered_office', facts.registeredOffice, 0.96)
    push('accounts_overdue', facts.accountsOverdue)
    push('confirmation_statement_overdue', facts.confirmationStatementOverdue)
    push('insolvency_history', facts.hasInsolvencyHistory)

    return evidence
  },
}
