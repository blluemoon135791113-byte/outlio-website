import 'server-only'

/**
 * A company's published phone and email, found OFF its own site.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY: THE COMPANY'S OWN SITE IS NOT THE ONLY PLACE IT LISTS ITSELF.      ║
 * ║                                                                          ║
 * ║  `company-contact` reads the company's website and nothing else, so a    ║
 * ║  company with no website, or one whose site publishes no contact, ended  ║
 * ║  with nothing (measured 2026-10-29: 14 of 30 companies with a domain).   ║
 * ║  Business directories, registries, trade associations, chambers and map  ║
 * ║  listings state the same switchboard and inbox. This searches for the    ║
 * ║  company by name and reads those listings.                               ║
 * ║                                                                          ║
 * ║  ⚠️ ONLY BESIDE THE COMPANY'S NAME. A directory page lists dozens of     ║
 * ║  companies; a number is this company's only when it sits next to this    ║
 * ║  company's name, in the same paragraph, and is the only number there.    ║
 * ║  Every value is literally observed and cited (rule 4) — the name and     ║
 * ║  domain are never combined into an address.                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Runs only as its own pass in `processResearchRun`, AFTER the company's own
 * site has been read (see `externalContactTask`): spending searches on a
 * company whose website would have answered is exactly the waste to avoid.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

import { normalizeCompanyName, normalizeDomain } from '@/lib/companies/normalize'
import { httpPageFetcher } from '@/lib/hubble/fetch/fetcher'
import { recordFetch } from '@/lib/intelligence/observe'
import { isPeopleSearchSource } from '@/lib/intelligence/source-policy'
import { isFetchFailure, type FetchedPage, type SearchHit } from '@/lib/hubble/providers/types'
import { hasWebSearch, serpSearch } from '@/lib/search'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import {
  isProviderMiss,
  type CompanyEntity,
  type IntelligenceProvider,
  type NormalizedEvidence,
  type ProviderMiss,
  type ResearchField,
  type ResearchTask,
} from '@/lib/intelligence/types'

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
// An optional opening bracket, so "(800) 422-4641" is not read as "800) 422-4641".
const PHONE = /(?<![\d(])(?:\+?\(?\d[\d().\t -]{6,}\d)(?!\d)/g

/**
 * Countries a national number (no `+`) is checked against. A number valid in
 * none of them is not filed: "02908-3700" is a US ZIP+4, not a phone
 * (measured 2026-10-29 on a directory listing).
 */
const NATIONAL_REGIONS = ['US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'DE', 'FR', 'NL', 'ES', 'IT', 'IN', 'PK', 'AE', 'SG', 'ZA'] as const

/**
 * Local parts that describe an address FORMAT rather than state an address —
 * contact-data directories print "first.last@acme.com" as a pattern. Filing
 * one would be a synthesised address with a citation attached (rule 4).
 */
const PLACEHOLDER_LOCAL = /^(?:(?:first|last|firstname|lastname|middle|initial|name|fname|lname|firs|fir|las|fi|la|fl|f|l|m|i|john|jane|doe|smith|jdoe|jsmith|example|test|user|your|yourname|email)[._-]?)+$/i

/** Text that introduces an address FORMAT ("email format: …", "pattern"). */
const FORMAT_TALK = /\b(?:format|pattern|structure|formula)s?\b/i

/** Free-mail domains a small business may list as its contact address. */
const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'live.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'aol.com',
  'proton.me', 'protonmail.com', 'zoho.com', 'gmx.com',
])

/** Words that name no company on their own ("Global Solutions" is anyone). */
const GENERIC_WORDS = new Set([
  'group', 'global', 'international', 'holdings', 'solutions', 'services', 'systems',
  'technologies', 'technology', 'digital', 'consulting', 'consultancy', 'partners',
  'agency', 'media', 'marketing', 'management', 'company', 'enterprises', 'industries',
  'software', 'labs', 'studio', 'studios', 'ventures', 'capital', 'network', 'networks',
  'the', 'and', 'of', 'uk', 'us', 'usa', 'europe',
])

/** Text read either side of the company's name, cut at a paragraph break. */
const WINDOW_BEFORE = 80
const WINDOW_AFTER = 250

/** Result pages opened per company once snippets carry nothing. */
export const EXTERNAL_PAGES_OPENED = 3

const FIELDS = new Set<ResearchField>(['company_contact_email', 'company_contact_phone'])

