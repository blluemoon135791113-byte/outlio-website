import 'server-only'

/**
 * Official SEC EDGAR company metadata service and Outlio provider adapter.
 *
 * Public lookup flow:
 *   1. Read the shared ticker/CIK master list cache.
 *   2. If stale, download `/files/company_tickers.json` once and cache it.
 *   3. Resolve exactly one normalized legal-name match to a ten-digit CIK.
 *   4. Fetch `data.sec.gov/submissions/CIK##########.json`.
 *
 * The filer-token APIs at api.edgarfiling.sec.gov are intentionally not used;
 * they are for submitting filings, while this service only reads public data.
 */
import { normalizeCompanyName, normalizeDomain } from '@/lib/companies/normalize'
import {
  requestJson,
  setHostPacing,
  type ProviderRequest,
} from '@/lib/intelligence/http'
import {
  awaitProviderRequestSlot,
  readProviderCache,
  writeProviderCache,
} from '@/lib/intelligence/provider-state'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
} from '@/lib/intelligence/types'
import type { Json } from '@/types/database'

const MASTER_LIST_URL = 'https://www.sec.gov/files/company_tickers.json'
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions'
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data'
const CACHE_PROVIDER = 'sec-edgar'
const MASTER_CACHE_KEY = 'company-tickers-v1'
const MASTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_RESPONSE_BYTES = 5_000_000
const MAX_MASTER_ENTRIES = 50_000
const MAX_RECENT_FILINGS = 100

/**
 * SEC permits at most ten requests/second. Outlio targets five/second across
 * ALL instances and SEC hosts, leaving a two-times margin for deployment jitter.
 * The database scheduler enforces this again before every retry.
 */
export const SEC_MIN_REQUEST_INTERVAL_MS = 200
const SEC_RATE_BUCKET = 'sec.gov'

export const SEC_REQUEST_HEADERS = {
  'user-agent': 'OUTLIO husnain@outlio.io',
  'accept-encoding': 'gzip, deflate',
} as const

setHostPacing('www.sec.gov', SEC_MIN_REQUEST_INTERVAL_MS)
setHostPacing('data.sec.gov', SEC_MIN_REQUEST_INTERVAL_MS)

export const SEC_EDGAR_FIELDS: readonly ResearchField[] = [
  'sec_cik',
  'sec_legal_name',
  'sec_entity_type',
  'sec_sic',
  'sec_sic_description',
  'sec_ein',
  'sec_lei',
  'sec_tickers',
  'sec_exchanges',
  'sec_state_of_incorporation',
  'sec_business_address',
  'sec_website',
  'sec_former_names',
  'sec_filing_history',
]

export type SecMasterCompany = {
  cik: string
  names: string[]
  tickers: string[]
}

export type SecCompanyMatch = {
  cik: string
  matchedName: string
  tickers: string[]
}

export type SecBusinessAddress = {
  street1: string | null
  street2: string | null
  city: string | null
  stateOrCountry: string | null
  postalCode: string | null
  country: string | null
  formatted: string
}

export type SecFormerName = {
  name: string
  from: string | null
  to: string | null
}

export type SecFiling = {
  accessionNumber: string
  form: string
  filingDate: string
  reportDate: string | null
  acceptedAt: string | null
  fileNumber: string | null
  items: string | null
  primaryDocument: string | null
  primaryDocumentUrl: string | null
}

export type SecCompanyMetadata = {
  cik: string
  legalName: string
  matchedMasterName: string
  entityType: string | null
  sic: string | null
  sicDescription: string | null
  ein: string | null
  lei: string | null
  tickers: string[]
  exchanges: string[]
  stateOfIncorporation: string | null
  stateOfIncorporationDescription: string | null
  fiscalYearEnd: string | null
  businessAddress: SecBusinessAddress | null
  website: string | null
  websiteDomain: string | null
  investorWebsite: string | null
  formerNames: SecFormerName[]
  filingHistory: SecFiling[]
  sourceUrl: string
}

type RawMasterEntry = {
  cik_str?: unknown
  ticker?: unknown
  title?: unknown
  cik?: unknown
  names?: unknown
  tickers?: unknown
}

