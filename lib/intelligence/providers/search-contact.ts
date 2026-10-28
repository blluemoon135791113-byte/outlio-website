import 'server-only'

import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

/**
 * Public contact discovery through Outlio's search engines.
 *
 * One exact person + employer-domain query mirrors the successful manual
 * search workflow. Results are code-extracted from titles/snippets first; when
 * those carry nothing, the few results that NAME the person are opened and the
 * same rules run over the page. No social profile is opened, no address is
 * guessed, and every accepted value remains `publicly_found`, not `verified`.
 */
import { expiresAtFor } from '@/lib/intelligence/ttl'
import { hasWebSearch, serpSearch } from '@/lib/search'
import {
  identityAccepted,
  resolveIdentity,
  type IdentityMatch,
  type IdentitySubject,
} from '@/lib/intelligence/identity'
import { httpPageFetcher } from '@/lib/hubble/fetch/fetcher'
import { isFetchFailure, type FetchedPage, type SearchHit } from '@/lib/hubble/providers/types'
import {
  isProviderMiss,
  type IntelligenceProvider,
  type MissReason,
  type NormalizedEvidence,
  type PersonEntity,
  type ProviderMiss,
  type ResearchTask,
  type SourceConfidence,
} from '@/lib/intelligence/types'

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE = /(?<!\d)(?:\+?\d[\d().\t -]{6,}\d)(?!\d)/g
const GENERIC_MAILBOXES = new Set([
  'admin', 'billing', 'careers', 'contact', 'hello', 'info', 'jobs', 'legal',
  'office', 'privacy', 'sales', 'support', 'team',
])

export type PublicContactFinding = {
  value: string
  sourceUrl: string
  sourceTitle: string
  confidence: number
  sourceConfidence: SourceConfidence
  /**
   * How certain we are this is the RIGHT PERSON, as distinct from how good the
   * source is. Recorded on the evidence so a wrong contact can be traced to the
   * decision that accepted it rather than to a guess about it later.
   */
  identityScore: number
  supportingSources: Array<{ url: string; title: string }>
} | null

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function domain(value: string | null): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    ?.split(':')[0] ?? ''
}