/* -------------------------------------------------------------------------- *
 * The dedicated pass
 * -------------------------------------------------------------------------- */

const TASK_PREFIX = 'external_contact:'

/**
 * The task for this pass. The provider declines every other task, so the
 * ordinary company waterfall never reaches it.
 */
export function externalContactTask(company: CompanyEntity, fields: ResearchField[]): ResearchTask {
  return {
    id: `${TASK_PREFIX}company:${company.id}`,
    category: 'company_profile',
    entity: company,
    fields: fields.filter((field) => FIELDS.has(field)),
  }
}

/* -------------------------------------------------------------------------- *
 * Matching (pure)
 * -------------------------------------------------------------------------- */

/** The name as words, legal form removed; null when it names nobody in particular. */
export function distinctiveName(name: string | null): string[] | null {
  const words = normalizeCompanyName(name)?.split(' ').filter(Boolean) ?? []
  const distinctive = words.filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word))
  return distinctive.length > 0 ? words : null
}

/** Where the company's name appears, whole, in `text`. */
function nameOccurrences(text: string, words: readonly string[]): Array<{ at: number; end: number }> {
  const body = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]{1,3}')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu')
  return [...text.matchAll(pattern)]
    .slice(0, 20)
    .map((match) => ({ at: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
}

function windowAround(text: string, at: number, end: number): string {
  const paragraphStart = text.lastIndexOf('\n\n', at)
  const paragraphEnd = text.indexOf('\n\n', end)
  const from = Math.max(at - WINDOW_BEFORE, paragraphStart === -1 ? 0 : paragraphStart + 2)
  const to = Math.min(end + WINDOW_AFTER, paragraphEnd === -1 ? text.length : paragraphEnd)
  return text.slice(from, to)
}

/** A phone as written, validated; international numbers in E.164. */
export function publicPhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[.\s-]+$/, '')
  const digits = cleaned.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 15 || /^(\d)\1+$/.test(digits)) return null
  // A bare run of digits is an ID or an order number until it is written as a phone.
  if (!cleaned.startsWith('+') && !/\d[\s().-]+\d/.test(cleaned)) return null
  const international = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned
  try {
    if (!international.startsWith('+')) {
      // National format: kept as written, but only if it is a real number
      // somewhere — ten digits at least, which a ZIP+4 never has, and opening
      // with a short area or trunk code, which an ID ("86830610-720") does not.
      if (digits.length < 10) return null
      const firstGroup = cleaned.replace(/^\(/, '').match(/^\d+/)?.[0] ?? ''
      if (firstGroup.length > 5 && /[\s().-]/.test(cleaned)) return null
      const valid = NATIONAL_REGIONS.some((region) => parsePhoneNumberFromString(cleaned, region)?.isValid())
      return valid ? cleaned : null
    }
    const parsed = parsePhoneNumberFromString(international)
    return parsed?.isValid() ? parsed.number : null
  } catch {
    return null
  }
}

/**
 * An email that can be this company's: on its domain when we know it; when we
 * do not, a free-mail address or one whose domain carries a distinctive word
 * of the name. Never an address at somebody else's business.
 */
function emailFits(email: string, words: readonly string[], domain: string | null): boolean {
  if (PLACEHOLDER_LOCAL.test(email.split('@')[0] ?? '')) return false
  // Not normalizeDomain: it refuses free-mail hosts, which are not companies.
  const host = (email.split('@')[1] ?? '').toLowerCase().replace(/^www\./, '')
  if (!host.includes('.')) return false
  if (domain) return host === domain || host.endsWith(`.${domain}`)
  if (FREEMAIL.has(host)) return true
  const label = host.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '')
  return words.some((word) => word.length >= 4 && !GENERIC_WORDS.has(word) && label.includes(word))
}

export type Listing = {
  email: string | null
  phone: string | null
  /** The paragraph also carried the company's domain or city: a second anchor. */
  emailAnchored: boolean
  phoneAnchored: boolean
}

/**
 * PURE. The phone and email this text states for the company, read only from
 * the paragraph around its name. A value is taken only when it is the ONE
 * value of its kind there: two numbers beside a name is a table row, and
 * picking one would be a guess.
 */