type RawSecAddress = {
  street1?: unknown
  street2?: unknown
  city?: unknown
  stateOrCountry?: unknown
  stateOrCountryDescription?: unknown
  zipCode?: unknown
  country?: unknown
}

type RawRecentFilings = {
  accessionNumber?: unknown
  filingDate?: unknown
  reportDate?: unknown
  acceptanceDateTime?: unknown
  form?: unknown
  fileNumber?: unknown
  items?: unknown
  primaryDocument?: unknown
}

export type RawSecSubmissions = {
  cik?: unknown
  entityType?: unknown
  sic?: unknown
  sicDescription?: unknown
  name?: unknown
  tickers?: unknown
  exchanges?: unknown
  ein?: unknown
  lei?: unknown
  stateOfIncorporation?: unknown
  stateOfIncorporationDescription?: unknown
  fiscalYearEnd?: unknown
  addresses?: { business?: RawSecAddress }
  website?: unknown
  investorWebsite?: unknown
  formerNames?: unknown
  filings?: { recent?: RawRecentFilings }
}

type RequestJson = <T>(request: ProviderRequest) => Promise<T>

export type SecEdgarDependencies = {
  requestJson: RequestJson
  readCache: typeof readProviderCache
  writeCache: typeof writeProviderCache
  awaitRequestSlot: typeof awaitProviderRequestSlot
  now: () => Date
}

const DEFAULT_DEPENDENCIES: SecEdgarDependencies = {
  requestJson,
  readCache: readProviderCache,
  writeCache: writeProviderCache,
  awaitRequestSlot: awaitProviderRequestSlot,
  now: () => new Date(),
}

function cleanString(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, maxLength) : null
}

function cleanCik(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const digits = String(value).trim()
  if (!/^\d{1,10}$/.test(digits)) return null
  return digits.padStart(10, '0')
}

function cleanTicker(value: unknown): string | null {
  const ticker = cleanString(value, 20)?.toUpperCase() ?? null
  return ticker && /^[A-Z0-9.-]{1,20}$/.test(ticker) ? ticker : null
}

function cleanStringList(value: unknown, maxItems = 50, maxLength = 160): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => {
    const clean = cleanString(item, maxLength)
    return clean ? [clean] : []
  }))].slice(0, maxItems)
}

function cleanDate(value: unknown): string | null {
  const date = cleanString(value, 10)
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date
}

function cleanDateTime(value: unknown): string | null {
  const date = cleanString(value, 40)
  if (!date || Number.isNaN(Date.parse(date))) return null
  return new Date(date).toISOString()
}

/** Removes SEC conformed-name location/ADR annotations, not substantive words. */
export function normalizeSecCompanyName(value: string | null | undefined): string | null {
  if (!value) return null
  const withoutAnnotation = value.replace(
    /\s*\/(?:[a-z]{2,4}|new|adr)\s*\/?\s*$/i,
    '',
  )
  return normalizeCompanyName(withoutAnnotation)
}

/** Defensive parser for both the upstream object and Outlio's cached array. */
export function parseSecMasterList(raw: unknown): SecMasterCompany[] {
  const candidates: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw as Record<string, unknown>)
      : []

  const grouped = new Map<string, { names: Set<string>; tickers: Set<string> }>()

  for (const candidate of candidates.slice(0, MAX_MASTER_ENTRIES)) {
    if (!candidate || typeof candidate !== 'object') continue
    const row = candidate as RawMasterEntry
    const cik = cleanCik(row.cik ?? row.cik_str)
    if (!cik) continue

    const title = cleanString(row.title, 300)
    const ticker = cleanTicker(row.ticker)
    const names = Array.isArray(row.names)
      ? cleanStringList(row.names, 10, 300)
      : title
        ? [title]
        : []
    const tickers = Array.isArray(row.tickers)
      ? row.tickers.flatMap((ticker) => cleanTicker(ticker) ?? [])
      : ticker
        ? [ticker]
        : []
    if (names.length === 0) continue

    const current = grouped.get(cik) ?? { names: new Set<string>(), tickers: new Set<string>() }
    names.forEach((name) => current.names.add(name))
    tickers.forEach((ticker) => current.tickers.add(ticker))
    grouped.set(cik, current)
  }

  return [...grouped.entries()]
    .map(([cik, value]) => ({
      cik,
      names: [...value.names],
      tickers: [...value.tickers].sort(),
    }))
    .sort((a, b) => a.cik.localeCompare(b.cik))
}