function host(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function personTokens(person: PersonEntity): string[] {
  return words(person.fullName ?? '').filter((token) => token.length > 1)
}

/** The lead, in the shape the shared identity resolver expects. */
export function identitySubject(person: PersonEntity): IdentitySubject {
  return {
    fullName: person.fullName,
    companyName: person.companyName,
    companyDomain: person.companyDomain,
    jobTitle: person.jobTitle,
    linkedinUrl: person.linkedinUrl,
    location: person.location,
  }
}

/**
 * Is this result about OUR person?
 *
 * Delegated to `lib/intelligence/identity.ts` rather than decided here. This
 * used to be a private boolean, which meant this provider was the only one in
 * the product that asked the question at all.
 */
function identityOf(person: PersonEntity, hit: SearchHit): IdentityMatch {
  return resolveIdentity(identitySubject(person), {
    text: `${hit.title ?? ''} ${hit.snippet ?? ''}`,
    url: hit.url,
  })
}

function localPartMatchesPerson(email: string, person: PersonEntity): boolean {
  const local = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  if (!local || GENERIC_MAILBOXES.has(local)) return false
  const tokens = personTokens(person)
  if (tokens.length === 0) return false
  const first = tokens[0] ?? ''
  const last = tokens.at(-1) ?? ''
  const candidates = new Set([
    ...tokens,
    `${first}${last}`,
    `${first[0] ?? ''}${last}`,
    `${first}${last[0] ?? ''}`,
  ].filter((candidate) => candidate.length >= 3))
  return [...candidates].some((candidate) => local === candidate || local.startsWith(candidate))
}

function plausiblePhone(value: string): boolean {
  const cleaned = value.trim().replace(/[.\s-]+$/, '')
  const digits = cleaned.replace(/\D/g, '')
  const minimum = cleaned.startsWith('+') ? 8 : 10
  if (digits.length < minimum || digits.length > 15) return false
  if (!cleaned.startsWith('+') && digits.length > 10 && !/[()\s-]/.test(cleaned)) return false
  if (/^(\d)\1+$/.test(digits)) return false
  const groups = cleaned.split(/[\s().-]+/).filter(Boolean)
  return !(groups.length >= 6 && groups.filter((group) => group.length === 1).length / groups.length > 0.6)
}

function normalizedPublicPhone(value: string): string | null {
  const cleaned = value.trim().replace(/[.\s-]+$/, '')
  if (!plausiblePhone(cleaned)) return null

  // International numbers have enough context for authoritative structural
  // validation and one stable E.164 representation. National numbers retain
  // their public formatting because guessing a country would corrupt them.
  const international = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned
  if (international.startsWith('+')) {
    try {
      const parsed = parsePhoneNumberFromString(international)
      return parsed?.isValid() ? parsed.number : null
    } catch {
      return null
    }
  }

  return cleaned
}

function provenance(
  person: PersonEntity,
  hit: SearchHit,
  identity: IdentityMatch,
): Pick<NonNullable<PublicContactFinding>, 'sourceUrl' | 'sourceTitle' | 'confidence' | 'sourceConfidence' | 'identityScore'> {
  const employerDomain = domain(person.companyDomain)
  const resultHost = host(hit.url)
  const official = Boolean(employerDomain && (
    resultHost === employerDomain || resultHost.endsWith(`.${employerDomain}`)
  ))
  return {
    sourceUrl: hit.url,
    sourceTitle: hit.title ?? '',
    /*
     * Source quality, CAPPED BY identity certainty. A perfect address on the
     * company's own site is still only as trustworthy as our belief that the
     * page is about this employee rather than the one with the same name.
     */
    confidence: Math.min(official ? 0.82 : 0.7, identity.score),
    sourceConfidence: official ? 'high' : 'medium',
    identityScore: identity.score,
  }
}

function corroborated<T extends { value: string; hit: SearchHit; base: ReturnType<typeof provenance> }>(
  candidates: readonly T[],
): PublicContactFinding {
  const grouped = new Map<string, T[]>()
  for (const candidate of candidates) {
    const bucket = grouped.get(candidate.value) ?? []
    bucket.push(candidate)
    grouped.set(candidate.value, bucket)
  }

  const ranked = [...grouped.entries()].map(([value, matches]) => {
    const hosts = new Set(matches.map((match) => host(match.hit.url)).filter(Boolean))
    const best = [...matches].sort((left, right) => right.base.confidence - left.base.confidence)[0]!
    return {
      value,
      best,
      confidence: Math.min(0.96, best.base.confidence + Math.min(0.14, (hosts.size - 1) * 0.07)),
      sources: [...new Map(matches.map((match) => [match.hit.url, {
        url: match.hit.url,
        title: match.hit.title ?? '',
      }])).values()],
    }
  }).sort((left, right) => right.confidence - left.confidence)

  const winner = ranked[0]
  if (!winner) return null
  return {
    value: winner.value,
    ...winner.best.base,
    confidence: winner.confidence,
    supportingSources: winner.sources,
  }
}

type Candidate = { value: string; hit: SearchHit; base: ReturnType<typeof provenance> }

/** Emails in `text` that are this person's, at their employer when one is known. */
function personalEmails(person: PersonEntity, text: string): string[] {
  const employerDomain = domain(person.companyDomain)
  return (text.match(EMAIL) ?? []).filter((email) => {
    const emailDomain = domain(email.split('@')[1] ?? '')
    if (!localPartMatchesPerson(email, person)) return false
    // With a known employer domain, a different-domain mailbox is too
    // ambiguous to call a work email. It can remain company-level web data.
    return !employerDomain || emailDomain === employerDomain || emailDomain.endsWith(`.${employerDomain}`)
  })
}

function emailCandidates(person: PersonEntity, hits: readonly SearchHit[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const hit of hits) {
    const identity = identityOf(person, hit)
    if (!identityAccepted(identity)) continue
    for (const email of personalEmails(person, `${hit.title ?? ''} ${hit.snippet ?? ''}`)) {
      candidates.push({ value: email.toLowerCase(), hit, base: provenance(person, hit, identity) })
    }
  }
  return candidates
}

function phoneCandidates(person: PersonEntity, hits: readonly SearchHit[]): Candidate[] {
  const candidates: Candidate[] = []
  for (const hit of hits) {
    const identity = identityOf(person, hit)
    if (!identityAccepted(identity)) continue
    const text = `${hit.title ?? ''} ${hit.snippet ?? ''}`
    const phone = (text.match(PHONE) ?? [])
      .map(normalizedPublicPhone)
      .find((value): value is string => Boolean(value))
    if (phone) candidates.push({ value: phone, hit, base: provenance(person, hit, identity) })
  }
  return candidates
}

export function extractPublicEmail(
  person: PersonEntity,
  hits: readonly SearchHit[],
): PublicContactFinding {
  return corroborated(emailCandidates(person, hits))
}

export function extractPublicPhone(
  person: PersonEntity,
  hits: readonly SearchHit[],
): PublicContactFinding {
  return corroborated(phoneCandidates(person, hits))
}

/* -------------------------------------------------------------------------- *
 * Opening the results that name the person
 * -------------------------------------------------------------------------- */

/** Results opened per person, per contact type, once snippets carry nothing. */
export const PAGES_OPENED_PER_CONTACT = 2

/** How far around the person's name a phone may sit and still be theirs. */
const PHONE_WINDOW_BEFORE = 60
const PHONE_WINDOW_AFTER = 120

/**
 * Where the person's full name appears as a whole name — never inside a
 * longer one ("Ann Lee" is not in "Joann Lee").
 */
function nameOccurrences(text: string, fullName: string): number[] {
  const name = fullName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  if (!name) return []
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'giu')
  return [...text.matchAll(pattern)].map((match) => match.index ?? 0).slice(0, 20)
}

