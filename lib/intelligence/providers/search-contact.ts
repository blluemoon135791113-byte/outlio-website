import 'server-only'

import { parsePhoneNumberFromString } from 'libphonenumber-js/min'

/**
 * Public contact discovery through Outlio's search engines.
 *
 * One exact person + employer-domain query mirrors the successful manual
 * search workflow. Results are code-extracted from titles/snippets; no social
 * profile is opened, no address is guessed, and every accepted value remains
 * `publicly_found` rather than `verified`.
 */
import { expiresAtFor } from '@/lib/intelligence/ttl'
import { hasWebSearch, serpSearchMany } from '@/lib/search'
import {
  identityAccepted,
  resolveIdentity,
  type IdentityMatch,
  type IdentitySubject,
} from '@/lib/intelligence/identity'
import type { SearchHit } from '@/lib/hubble/providers/types'
import type {
  IntelligenceProvider,
  NormalizedEvidence,
  PersonEntity,
  ResearchTask,
  SourceConfidence,
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

export function extractPublicEmail(
  person: PersonEntity,
  hits: readonly SearchHit[],
): PublicContactFinding {
  const employerDomain = domain(person.companyDomain)
  const candidates: Array<{
    value: string
    hit: SearchHit
    base: ReturnType<typeof provenance>
  }> = []
  for (const hit of hits) {
    const identity = identityOf(person, hit)
    if (!identityAccepted(identity)) continue
    const text = `${hit.title ?? ''} ${hit.snippet ?? ''}`
    for (const email of text.match(EMAIL) ?? []) {
      const emailDomain = domain(email.split('@')[1] ?? '')
      if (!localPartMatchesPerson(email, person)) continue
      // With a known employer domain, a different-domain mailbox is too
      // ambiguous to call a work email. It can remain company-level web data.
      if (employerDomain && emailDomain !== employerDomain && !emailDomain.endsWith(`.${employerDomain}`)) continue
      candidates.push({ value: email.toLowerCase(), hit, base: provenance(person, hit, identity) })
    }
  }
  return corroborated(candidates)
}

export function extractPublicPhone(
  person: PersonEntity,
  hits: readonly SearchHit[],
): PublicContactFinding {
  const candidates: Array<{
    value: string
    hit: SearchHit
    base: ReturnType<typeof provenance>
  }> = []
  for (const hit of hits) {
    const identity = identityOf(person, hit)
    if (!identityAccepted(identity)) continue
    const text = `${hit.title ?? ''} ${hit.snippet ?? ''}`
    const phone = (text.match(PHONE) ?? [])
      .map(normalizedPublicPhone)
      .find((value): value is string => Boolean(value))
    if (phone) candidates.push({ value: phone, hit, base: provenance(person, hit, identity) })
  }
  return corroborated(candidates)
}

export function contactSearchQueries(
  person: PersonEntity,
  kind: 'email' | 'phone',
  max = 4,
): string[] {
  const name = (person.fullName ?? '').replace(/"/g, '').trim()
  const company = (person.companyName ?? '').replace(/"/g, '').trim()
  const employer = domain(person.companyDomain) || company
  const quoted = company ? `"${name}" "${company}"` : `"${name}"`
  const queries = kind === 'email'
    ? [
        `${name} ${employer} email`,
        ...(person.companyDomain ? [`site:${domain(person.companyDomain)} "${name}" email`] : []),
        `${quoted} contact email`,
        `${quoted} filetype:pdf email`,
      ]
    : [
        `${employer} ${name} phone number`,
        `${name} ${employer} phone WhatsApp`,
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
async function publicSearch(
  person: PersonEntity,
  queries: readonly string[],
): Promise<SearchHit[]> {
  const employer = domain(person.companyDomain)
  return serpSearchMany(queries, {
    limit: 8,
    maxQueries: 4,
    stopAfter: 24,
    deadlineAt: Date.now() + 13_000,
    preferDomains: employer ? [employer] : [],
  })
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
  finding: PublicContactFinding,
  task: ResearchTask,
  kind: 'email' | 'phone',
): NormalizedEvidence[] {
  if (!finding) return []
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

const EMAIL_FIELDS = new Set(['work_email', 'email_status'])
const PHONE_FIELDS = new Set(['mobile_phone', 'phone_status'])

export const searchContactEmailProvider: IntelligenceProvider<PublicContactFinding> = {
  name: 'search-contact-email',
  category: 'contact_email',
  canHandle: (task) => canSearch(task, EMAIL_FIELDS),
  estimateCost: async () => 0,
  execute: async (task) => {
    const person = task.entity as PersonEntity
    return extractPublicEmail(person, await publicSearch(person, contactSearchQueries(person, 'email')))
  },
  normalize: (finding, task) => evidence(finding, task, 'email'),
}

export const searchContactPhoneProvider: IntelligenceProvider<PublicContactFinding> = {
  name: 'search-contact-phone',
  category: 'contact_phone',
  canHandle: (task) => canSearch(task, PHONE_FIELDS),
  estimateCost: async () => 0,
  execute: async (task) => {
    const person = task.entity as PersonEntity
    return extractPublicPhone(person, await publicSearch(person, contactSearchQueries(person, 'phone')))
  },
  normalize: (finding, task) => evidence(finding, task, 'phone'),
}