/**
 * Resolves only one exact normalized legal-name match. SEC's list is not a
 * fuzzy entity resolver; near matches and one name mapping to multiple CIKs
 * remain unknown for Outlio's higher-level matching engine to adjudicate.
 */
export function pickSecCompany(
  companyName: string | null,
  companies: readonly SecMasterCompany[],
): SecCompanyMatch | null {
  const target = normalizeSecCompanyName(companyName)
  if (!target) return null

  const matches = companies.flatMap((company) => {
    const matchedName = company.names.find(
      (name) => normalizeSecCompanyName(name) === target,
    )
    return matchedName ? [{ cik: company.cik, matchedName, tickers: company.tickers }] : []
  })

  return matches.length === 1 ? matches[0]! : null
}

function cleanBusinessAddress(value: RawSecAddress | undefined): SecBusinessAddress | null {
  if (!value || typeof value !== 'object') return null
  const street1 = cleanString(value.street1, 200)
  const street2 = cleanString(value.street2, 200)
  const city = cleanString(value.city, 120)
  const stateOrCountry = cleanString(value.stateOrCountry, 120)
  const postalCode = cleanString(value.zipCode, 40)
  const country = cleanString(value.country, 120)
  const formatted = [street1, street2, city, stateOrCountry, postalCode, country]
    .filter((part): part is string => Boolean(part))
    .join(', ')
    .slice(0, 700)

  if (!formatted) return null
  return { street1, street2, city, stateOrCountry, postalCode, country, formatted }
}

function cleanWebsite(value: unknown): { url: string; domain: string } | null {
  const raw = cleanString(value, 500)
  const domain = normalizeDomain(raw)
  return domain ? { url: `https://${domain}`, domain } : null
}

function cleanFormerNames(value: unknown): SecFormerName[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const name = cleanString(record.name, 300)
    if (!name) return []
    return [{
      name,
      from: cleanDateTime(record.from),
      to: cleanDateTime(record.to),
    }]
  }).slice(0, 30)
}

function valueAt(values: unknown, index: number): unknown {
  return Array.isArray(values) ? values[index] : undefined
}

function filingDocumentUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string | null,
): string | null {
  if (
    !primaryDocument ||
    primaryDocument.includes('..') ||
    !/^[a-zA-Z0-9_./-]+$/.test(primaryDocument)
  ) return null

  const cikWithoutZeros = String(Number.parseInt(cik, 10))
  const accessionWithoutDashes = accessionNumber.replace(/-/g, '')
  const safePath = primaryDocument.split('/').map(encodeURIComponent).join('/')
  return `${ARCHIVES_BASE}/${cikWithoutZeros}/${accessionWithoutDashes}/${safePath}`
}

export function cleanRecentFilings(cik: string, recent: RawRecentFilings | undefined): SecFiling[] {
  if (!recent || typeof recent !== 'object' || !Array.isArray(recent.accessionNumber)) return []
  const filings: SecFiling[] = []

  for (let index = 0; index < recent.accessionNumber.length; index += 1) {
    if (filings.length >= MAX_RECENT_FILINGS) break
    const accessionNumber = cleanString(recent.accessionNumber[index], 20)
    const form = cleanString(valueAt(recent.form, index), 40)
    const filingDate = cleanDate(valueAt(recent.filingDate, index))
    if (!accessionNumber || !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber) || !form || !filingDate) {
      continue
    }

    const primaryDocument = cleanString(valueAt(recent.primaryDocument, index), 300)
    filings.push({
      accessionNumber,
      form,
      filingDate,
      reportDate: cleanDate(valueAt(recent.reportDate, index)),
      acceptedAt: cleanDateTime(valueAt(recent.acceptanceDateTime, index)),
      fileNumber: cleanString(valueAt(recent.fileNumber, index), 80),
      items: cleanString(valueAt(recent.items, index), 500),
      primaryDocument,
      primaryDocumentUrl: filingDocumentUrl(cik, accessionNumber, primaryDocument),
    })
  }

  return filings
}