/** A partly hidden value, as contact-data directories show them publicly. */
const MASKED_EMAIL = /[a-z0-9._-]*\*{2,}[a-z0-9._*-]*@[a-z0-9.-]+\.[a-z]{2,}/i
const MASKED_PHONE = /\d[\d\s().-]{1,}\*{3,}|\*{3,}[\d\s().-]*\d{2,}/

/**
 * PURE. Emails on an opened page that are this person's.
 *
 * `identity` is the search result's when that alone identified the person,
 * or the PAGE's when the result only named them (see `pageIdentity`). Either
 * way the address must still match the person's name and employer, exactly as
 * in a snippet.
 */
export function pageEmailCandidates(
  person: PersonEntity,
  page: Pick<FetchedPage, 'url' | 'title' | 'content'> & { emails: readonly string[] },
  hit: SearchHit,
  identity: IdentityMatch = identityOf(person, hit),
): Candidate[] {
  if (!identityAccepted(identity)) return []
  const found = new Set([
    ...personalEmails(person, page.emails.join(' ')),
    ...personalEmails(person, page.content),
  ].map((email) => email.toLowerCase()))
  const pageHit: SearchHit = { url: page.url, title: page.title ?? hit.title, snippet: null, publishedDate: null }
  return [...found].map((value) => ({ value, hit: pageHit, base: provenance(person, pageHit, identity) }))
}

/**
 * PURE. A phone on an opened page is the person's only when it sits right by
 * their full name.
 *
 * ⚠️ NEVER "ANY PHONE ON A PAGE THAT NAMES THEM". A team page names everyone
 * and lists the switchboard once; filed against each person, that number is a
 * wrong mobile for all of them — worse than none (identity.ts).
 */
export function pagePhoneCandidates(
  person: PersonEntity,
  page: Pick<FetchedPage, 'url' | 'title' | 'content'>,
  hit: SearchHit,
  identity: IdentityMatch = identityOf(person, hit),
): Candidate[] {
  if (!identityAccepted(identity)) return []
  const name = (person.fullName ?? '').trim()
  if (!name) return []
  const text = page.content
  const pageHit: SearchHit = { url: page.url, title: page.title ?? hit.title, snippet: null, publishedDate: null }
  const values = new Set<string>()
  for (const at of nameOccurrences(text, name)) {
    /*
     * The window stops at a line break either side: on a team page the next
     * line is the next person, and their number is not this person's.
     */
    const end = at + name.length
    const lineStart = text.lastIndexOf('\n', at)
    const lineEnd = text.indexOf('\n', end)
    const from = Math.max(at - PHONE_WINDOW_BEFORE, lineStart + 1)
    const to = Math.min(end + PHONE_WINDOW_AFTER, lineEnd === -1 ? text.length : lineEnd)
    for (const raw of text.slice(from, to).match(PHONE) ?? []) {
      const phone = normalizedPublicPhone(raw)
      if (phone) values.add(phone)
    }
  }
  // Two different numbers beside one name is a table, not a contact.
  if (values.size !== 1) return []
  return [...values].map((value) => ({ value, hit: pageHit, base: provenance(person, pageHit, identity) }))
}

