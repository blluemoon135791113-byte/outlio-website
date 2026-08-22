import 'server-only'

/**
 * Wikidata — structured public facts about a company.
 *
 * Free, no key, and unusually valuable here for one reason: it states a
 * company's OFFICIAL WEBSITE as a claim rather than leaving us to infer one
 * from search ranking. On real data `domain` identified zero companies, and
 * everything keyed on a website depends on recovering it, so a sourced fact
 * beats the heuristic in `domain-discovery.ts` and is tried first.
 *
 * ⚠️ COVERAGE IS NOTABILITY-BASED. Large and well-known companies are here;
 * most SMBs on a Sales Navigator list are not. Expect this provider to return
 * nothing far more often than it returns something — which is correct behaviour,
 * not a failure, and is exactly why the waterfall has a next step.
 *
 * ⚠️ MATCHING THE WRONG ENTITY IS THE RISK. Wikidata is full of similarly named
 * people, albums, and towns. The entity must be an organisation AND its label
 * must correspond to the company name, or we take nothing.
 */
import { normalizeCompanyName, normalizeDomain } from '@/lib/companies/normalize'
import { requestJson, setHostPacing } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchField,
} from '@/lib/intelligence/types'

const WIKIDATA_HOST = 'www.wikidata.org'
const REST_BASE = `https://${WIKIDATA_HOST}/w/rest.php/wikibase/v1`
const ACTION_API = `https://${WIKIDATA_HOST}/w/api.php`

// A free community service. Pace it like a guest.
setHostPacing(WIKIDATA_HOST, 400)

/** Properties read. Everything else on the item is ignored. */
const P_INSTANCE_OF = 'P31'
const P_INDUSTRY = 'P452'
const P_HEADQUARTERS = 'P159'
const P_INCEPTION = 'P571'
const P_EMPLOYEES = 'P1128'
const P_WEBSITE = 'P856'

/**
 * `instance of` values that mean "this is a company".
 *
 * Without this gate, searching "Apollo" returns a Greek god and we would
 * confidently attach his founding date to a lead.
 */
const ORGANISATION_TYPES = new Set([
  'Q4830453', // business
  'Q783794', // company
  'Q6881511', // enterprise
  'Q43229', // organization
  'Q891723', // public company
  'Q210167', // software company
  'Q1058914', // software company (alt)
  'Q167037', // corporation
  'Q4671277', // academic institution
  'Q163740', // nonprofit organization
])

type SearchEntity = { id?: string; label?: string; description?: string }
type SearchResponse = { search?: SearchEntity[] }

type StatementValue = {
  content?: unknown
}
type Statement = { value?: StatementValue }
type ItemResponse = {
  id?: string
  labels?: Record<string, string>
  statements?: Record<string, Statement[]>
}

export type WikidataFacts = {
  entityId: string
  website: string | null
  domain: string | null
  employeeCount: number | null
  foundedYear: number | null
  industry: string | null
  headquarters: string | null
}

/**
 * Chooses the search hit that is actually this company, or nothing.
 *
 * PURE. Deliberately strict: the label must normalize to the same value as the
 * company name. "Acme" must not match "Acme Corporation (film)".
 */
export function pickWikidataEntity(
  companyName: string | null,
  candidates: readonly SearchEntity[],
): string | null {
  const target = normalizeCompanyName(companyName)
  if (!target) return null

  const matches = candidates.filter(
    (candidate) => candidate.id && normalizeCompanyName(candidate.label ?? '') === target,
  )

  if (matches.length === 1) return matches[0]!.id ?? null

  /*
   * Wikidata commonly returns an organisation, a person and a fictional
   * character with the same exact label ("Stripe" is a live example). Its
   * search description is useful only as a disambiguator here; the fetched
   * entity still has to pass the authoritative P31 organisation gate below.
   * Refuse if descriptions leave more than one plausible organisation.
   */
  const organisationDescription =
    /\b(?:company|corporation|business|enterprise|organisation|organization|firm|startup|bank|manufacturer|retailer|university|nonprofit)\b/i
  const describedOrganisations = matches.filter((candidate) =>
    organisationDescription.test(candidate.description ?? ''),
  )

  return describedOrganisations.length === 1 ? (describedOrganisations[0]!.id ?? null) : null
}

function statementContents(item: ItemResponse, property: string): unknown[] {
  return (item.statements?.[property] ?? [])
    .map((statement) => statement.value?.content)
    .filter((content) => content !== undefined && content !== null)
}

function isOrganisation(item: ItemResponse): boolean {
  return statementContents(item, P_INSTANCE_OF).some(
    (content) => typeof content === 'string' && ORGANISATION_TYPES.has(content),
  )
}