/** Pure projection of the SEC submissions response into the matching payload. */
export function extractSecCompanyMetadata(
  raw: RawSecSubmissions,
  match: SecCompanyMatch,
): SecCompanyMetadata | null {
  const cik = cleanCik(raw.cik)
  const legalName = cleanString(raw.name, 300)
  if (!cik || cik !== match.cik || !legalName) return null

  const website = cleanWebsite(raw.website)
  const investorWebsite = cleanWebsite(raw.investorWebsite)
  const profileTickers = cleanStringList(raw.tickers, 50, 20)
    .flatMap((ticker) => cleanTicker(ticker) ?? [])

  return {
    cik,
    legalName,
    matchedMasterName: match.matchedName,
    entityType: cleanString(raw.entityType, 80),
    sic: /^\d{4}$/.test(cleanString(raw.sic, 4) ?? '') ? cleanString(raw.sic, 4) : null,
    sicDescription: cleanString(raw.sicDescription, 200),
    ein: /^\d{9}$/.test(cleanString(raw.ein, 9) ?? '') ? cleanString(raw.ein, 9) : null,
    lei: /^[A-Z0-9]{20}$/.test(cleanString(raw.lei, 20) ?? '')
      ? cleanString(raw.lei, 20)
      : null,
    tickers: [...new Set([...profileTickers, ...match.tickers])],
    exchanges: cleanStringList(raw.exchanges, 50, 100),
    stateOfIncorporation: cleanString(raw.stateOfIncorporation, 80),
    stateOfIncorporationDescription: cleanString(raw.stateOfIncorporationDescription, 160),
    fiscalYearEnd: /^\d{4}$/.test(cleanString(raw.fiscalYearEnd, 4) ?? '')
      ? cleanString(raw.fiscalYearEnd, 4)
      : null,
    businessAddress: cleanBusinessAddress(raw.addresses?.business),
    website: website?.url ?? null,
    websiteDomain: website?.domain ?? null,
    investorWebsite: investorWebsite?.url ?? null,
    formerNames: cleanFormerNames(raw.formerNames),
    filingHistory: cleanRecentFilings(cik, raw.filings?.recent),
    sourceUrl: `${SUBMISSIONS_BASE}/CIK${cik}.json`,
  }
}

export class SecEdgarService {
  private readonly dependencies: SecEdgarDependencies
  private masterListInFlight: Promise<SecMasterCompany[]> | null = null
  private memoryMasterList: { companies: SecMasterCompany[]; expiresAt: number } | null = null

  constructor(dependencies: Partial<SecEdgarDependencies> = {}) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  }

  /** Business name → official SEC metadata, or null when identity is uncertain. */
  async searchCompanyByName(companyName: string): Promise<SecCompanyMetadata | null> {
    const match = pickSecCompany(companyName, await this.getMasterList())
    if (!match) return null

    const raw = await this.secRequest<RawSecSubmissions>(
      `${SUBMISSIONS_BASE}/CIK${match.cik}.json`,
    )
    return extractSecCompanyMetadata(raw, match)
  }

  /** Shared durable cache plus same-process promise coalescing. */
  async getMasterList(): Promise<SecMasterCompany[]> {
    const now = this.dependencies.now()
    if (this.memoryMasterList && this.memoryMasterList.expiresAt > now.getTime()) {
      return this.memoryMasterList.companies
    }

    if (!this.masterListInFlight) {
      this.masterListInFlight = this.loadMasterList().finally(() => {
        this.masterListInFlight = null
      })
    }
    return this.masterListInFlight
  }

  private async loadMasterList(): Promise<SecMasterCompany[]> {
    const now = this.dependencies.now()
    const cached = await this.dependencies.readCache<unknown>(
      CACHE_PROVIDER,
      MASTER_CACHE_KEY,
      now,
    )
    const cachedCompanies = parseSecMasterList(cached?.value)
    if (cachedCompanies.length > 0 && cached) {
      this.memoryMasterList = {
        companies: cachedCompanies,
        expiresAt: Date.parse(cached.expiresAt),
      }
      return cachedCompanies
    }

    const raw = await this.secRequest<unknown>(MASTER_LIST_URL)
    const companies = parseSecMasterList(raw)
    if (companies.length === 0) throw new Error('SEC master list was empty or invalid')

    await this.dependencies.writeCache(
      CACHE_PROVIDER,
      MASTER_CACHE_KEY,
      companies as unknown as Json,
      now,
      new Date(now.getTime() + MASTER_CACHE_TTL_MS),
    )
    this.memoryMasterList = {
      companies,
      expiresAt: now.getTime() + MASTER_CACHE_TTL_MS,
    }
    return companies
  }

  private async secRequest<T>(url: string): Promise<T> {
    return this.dependencies.requestJson<T>({
      url,
      headers: { ...SEC_REQUEST_HEADERS },
      maxBytes: MAX_RESPONSE_BYTES,
      beforeAttempt: () =>
        this.dependencies.awaitRequestSlot(SEC_RATE_BUCKET, SEC_MIN_REQUEST_INTERVAL_MS),
    })
  }
}