/** How much text either side of the person's name the identity check reads. */
const PAGE_IDENTITY_WINDOW = 500

/**
 * PURE. Identity judged on the opened page itself.
 *
 * For a result whose snippet NAMED the person but was cut off before their
 * employer (measured 2026-10-29: 3 of the 6 named results for a 25-lead job).
 * The same resolver, the same threshold — a name alone still never matches.
 *
 * ⚠️ ONLY THE TEXT AROUND EACH MENTION OF THE NAME. A members page names
 * hundreds of people; judged whole, "Jamie Rivera" in row 3 and "Fabricated
 * Labs" in row 200 would read as one identified person.
 */
export function pageIdentity(
  person: PersonEntity,
  page: Pick<FetchedPage, 'url' | 'title' | 'content'>,
): IdentityMatch {
  const subject = identitySubject(person)
  const around = nameOccurrences(page.content, person.fullName ?? '').map((at) =>
    resolveIdentity(subject, {
      text: page.content.slice(Math.max(0, at - PAGE_IDENTITY_WINDOW), at + PAGE_IDENTITY_WINDOW),
      url: page.url,
    }))
  const titled = resolveIdentity(subject, { text: page.title ?? '', url: page.url })
  return [titled, ...around].sort((left, right) => right.score - left.score)[0]!
}

/**
 * Pages opened in the last few minutes, shared by a person's email and phone
 * tasks — they search different phrasings but often open the same result.
 */
const OPENED = new Map<string, { at: number; page: Promise<FetchedPage | null> }>()
const OPENED_TTL_MS = 10 * 60_000
const OPENED_MAX = 500
const OPENED_CONTENT_CHARS = 200_000

function openPage(url: string, deadlineAt: number): Promise<FetchedPage | null> {
  const now = Date.now()
  const cached = OPENED.get(url)
  if (cached && now - cached.at < OPENED_TTL_MS) return cached.page
  if (OPENED.size >= OPENED_MAX) OPENED.delete(OPENED.keys().next().value as string)
  const page = httpPageFetcher
    .fetchPage(url, { deadlineAt })
    // Kept bounded: up to 500 cached pages must not each hold megabytes.
    .then((result): FetchedPage | null => (isFetchFailure(result) ? null : {
      ...result,
      content: result.content.slice(0, OPENED_CONTENT_CHARS),
      structured: { emails: pageEmails(result) },
    }))
    .catch(() => null)
  OPENED.set(url, { at: now, page })
  return page
}

/** Test seam: the cache is process-lifetime state. */
export function resetOpenedPages(): void {
  OPENED.clear()
}

export function contactSearchQueries(
  person: PersonEntity,
  kind: 'email' | 'phone',
  max = 4,
): string[] {
  const name = (person.fullName ?? '').replace(/"/g, '').trim()
  const company = (person.companyName ?? '').replace(/"/g, '').trim()
  const employer = domain(person.companyDomain) || company
  const namedEmployer = company || employer
  const quoted = company ? `"${name}" "${company}"` : `"${name}"`
  const queries = kind === 'email'
    ? [
        `${name} ${namedEmployer} email`,
        ...(employer && employer !== namedEmployer ? [`${name} ${employer} email`] : []),
        ...(person.companyDomain ? [`site:${domain(person.companyDomain)} "${name}" email`] : []),
        `${quoted} contact email`,
        `${quoted} filetype:pdf email`,
      ]
    : [
        `${namedEmployer} ${name} phone number`,
        ...(employer && employer !== namedEmployer ? [`${employer} ${name} phone number`] : []),
        `${name} ${namedEmployer} phone WhatsApp`,
        ...(person.companyDomain ? [`site:${domain(person.companyDomain)} "${name}" phone`] : []),
        `${quoted} contact phone`,
      ]
  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()))].slice(0, max)
}