/** Wikidata quantities look like `{ amount: "+1234", unit: "1" }`. */
function readQuantity(content: unknown): number | null {
  if (typeof content !== 'object' || content === null) return null
  const amount = (content as { amount?: unknown }).amount
  if (typeof amount !== 'string') return null
  const parsed = Number.parseInt(amount.replace(/^\+/, ''), 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Times look like `{ time: "+2010-01-01T00:00:00Z", precision: 9 }`. */
function readYear(content: unknown): number | null {
  if (typeof content !== 'object' || content === null) return null
  const time = (content as { time?: unknown }).time
  if (typeof time !== 'string') return null
  const match = /^[+-](\d{4})/.exec(time)
  if (!match) return null
  const year = Number.parseInt(match[1]!, 10)
  return year > 1000 && year <= new Date().getFullYear() ? year : null
}

/**
 * Reads the facts we care about off a fetched item.
 *
 * PURE, so every shape quirk is testable against a recorded response. Returns
 * `null` when the item is not an organisation — the wrong-entity guard.
 */
export function extractWikidataFacts(
  item: ItemResponse,
  labelsById: Record<string, string> = {},
): WikidataFacts | null {
  if (!item.id || !isOrganisation(item)) return null

  const website = statementContents(item, P_WEBSITE).find(
    (content): content is string => typeof content === 'string',
  )

  const industryId = statementContents(item, P_INDUSTRY).find(
    (content): content is string => typeof content === 'string',
  )
  const headquartersId = statementContents(item, P_HEADQUARTERS).find(
    (content): content is string => typeof content === 'string',
  )

  return {
    entityId: item.id,
    website: website ?? null,
    domain: website ? normalizeDomain(website) : null,
    employeeCount: statementContents(item, P_EMPLOYEES).map(readQuantity).find((v) => v !== null) ?? null,
    foundedYear: statementContents(item, P_INCEPTION).map(readYear).find((v) => v !== null) ?? null,
    // Item ids are meaningless to a user; resolved to labels in a single
    // batched call rather than one lookup per company.
    industry: industryId ? (labelsById[industryId] ?? null) : null,
    headquarters: headquartersId ? (labelsById[headquartersId] ?? null) : null,
  }
}

/** Ids referenced by an item that need resolving to human-readable labels. */
export function referencedItemIds(item: ItemResponse): string[] {
  return [P_INDUSTRY, P_HEADQUARTERS]
    .flatMap((property) => statementContents(item, property))
    .filter((content): content is string => typeof content === 'string' && /^Q\d+$/.test(content))
}

async function searchEntities(name: string): Promise<SearchEntity[]> {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: name,
    language: 'en',
    uselang: 'en',
    type: 'item',
    limit: '10',
    format: 'json',
    origin: '*',
  })

  const response = await requestJson<SearchResponse>({ url: `${ACTION_API}?${params.toString()}` })
  return response.search ?? []
}

async function fetchLabels(ids: readonly string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}

  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: ids.slice(0, 50).join('|'),
    props: 'labels',
    languages: 'en',
    format: 'json',
  })

  const response = await requestJson<{
    entities?: Record<string, { labels?: { en?: { value?: string } } }>
  }>({ url: `${ACTION_API}?${params.toString()}` })

  const labels: Record<string, string> = {}
  for (const [id, entity] of Object.entries(response.entities ?? {})) {
    const label = entity.labels?.en?.value
    if (label) labels[id] = label
  }
  return labels
}

const WIKIDATA_FIELDS: ResearchField[] = [
  'company_domain',
  'employee_count',
  'industry',
  'headquarters',
]

export const wikidataProvider: IntelligenceProvider<WikidataFacts | null> = {
  name: 'wikidata',
  category: 'company_profile',

  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    task.fields.some((field) => WIKIDATA_FIELDS.includes(field)),

  estimateCost: async () => 0,

  execute: async (task) => {
    const company = task.entity as CompanyEntity

    const entityId = pickWikidataEntity(company.name, await searchEntities(company.name ?? ''))
    if (!entityId) return null

    const item = await requestJson<ItemResponse>({ url: `${REST_BASE}/entities/items/${entityId}` })
    const labels = await fetchLabels(referencedItemIds(item))
    return extractWikidataFacts(item, labels)
  },

  normalize: (facts, task): NormalizedEvidence[] => {
    if (!facts) return []

    const retrievedAt = new Date()
    const wanted = new Set(task.fields)
    const sourceUrl = `https://www.wikidata.org/wiki/${facts.entityId}`

    const base = {
      entityType: 'company' as const,
      entityId: task.entity.id,
      sourceProvider: 'wikidata',
      sourceUrl,
      /*
       * MEDIUM, not HIGH. Wikidata is structured and sourced, but it is
       * community-edited rather than the company speaking or a public filing.
       * Spec §17 reserves HIGH for official sources — an official company
       * website read directly would qualify; a claim about it does not.
       */
      sourceConfidence: 'medium' as const,
      retrievedAt: retrievedAt.toISOString(),
    }

    const evidence: NormalizedEvidence[] = []
    const push = (field: ResearchField, value: Record<string, unknown>, confidence: number) => {
      if (!wanted.has(field)) return
      evidence.push({
        ...base,
        field,
        value,
        confidence,
        expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
      })
    }

    if (facts.domain) {
      // Higher confidence than search inference: this is a stated fact about
      // the company, not a correspondence we noticed between a name and a host.
      push('company_domain', { domain: facts.domain, website: facts.website }, 0.9)
    }
    if (facts.employeeCount !== null) {
      push('employee_count', { count: facts.employeeCount }, 0.7)
    }
    if (facts.industry) {
      push('industry', { industry: facts.industry }, 0.75)
    }
    if (facts.headquarters) {
      push('headquarters', { headquarters: facts.headquarters }, 0.8)
    }

    return evidence
  },
}