export const secEdgarService = new SecEdgarService()

export const secEdgarProvider: IntelligenceProvider<SecCompanyMetadata | null> = {
  name: 'sec-edgar',
  category: 'company_profile',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    task.fields.some((field) => SEC_EDGAR_FIELDS.includes(field)),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    return company.name ? secEdgarService.searchCompanyByName(company.name) : null
  },

  normalize: (metadata, task): NormalizedEvidence[] => {
    if (!metadata) return []

    const retrievedAt = new Date()
    const evidence: NormalizedEvidence[] = []
    const push = (field: ResearchField, value: Record<string, unknown>, confidence = 0.97) => {
      evidence.push({
        field,
        entityType: 'company',
        entityId: task.entity.id,
        value,
        sourceProvider: 'sec-edgar',
        sourceUrl: metadata.sourceUrl,
        sourceConfidence: 'high',
        confidence,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
      })
    }

    push('sec_cik', { value: metadata.cik }, 0.99)
    push('sec_legal_name', { value: metadata.legalName })
    if (metadata.entityType) push('sec_entity_type', { value: metadata.entityType })
    if (metadata.sic) push('sec_sic', { value: metadata.sic })
    if (metadata.sicDescription) push('sec_sic_description', { value: metadata.sicDescription })
    if (metadata.ein) push('sec_ein', { value: metadata.ein })
    if (metadata.lei) push('sec_lei', { value: metadata.lei })
    if (metadata.tickers.length > 0) push('sec_tickers', { value: metadata.tickers })
    if (metadata.exchanges.length > 0) push('sec_exchanges', { value: metadata.exchanges })
    if (metadata.stateOfIncorporation) {
      push('sec_state_of_incorporation', {
        value: metadata.stateOfIncorporation,
        description: metadata.stateOfIncorporationDescription,
      })
    }
    if (metadata.businessAddress) {
      push('sec_business_address', {
        value: metadata.businessAddress.formatted,
        address: metadata.businessAddress,
      })
    }
    if (metadata.website) {
      push('sec_website', {
        value: metadata.websiteDomain ?? metadata.website,
        url: metadata.website,
        domain: metadata.websiteDomain,
      })
    }
    if (metadata.formerNames.length > 0) {
      push('sec_former_names', {
        value: metadata.formerNames.map((formerName) => formerName.name),
        names: metadata.formerNames,
      })
    }
    if (metadata.filingHistory.length > 0) {
      push('sec_filing_history', {
        value: [...new Set(metadata.filingHistory.map((filing) => filing.form))],
        filings: metadata.filingHistory,
      }, 0.99)
    }

    // The SEC-supplied website is also useful to every existing domain-based
    // tool. It is bonus evidence, so it never adds an unrequested result column.
    if (metadata.websiteDomain) {
      push('company_domain', {
        domain: metadata.websiteDomain,
        website: metadata.website,
      }, 0.96)
    }

    return evidence
  },
}