export function contactSearchQuery(person: PersonEntity, kind: 'email' | 'phone'): string {
  return contactSearchQueries(person, kind, 1)[0] ?? ''
}

export function hasPublicContactSearch(): boolean {
  return hasWebSearch()
}

/**
 * Runs the phrasings through the shared SERP service.
 *
 * This used to be a hand-rolled MCP-then-Google fallback loop living inside
 * this one provider — its own ordering, its own deduplication, and no cache.
 * Contact discovery is the heaviest search consumer in the product (four
 * phrasings per person), so it was also the fastest way to burn a 100-query
 * day. It now shares the cache, the budget and the waterfall with everything
 * else, and ranks the employer's own domain first because a contact stated on
 * the company's site outranks the same string in a directory.
 */
type ContactKind = 'email' | 'phone'

/**
 * Runs the phrasings through the shared SERP service, then opens the results
 * that name the person when their snippets carried nothing.
 */
async function publicSearch(
  person: PersonEntity,
  queries: readonly string[],
  kind: ContactKind,
): Promise<NonNullable<PublicContactFinding> | ProviderMiss> {
  const employer = domain(person.companyDomain)
  const collected = new Map<string, SearchHit>()
  const deadlineAt = Date.now() + 13_000
  const fromSnippets = kind === 'email' ? emailCandidates : phoneCandidates

  /*
   * Search one phrasing at a time and stop as soon as a supported contact is
   * found. Bulk contact runs used to execute four searches for every lead
   * before attempting extraction, even when result one already contained the
   * phone. This both delayed the answer and multiplied load on the free search
   * service. The accumulated hits still allow corroboration within and across
   * result sets.
   */
  for (const query of queries.slice(0, 4)) {
    const hits = await serpSearch(query, {
      limit: 8,
      deadlineAt,
      preferDomains: employer ? [employer] : [],
    })
    for (const hit of hits) if (!collected.has(hit.url)) collected.set(hit.url, hit)

    const finding = corroborated(fromSnippets(person, [...collected.values()]))
    if (finding) return finding
    if (Date.now() >= deadlineAt) break
  }

  /*
   * ⚠️ A SNIPPET IS ~160 CHARACTERS OF A PAGE. A staff page, a conference
   * speaker list or a forum signature can carry the address the snippet cut
   * off. Only results that already NAME the person are opened — a page that
   * does not is a page about somebody else — and only a few: this is reading
   * a handful of cited pages, not crawling.
   */
  const hits = [...collected.values()]
  if (hits.length === 0) return { miss: 'search_empty' }
  const judged = hits.map((hit) => ({ hit, identity: identityOf(person, hit) }))
  const accepted = judged.filter(({ identity }) => identityAccepted(identity))
  // Named but not yet identified: the page may supply what the snippet cut off.
  const namedOnly = judged.filter(({ identity }) =>
    !identityAccepted(identity) && identity.signals.includes('name_exact'))
  if (accepted.length === 0 && namedOnly.length === 0) return { miss: 'not_named' }

  const maskedPattern = kind === 'email' ? MASKED_EMAIL : MASKED_PHONE
  let masked = accepted.some(({ hit }) => maskedPattern.test(`${hit.title ?? ''} ${hit.snippet ?? ''}`))

  const toOpen = [...accepted, ...namedOnly].slice(0, PAGES_OPENED_PER_CONTACT)
  const pages = Date.now() < deadlineAt
    ? await Promise.all(toOpen.map(({ hit }) => openPage(hit.url, deadlineAt)))
    : []
  const candidates: Candidate[] = []
  let identified = accepted.length > 0
  pages.forEach((page, index) => {
    if (!page) return
    const { hit, identity: fromResult } = toOpen[index]!
    const identity = identityAccepted(fromResult) ? fromResult : pageIdentity(person, page)
    if (!identityAccepted(identity)) return
    identified = true
    masked ||= maskedPattern.test(page.content)
    candidates.push(...(kind === 'email'
      ? pageEmailCandidates(person, { ...page, emails: pageEmails(page) }, hit, identity)
      : pagePhoneCandidates(person, page, hit, identity)))
  })
  if (!identified) return { miss: 'not_named' }

  const finding = corroborated(candidates)
  if (finding) return finding
  const reason: MissReason = masked ? 'masked_only' : 'named_no_contact'
  return { miss: reason }
}