export function listingFor(
  text: string,
  company: { name: string | null; domain: string | null; location?: string | null },
  sourceUrl?: string,
): Listing {
  const none: Listing = { email: null, phone: null, emailAnchored: false, phoneAnchored: false }
  const words = distinctiveName(company.name)
  if (!words) return none
  const domain = normalizeDomain(company.domain)
  /*
   * ⚠️ THE HOST'S OWN NUMBER. "WorkOS | Okta" carried Okta's "Questions?
   * Contact us" line beside WorkOS's name (measured 2026-10-29). A window
   * that also names the site it is on is the site talking about itself.
   */
  const brand = (sourceUrl ? hostOf(sourceUrl).split('.').at(-2) : '') ?? ''
  const brandIsOther = brand.length >= 4 && !words.join('').includes(brand)
  const brandPattern = brandIsOther
    ? new RegExp(`(?<![\\p{L}\\p{N}])${brand.replace(/[^a-z0-9]/gi, '')}(?![\\p{L}\\p{N}])`, 'iu')
    : null
  const city = (company.location ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  const anchoredBy = (window: string) => {
    const lower = window.toLowerCase()
    // Whole words: "Reno" is not in "Renovation".
    const cityWord = city.length >= 3
      ? new RegExp(`(?<![\\p{L}\\p{N}])${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u')
      : null
    return Boolean((domain && lower.includes(domain)) || cityWord?.test(lower))
  }
  const phones = new Map<string, boolean>()
  const emails = new Map<string, boolean>()
  for (const { at, end } of nameOccurrences(text, words)) {
    const window = windowAround(text, at, end)
    if (brandPattern?.test(window)) continue
    const anchored = anchoredBy(window)
    for (const raw of window.match(PHONE) ?? []) {
      const phone = publicPhone(raw)
      if (phone) phones.set(phone, (phones.get(phone) ?? false) || anchored)
    }
    // A window that talks about address formats is describing, not stating.
    if (!FORMAT_TALK.test(window)) {
      for (const email of window.match(EMAIL) ?? []) {
        if (!emailFits(email, words, domain)) continue
        const value = email.toLowerCase()
        // An address AT the company's domain is itself the second anchor.
        emails.set(value, (emails.get(value) ?? false) || anchored || Boolean(domain && value.endsWith(`@${domain}`)))
      }
    }
  }
  const only = (values: Map<string, boolean>) =>
    values.size === 1 ? ([...values.entries()][0] as [string, boolean]) : null
  const phone = only(phones)
  const email = only(emails)
  return {
    phone: phone?.[0] ?? null,
    phoneAnchored: phone?.[1] ?? false,
    email: email?.[0] ?? null,
    emailAnchored: email?.[1] ?? false,
  }
}

/* -------------------------------------------------------------------------- *
 * Search and read
 * -------------------------------------------------------------------------- */

export type ExternalContact = {
  email: { value: string; sourceUrl: string; sourceTitle: string; hosts: number } | null
  phone: { value: string; sourceUrl: string; sourceTitle: string; hosts: number } | null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The queries, most specific first. A city narrows a common name to one listing. */
export function externalContactQueries(company: CompanyEntity): string[] {
  const name = (company.name ?? '').replace(/"/g, '').trim()
  const city = (company.location ?? '').split(',')[0]?.replace(/"/g, '').trim() ?? ''
  return [
    `"${name}" ${city} contact phone email`.replace(/\s+/g, ' ').trim(),
    `"${name}" ${city} telephone address`.replace(/\s+/g, ' ').trim(),
  ]
}

type Source = { url: string; title: string; text: string }

/**
 * A result's title and snippet as SEPARATE paragraphs.
 *
 * ⚠️ MEASURED 2026-10-29: "WorkOS | Okta" over a snippet of Okta's own
 * "Questions? Contact us: 1 (800) 425-1267" banner. Joined into one
 * paragraph, the title's name sat beside the host's number. The name and the
 * number must appear together in the text itself.
 */
function snippetText(hit: SearchHit): string {
  return `${hit.title ?? ''}\n\n${hit.snippet ?? ''}`
}

/**
 * PURE. Is this page ABOUT the company, rather than one that mentions it?
 *
 * ⚠️ MEASURED 2026-10-29: a vendor's page comparing itself with WorkOS put the
 * vendor's own switchboard beside the name "WorkOS". A directory's page for a
 * company carries the company's name in its title; the company's own site is
 * on its domain or one that carries its name. Nothing else is a listing.
 */
export function aboutCompany(
  source: { url: string; title: string },
  company: { name: string | null; domain: string | null },
): boolean {
  const words = distinctiveName(company.name)
  if (!words) return false
  const host = hostOf(source.url)
  const domain = normalizeDomain(company.domain)
  if (domain && (host === domain || host.endsWith(`.${domain}`))) return true
  // The company's own host: named for it ("pacificsource.com" for PacificSource Health Plans).
  const label = (host.split('.').at(-2) ?? '').replace(/[^a-z0-9]/g, '')
  const lead = words[0] ?? ''
  if (
    (lead.length >= 5 && !GENERIC_WORDS.has(lead) && label === lead) ||
    label === words.join('') ||
    (words.length >= 2 && label === words.slice(0, 2).join(''))
  ) return true
  // A directory's page leads its title with the company; a comparison does not.
  if (COMPARISON.test(source.title)) return false
  const leading = source.title.split(TITLE_SEPARATOR)[0] ?? ''
  return nameOccurrences(leading, words).length > 0
}

/** Titles of pages that weigh a company against others, rather than list it. */
const COMPARISON = /\b(?:vs\.?|versus|alternatives?|compare[ds]?|comparison|competitors?)\b/i
const TITLE_SEPARATOR = /\s[|·–—-]\s|:\s/

/** The company's own host, as `aboutCompany` recognises it. */
function ownHost(url: string, company: { name: string | null; domain: string | null }): boolean {
  const host = hostOf(url)
  const domain = normalizeDomain(company.domain)
  if (domain && (host === domain || host.endsWith(`.${domain}`))) return true
  return aboutCompany({ url, title: '' }, company)
}

/**
 * Combines what several sources state.
 *
 * ⚠️ ONE THIRD-PARTY PAGE IS NOT ENOUGH ON ITS OWN. Measured 2026-10-29: a
 * vendor's integration page put its own number beside "WorkOS", and a
 * Yellow Pages listing for a different "Ascend" matched by name alone. A value
 * from someone else's site is taken when a SECOND site states it, or when the
 * same paragraph also carries the company's domain or city. The company's own
 * site needs neither.
 */
function choose(sources: readonly Source[], company: CompanyEntity): ExternalContact {
  type Seen = { from: Source[]; trusted: boolean }
  const found = { email: new Map<string, Seen>(), phone: new Map<string, Seen>() }
  const note = (map: Map<string, Seen>, value: string, source: Source, trusted: boolean) => {
    const seen = map.get(value) ?? { from: [], trusted: false }
    map.set(value, { from: [...seen.from, source], trusted: seen.trusted || trusted })
  }
  for (const source of sources) {
    if (!aboutCompany(source, company)) continue
    const listing = listingFor(source.text, company, source.url)
    const own = ownHost(source.url, company)
    if (listing.email) note(found.email, listing.email, source, own || listing.emailAnchored)
    if (listing.phone) note(found.phone, listing.phone, source, own || listing.phoneAnchored)
  }
  const pick = (values: Map<string, Seen>) => {
    const ranked = [...values.entries()]
      .map(([value, seen]) => ({ value, ...seen, hosts: new Set(seen.from.map((source) => hostOf(source.url))).size }))
      .filter((candidate) => candidate.trusted || candidate.hosts >= 2)
      .sort((left, right) => right.hosts - left.hosts)
    // Two different values, neither corroborated more than the other: no answer.
    if (ranked.length > 1 && ranked[0]!.hosts === ranked[1]!.hosts) return null
    const best = ranked[0]
    return best
      ? { value: best.value, sourceUrl: best.from[0]!.url, sourceTitle: best.from[0]!.title, hosts: best.hosts }
      : null
  }
  return { email: pick(found.email), phone: pick(found.phone) }
}

async function fetchListing(url: string, deadlineAt: number): Promise<FetchedPage | null> {
  const startedAt = Date.now()
  try {
    const page = await httpPageFetcher.fetchPage(url, { deadlineAt })
    recordFetch('search-company-contact', 'listing', page, startedAt)
    return isFetchFailure(page) ? null : page
  } catch {
    return null
  }
}

async function searchExternally(
  company: CompanyEntity,
  fields: readonly ResearchField[],
): Promise<ExternalContact | ProviderMiss> {
  const words = distinctiveName(company.name)
  if (!words) return { miss: 'name_ambiguous' }
  const deadlineAt = Date.now() + 13_000
  const wantEmail = fields.includes('company_contact_email')
  const wantPhone = fields.includes('company_contact_phone')
  const complete = (contact: ExternalContact) =>
    (!wantEmail || contact.email) && (!wantPhone || contact.phone)

  const hits = new Map<string, SearchHit>()
  for (const query of externalContactQueries(company)) {
    for (const hit of await serpSearch(query, { limit: 8, deadlineAt, purpose: 'company_contact_offsite' })) {
      if (!hits.has(hit.url) && !isPeopleSearchSource(hit.url)) hits.set(hit.url, hit)
    }
    const fromSnippets = choose(
      [...hits.values()].map((hit) => ({ url: hit.url, title: hit.title ?? '', text: snippetText(hit) })),
      company,
    )
    if (complete(fromSnippets)) return fromSnippets
    if (Date.now() >= deadlineAt) break
  }
  if (hits.size === 0) return { miss: 'search_empty' }

  // Only results that name the company are worth opening.
  const listed = [...hits.values()].filter((hit) =>
    nameOccurrences(`${hit.title ?? ''} ${hit.snippet ?? ''}`, words).length > 0)
  if (listed.length === 0) return { miss: 'company_not_listed' }

  const toOpen = listed.slice(0, EXTERNAL_PAGES_OPENED)
  const pages = Date.now() < deadlineAt
    ? await Promise.all(toOpen.map((hit) =>
        fetchListing(hit.url, deadlineAt)))
    : []
  const sources: Source[] = [
    ...[...hits.values()].map((hit) => ({ url: hit.url, title: hit.title ?? '', text: snippetText(hit) })),
    ...pages.flatMap((page, index) => page === null ? [] : [{
      url: page.url,
      // The search result's title is the page as the engine indexed it.
      title: aboutCompany({ url: page.url, title: page.title ?? '' }, company)
        ? page.title ?? ''
        : toOpen[index]!.title ?? page.title ?? '',
      text: `${page.title ?? ''}\n\n${page.content.slice(0, 200_000)}`,
    }]),
  ]
  const contact = choose(sources, company)
  return contact.email || contact.phone ? contact : { miss: 'listed_no_contact' }
}

/* -------------------------------------------------------------------------- *
 * Evidence
 * -------------------------------------------------------------------------- */

/** Below the company's own site (0.88): a listing is a third party's copy. */
function confidenceFor(hosts: number): number {
  return Math.min(0.8, 0.62 + (hosts - 1) * 0.08)
}

function evidence(output: ExternalContact | ProviderMiss | null, task: ResearchTask): NormalizedEvidence[] {
  if (!output || isProviderMiss(output)) return []
  const retrievedAt = new Date()
  const common = {
    entityType: 'company' as const,
    entityId: task.entity.id,
    sourceProvider: 'search-company-contact',
    sourceConfidence: 'medium' as const,
    retrievedAt: retrievedAt.toISOString(),
  }
  const items: NormalizedEvidence[] = []
  if (output.email && task.fields.includes('company_contact_email')) {
    items.push({
      ...common,
      field: 'company_contact_email',
      confidence: confidenceFor(output.email.hosts),
      value: { email: output.email.value, status: 'publicly_found', sourceTitle: output.email.sourceTitle },
      sourceUrl: output.email.sourceUrl,
      expiresAt: expiresAtFor('company_contact_email', retrievedAt)?.toISOString() ?? null,
    })
  }
  if (output.phone && task.fields.includes('company_contact_phone')) {
    items.push({
      ...common,
      field: 'company_contact_phone',
      confidence: confidenceFor(output.phone.hosts),
      value: { phone: output.phone.value, status: 'publicly_found', sourceTitle: output.phone.sourceTitle },
      sourceUrl: output.phone.sourceUrl,
      expiresAt: expiresAtFor('company_contact_phone', retrievedAt)?.toISOString() ?? null,
    })
  }
  return items
}

export const searchCompanyContactProvider: IntelligenceProvider<ExternalContact | ProviderMiss | null> = {
  name: 'search-company-contact',
  category: 'company_profile',
  canHandle: (task) =>
    task.id.startsWith(TASK_PREFIX) &&
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    hasWebSearch() &&
    task.fields.some((field) => FIELDS.has(field)),
  estimateCost: async () => 0,
  execute: async (task) => searchExternally(task.entity as CompanyEntity, task.fields),
  normalize: evidence,
}
