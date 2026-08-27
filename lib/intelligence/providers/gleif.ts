import 'server-only'

/**
 * GLEIF — the official global LEI registry.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 *  FREE, OFFICIAL, AND JURISDICTION-AGNOSTIC. Where Companies House covers one
 *  country and SEC EDGAR covers US filers, the Global Legal Entity Identifier
 *  Foundation registers entities in EVERY jurisdiction that issues LEIs —
 *  including the small ones (BVI, Jersey, Cayman, Delaware LLCs, EU members)
 *  no other free source reaches. No key, published open data.
 *
 *  IDENTITY DISCIPLINE, same rule as Companies House: Outlio starts from a
 *  LinkedIn company name, so a lookup is exact-normalized-legal-name search,
 *  and TWO candidate registrations under one name are ambiguous and refused.
 *  The cost of an empty cell is lower than binding another legal entity's
 *  record to a lead.
 *
 *  ⚠️ AN LEI REGISTRATION DATE IS NOT AN INCORPORATION DATE. The record carries
 *  when the LEI was ISSUED, which can be years after the company began. It is
 *  deliberately never mapped to `incorporation_date`.
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { normalizeCompanyName } from '@/lib/companies/normalize'
import { requestJson, setHostPacing } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
} from '@/lib/intelligence/types'

const HOST = 'api.gleif.org'
const API_BASE = `https://${HOST}/api/v1`

/** Open public data. One request per second keeps concurrent workers polite. */
setHostPacing(HOST, 1000)

export type GleifSearchItem = {
  id?: unknown
  attributes?: {
    lei?: unknown
    entity?: {
      legalName?: unknown
      status?: unknown
      jurisdiction?: unknown
      legalForm?: unknown
      legalAddress?: unknown
    }
    registration?: { status?: unknown }
  }
}

export type GleifFacts = {
  lei: string
  legalName: string
  entityStatus: string | null
  jurisdiction: string | null
  legalForm: string | null
  registeredOffice: string | null
}

export const GLEIF_FIELDS: readonly ResearchField[] = [
  'lei_number',
  'company_status',
  'company_type',
  'jurisdiction',
  'registered_office',
]

function cleanString(value: unknown, maxLength = 300): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, maxLength) : null
}

/** An LEI is exactly 20 alphanumeric characters, assigned by GLEIF. */
function cleanLei(value: unknown): string | null {
  const lei = cleanString(value, 20)?.toUpperCase() ?? null
  return lei && /^[A-Z0-9]{20}$/.test(lei) ? lei : null
}

/**
 * The legal name arrives wrapped (`{ name: … }`) and the legal form as either a
 * plain string or an `{ id, other }` pair depending on API revision.
 */
function legalNameOf(record: GleifSearchItem): string | null {
  const raw = record.attributes?.entity?.legalName
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return cleanString((raw as { name?: unknown }).name)
  }
  return cleanString(raw)
}

function legalFormOf(record: GleifSearchItem): string | null {
  const raw = record.attributes?.entity?.legalForm
  if (typeof raw === 'string') return cleanString(raw, 160)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const form = raw as { other?: unknown; id?: unknown }
    return cleanString(form.other, 160) ?? cleanString(form.id, 40)
  }
  return null
}

/**
 * GLEIF address blocks carry unlabelled `addressLines` arrays alongside the
 * named parts. Both shapes have been observed across API revisions.
 */
export function formatGleifAddress(address: unknown): string | null {
  if (!address || typeof address !== 'object') return null

  const record = address as { addressLines?: unknown; city?: unknown; region?: unknown; postalCode?: unknown; country?: unknown }

  const lines = Array.isArray(record.addressLines)
    ? record.addressLines
    : typeof record.addressLines === 'string'
      ? [record.addressLines]
      : []

  const parts = [
    ...lines,
    record.city,
    record.region,
    record.postalCode,
    record.country,
  ]
    .map((part) => cleanString(part, 160))
    .filter((part): part is string => Boolean(part))

  const seen = new Set<string>()
  const unique = parts.filter((part) => {
    const key = part.toLocaleLowerCase('en')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return unique.length > 0 ? unique.join(', ').slice(0, 600) : null
}

/**
 * Selects the single record whose LEGAL NAME matches the company exactly after
 * normalization. Zero matches and two-plus matches both refuse.
 */
export function pickGleifRecord(
  companyName: string | null,
  candidates: readonly GleifSearchItem[],
): GleifSearchItem | null {
  const target = normalizeCompanyName(companyName)
  if (!target) return null

  const exact = candidates.filter((candidate) => {
    const name = legalNameOf(candidate)
    return Boolean(name && normalizeCompanyName(name) === target)
  })

  return exact.length === 1 ? exact[0]! : null
}

/** Pure, defensive projection of one LEI record. */
export function extractGleifFacts(record: GleifSearchItem): GleifFacts | null {
  const recordId = cleanLei(record.id)
  const lei = cleanLei(record.attributes?.lei) ?? recordId
  const legalName = legalNameOf(record)
  // The top-level resource id and the payload LEI must agree; a disagreement
  // means a malformed or tampered response, not a fact about the company.
  if (!lei || !legalName || (recordId !== null && recordId !== lei)) return null

  return {
    lei,
    legalName,
    entityStatus: cleanString(record.attributes?.entity?.status, 60),
    jurisdiction: cleanString(record.attributes?.entity?.jurisdiction, 60),
    legalForm: legalFormOf(record),
    registeredOffice: formatGleifAddress(record.attributes?.entity?.legalAddress),
  }
}

async function searchLeiRecords(companyName: string): Promise<GleifSearchItem[]> {
  // Quoted filter = exact-phrase legal-name search server-side; the client-side
  // normalized comparison above remains the identity gate.
  const params = new URLSearchParams({
    'filter[entity.legalName]': `"${companyName.replace(/"/g, '')}"`,
    'page[size]': '20',
  })
  const response = await requestJson<{ data?: unknown }>({
    url: `${API_BASE}/lei-records?${params.toString()}`,
  })

  return Array.isArray(response.data)
    ? response.data.filter(
        (item): item is GleifSearchItem => Boolean(item && typeof item === 'object'),
      )
    : []
}

export const gleifProvider: IntelligenceProvider<GleifFacts | null> = {
  name: 'gleif',
  category: 'company_profile',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    task.fields.some((field) => GLEIF_FIELDS.includes(field)),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity
    if (!company.name) return null

    const match = pickGleifRecord(company.name, await searchLeiRecords(company.name))
    return match ? extractGleifFacts(match) : null
  },

  normalize: (facts, task): NormalizedEvidence[] => {
    if (!facts) return []

    const retrievedAt = new Date()
    const sourceUrl = `${API_BASE}/lei-records/${encodeURIComponent(facts.lei)}`
    const evidence: NormalizedEvidence[] = []
    const push = (field: ResearchField, value: unknown, confidence = 0.95) => {
      if (value === null || value === undefined) return

      evidence.push({
        field,
        entityType: 'company',
        entityId: task.entity.id,
        value: { value },
        sourceProvider: 'gleif',
        sourceUrl,
        sourceConfidence: 'high',
        confidence,
        retrievedAt: retrievedAt.toISOString(),
        expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
      })
    }

    push('lei_number', facts.lei, 0.99)
    push('company_status', facts.entityStatus)
    push('company_type', facts.legalForm)
    push('jurisdiction', facts.jurisdiction)
    push('registered_office', facts.registeredOffice, 0.93)

    return evidence
  },
}