/** The emails `extractReadable` pulled from the page's links and markup. */
function pageEmails(page: FetchedPage): string[] {
  const emails = (page.structured as { emails?: unknown }).emails
  return Array.isArray(emails) ? emails.filter((value): value is string => typeof value === 'string') : []
}

function canSearch(task: ResearchTask, fields: ReadonlySet<string>): boolean {
  if (task.entity.type !== 'person' || !hasPublicContactSearch()) return false
  const person = task.entity as PersonEntity
  return Boolean(
    person.fullName &&
    (person.companyDomain || person.companyName) &&
    task.fields.some((field) => fields.has(field)),
  )
}

function evidence(
  finding: PublicContactFinding | ProviderMiss,
  task: ResearchTask,
  kind: ContactKind,
): NormalizedEvidence[] {
  if (!finding || isProviderMiss(finding)) return []
  const retrievedAt = new Date()
  const valueField = kind === 'email' ? 'work_email' : 'mobile_phone'
  const statusField = kind === 'email' ? 'email_status' : 'phone_status'
  const valueKey = kind === 'email' ? 'email' : 'phone'
  const base = {
    entityType: 'person' as const,
    entityId: task.entity.id,
    sourceProvider: kind === 'email' ? 'search-contact-email' : 'search-contact-phone',
    sourceUrl: finding.sourceUrl,
    sourceConfidence: finding.sourceConfidence,
    confidence: finding.confidence,
    retrievedAt: retrievedAt.toISOString(),
  }
  return [
    {
      ...base,
      field: valueField,
      value: {
        [valueKey]: finding.value,
        sourceTitle: finding.sourceTitle,
        identityConfidence: finding.identityScore,
        supportingSources: finding.supportingSources,
      },
      expiresAt: expiresAtFor(valueField, retrievedAt)?.toISOString() ?? null,
    },
    {
      ...base,
      field: statusField,
      value: { status: 'publicly_found', sourceTitle: finding.sourceTitle },
      expiresAt: expiresAtFor(statusField, retrievedAt)?.toISOString() ?? null,
    },
  ]
}

/**
 * Phrasings searched per person, per contact type.
 *
 * ⚠️ WAS FOUR, AND THAT WAS THE QUEUE (2026-10-14). On a real 25-lead job, 18
 * of the 25 people were never named in ANY search result: no phrasing finds a
 * person the public web does not mention. Four phrasings for email plus four
 * for phone made up to eight searches per lead, which is what backed up the
 * pacing queue and starved the domain searches that DO find things. The first
 * phrasing (name + employer + "email"/"phone number") stays.
 */
export const PHRASINGS_PER_CONTACT = 1

const EMAIL_FIELDS = new Set(['work_email', 'email_status'])
const PHONE_FIELDS = new Set(['mobile_phone', 'phone_status'])

export const searchContactEmailProvider: IntelligenceProvider<PublicContactFinding | ProviderMiss> = {
  name: 'search-contact-email',
  category: 'contact_email',
  canHandle: (task) => canSearch(task, EMAIL_FIELDS),
  estimateCost: async () => 0,
  execute: async (task) => {
    const person = task.entity as PersonEntity
    return publicSearch(person, contactSearchQueries(person, 'email', PHRASINGS_PER_CONTACT), 'email')
  },
  normalize: (finding, task) => evidence(finding, task, 'email'),
}

export const searchContactPhoneProvider: IntelligenceProvider<PublicContactFinding | ProviderMiss> = {
  name: 'search-contact-phone',
  category: 'contact_phone',
  canHandle: (task) => canSearch(task, PHONE_FIELDS),
  estimateCost: async () => 0,
  execute: async (task) => {
    const person = task.entity as PersonEntity
    return publicSearch(person, contactSearchQueries(person, 'phone', PHRASINGS_PER_CONTACT), 'phone')
  },
  normalize: (finding, task) => evidence(finding, task, 'phone'),
}
