import 'server-only'

/**
 * Social Scout — discovers the social accounts a company links to, then reads
 * what those public profiles publish about themselves.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 *  THE CHAIN THAT MAKES THIS HONEST:
 *
 *    company website → social links (the company's OWN claim about itself)
 *                    → public profile pages → bio emails + handle inventory
 *
 *  ⚠️ LINKEDIN IS DISCOVERED, NEVER VISITED. A linkedin.com URL found on the
 *  company's site is stored as evidence — it is the company stating its own
 *  address — but NO request is ever made to linkedin.com (rules 1–2).
 *
 *  ⚠️ NO EVASION MACHINERY. No proxy rotation, no user-agent disguise, no
 *  retry storms against a 429. Outlio identifies itself, paces itself, and a
 *  platform that refuses the request is recorded as unavailable — a polite
 *  client accepts a no.
 *
 *  EMAILS follow the same gates as Scout proper: an address published in a
  *  public bio the company controls is a stated fact. Nothing unverifiable is
 *  ever stored.
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { normalizeDomain } from '@/lib/companies/normalize'
import { requestTextWithMeta, setHostPacing } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import {
  extractEmails,
  isHarvestableEmail,
  isPersonMailbox,
} from '@/lib/intelligence/providers/scout'
import { candidateHosts, servedDirectly, verifyPageMentionsCompany } from '@/lib/intelligence/providers/domain-probe'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  PersonEntity,
  ResearchTask,
} from '@/lib/intelligence/types'

const PROFILE_TIMEOUT_MS = 8_000
const PROFILE_MAX_BYTES = 200_000
/** Bounded curiosity: at most four profiles per company per pass. */
const MAX_PROFILES = 4

// Every host we touch gets paced, however small the request.
setHostPacing('instagram.com', 400)
setHostPacing('tiktok.com', 400)
setHostPacing('youtube.com', 400)
setHostPacing('twitch.tv', 400)
setHostPacing('pinterest.com', 400)
setHostPacing('linktr.ee', 400)

// ---------------------------------------------------------------------------
// Discovery — the social links a company publishes about itself
// ---------------------------------------------------------------------------

export const SCOUTED_PLATFORMS = [
  'x',
  'twitter',
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'twitch',
  'pinterest',
  'github',
  'linkedin',
] as const

export type SocialLinks = Partial<Record<(typeof SCOUTED_PLATFORMS)[number], string>>

const PLATFORM_MATCHERS: ReadonlyArray<{ platform: (typeof SCOUTED_PLATFORMS)[number]; pattern: RegExp }> = [
  { platform: 'x', pattern: /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?!share|intent|home)[A-Za-z0-9_]{1,15}/i },
  { platform: 'instagram', pattern: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore)[A-Za-z0-9_.]{1,30}/i },
  { platform: 'tiktok', pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]{1,24}/i },
  { platform: 'youtube', pattern: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|user\/|@)[@A-Za-z0-9._-]+/i },
  { platform: 'facebook', pattern: /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|plugins|tr\b)[A-Za-z0-9_.]{2,50}/i },
  { platform: 'twitch', pattern: /https?:\/\/(?:www\.)?twitch\.tv\/[A-Za-z0-9_]{2,25}/i },
  { platform: 'pinterest', pattern: /https?:\/\/(?:[a-z]{2}\.)?pinterest\.(?:com|[a-z.]+)\/(?!pin\/)[A-Za-z0-9_.]{2,50}/i },
  { platform: 'github', pattern: /https?:\/\/(?:www\.)?github\.com\/(?!features|topics|about)[A-Za-z0-9-]{1,39}/i },
  // LinkedIn: recorded as the company's stated address, never fetched.
  { platform: 'linkedin', pattern: /https?:\/\/(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/(?:company|in|sales\/company)\/[A-Za-z0-9_%.-]+/i },
]

const BIO_LINK_HOSTS = ['linktr.ee', 'stan.store', 'beacons.ai', 'bio.link']

/** PURE. First match per platform wins; later duplicates are ignored. */
export function extractSocialLinks(html: string | null): SocialLinks {
  if (!html) return {}

  const links: SocialLinks = {}
  for (const { platform, pattern } of PLATFORM_MATCHERS) {
    const match = pattern.exec(html)
    if (match) links[platform] = match[0].replace(/[)"'.]+$/, '')
  }
  return links
}

/** PURE. Bio-link pages (Linktree etc.) found in page text. */
export function extractBioLinks(html: string | null): string[] {
  if (!html) return []
  const found = new Set<string>()
  for (const host of BIO_LINK_HOSTS) {
    const matches =
      html.match(new RegExp(`(?:https?://)?[a-zA-Z0-9.-]*${host.replace(/\./g, '\\.')}/[A-Za-z0-9_.-]+`, 'gi')) ?? []
    for (const match of matches.slice(0, 2)) {
      const cleaned = match.replace(/[)"'.]+$/, '')
      found.add(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`)
    }
  }
  return [...found]
}

// ---------------------------------------------------------------------------
// Enrichment — what a discovered public profile states about itself
// ---------------------------------------------------------------------------

export type ProfileSignals = {
  /** Addresses published in the profile's own bio/meta content. */
  emails: string[]
}

/**
 * Reads a fetched profile page loosely: og:description / title / visible text
 * all travel through the same email extractor. Deliberately tolerant of every
 * platform's markup churn — the expensive part is discovery, not this read.
 */
export function parseProfileSignals(html: string | null): ProfileSignals {
  if (!html) return { emails: [] }

  const metaDescriptions = [
    ...html.matchAll(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/gi),
    ...html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/gi),
  ].map((match) => match[1] ?? '')

  return { emails: extractEmails([...metaDescriptions, html].join('\n')) }
}

/** Which fetched URLs must never be requested, whatever they claim to be. */
export function isFetchableProfileUrl(url: string): boolean {
  return !/linkedin\.com/i.test(url)
}

/**
 * A COMPANY LinkedIn page, not an employee's.
 *
 * ⚠️ A site can feature its people — a founder's `/in/` profile on a team page
 * is a PERSON, and filing one as the company's page is a wrong answer that
 * looks right. Only `/company/` (or its Sales Nav form) qualifies.
 */
export function isCompanyLinkedInUrl(url: string): boolean {
  return /linkedin\.com\/(?:company|sales\/company)\//i.test(url)
}

async function fetchProfile(url: string): Promise<string | null> {
  try {
    const { text } = await requestTextWithMeta({
      url,
      method: 'GET',
      timeoutMs: PROFILE_TIMEOUT_MS,
      maxBytes: PROFILE_MAX_BYTES,
      truncateWhenTooLarge: true,
    })
    return text
  } catch {
    // Rate-limited, geo-blocked, logged-out wall — all facts about the
    // platform's mood, none about the lead. Recorded as absent.
    return null
  }
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export type SocialScoutOutput = {
  /** Published email found on any owned web presence. */
  publishedEmail: string | null
  /** Where it came from, for provenance. */
  publishedFrom: string | null
  /** Handle inventory across scouted platforms. */
  socials: Record<string, string>
}

export async function executeSocialScout(
  person: PersonEntity,
  options: {
    fetched?: (url: string) => Promise<string | null>
  } = {},
): Promise<SocialScoutOutput | null> {
  const domain = normalizeDomain(person.companyDomain)
  if (!domain) return null

  const fetched = options.fetched ?? fetchProfile

  // ---- discover from the company's own pages -----------------------------
  const socials: Record<string, string> = {}
  const candidateEmails = new Map<string, string>() // email → source url

  const basePaths = ['', '/contact', '/contact-us', '/about', '/about-us']
  for (const path of basePaths) {
    const url = `https://${domain}${path}/`
    const html = await fetched(url)
    if (!html) continue

    Object.assign(socials, extractSocialLinks(html))

    // Emails stated on the company's own site remain the strongest source.
    for (const email of extractEmails(html)) {
      if (!candidateEmails.has(email)) candidateEmails.set(email, url)
    }
  }

  // ---- enrich discovered profiles (bounded, never LinkedIn) --------------
  const profileUrls = Object.entries(socials)
    .filter(([platform]) => platform !== 'linkedin')
    .map(([, url]) => url)
    .filter(isFetchableProfileUrl)
    .slice(0, MAX_PROFILES)

  // Bio-link pages (Linktree etc.) are directories of MORE socials — read
  // them first-class before the profile fetches.
  const bioLinks = Object.values(socials).filter((url) =>
    BIO_LINK_HOSTS.some((host) => url.includes(host)),
  )
  for (const bioUrl of bioLinks.slice(0, 2)) {
    const html = await fetched(bioUrl)
    if (!html) continue

    // Every social the tree lists joins the inventory.
    Object.assign(socials, extractSocialLinks(html))

    for (const email of parseProfileSignals(html).emails) {
      if (!candidateEmails.has(email)) candidateEmails.set(email, bioUrl)
    }
  }

  for (const url of profileUrls) {
    const html = await fetched(url)
    if (!html) continue
    for (const email of parseProfileSignals(html).emails) {
      if (!candidateEmails.has(email)) candidateEmails.set(email, url)
    }
  }

  // A profile can publish a sales inbox, an agency address, or another team
  // member's email. Only a mailbox matching this person's name may become a
  // person fact; all other addresses remain page/company evidence.
  const allPublished = [...candidateEmails.keys()]
  const registrable = domain.replace(/^www\./, '')
  const publishedEmail =
    allPublished.find(
      (email) =>
        (email.endsWith(`@${registrable}`) || email.endsWith(`.${registrable}`)) &&
        isPersonMailbox(email, person.fullName),
    ) ??
    allPublished.find(
      (email) => isHarvestableEmail(email) && isPersonMailbox(email, person.fullName),
    ) ??
    null

  if (!publishedEmail && Object.keys(socials).length === 0) return null

  return {
    publishedEmail,
    publishedFrom: publishedEmail ? candidateEmails.get(publishedEmail) ?? null : null,
    socials,
  }
}

export function socialScoutEvidence(
  output: SocialScoutOutput | null,
  person: PersonEntity,
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  if (!output) return []

  const evidence: NormalizedEvidence[] = []
  const retrievedAtIso = retrievedAt.toISOString()

  if (output.publishedEmail) {
    evidence.push({
      field: 'work_email',
      entityType: 'person',
      entityId: person.id,
      value: { email: output.publishedEmail },
      sourceProvider: 'social-scout',
      sourceUrl: output.publishedFrom,
      sourceConfidence: 'high',
      confidence: 0.8,
      retrievedAt: retrievedAtIso,
      expiresAt: expiresAtFor('work_email', retrievedAt)?.toISOString() ?? null,
    })
    evidence.push({
      field: 'email_status',
      entityType: 'person',
      entityId: person.id,
      value: { status: 'publicly_found', verificationMethod: 'public_bio_or_website' },
      sourceProvider: 'social-scout',
      sourceUrl: output.publishedFrom,
      sourceConfidence: 'high',
      confidence: 0.8,
      retrievedAt: retrievedAtIso,
      expiresAt: expiresAtFor('email_status', retrievedAt)?.toISOString() ?? null,
    })
  }

  const companySocials: Record<string, string> = {}
  for (const [platform, url] of Object.entries(output.socials)) {
    // An employee's /in/ profile found on the company site is not the
    // company's page; it must not enter the company's social inventory.
    if (platform === 'linkedin' && !isCompanyLinkedInUrl(url)) continue
    companySocials[platform] = url
  }

  if (Object.keys(companySocials).length > 0) {
    // Filed against the COMPANY — the accounts belong to the business, so the
    // next query about it starts from this inventory instead of rediscovering.
    evidence.push({
      field: 'social_profiles',
      entityType: 'company',
      entityId: person.companyId ?? person.id,
      value: companySocials,
      sourceProvider: 'social-scout',
      sourceUrl: person.companyDomain ? `https://${normalizeDomain(person.companyDomain) ?? ''}/` : null,
      sourceConfidence: 'high',
      confidence: 0.85,
      retrievedAt: retrievedAtIso,
      expiresAt: expiresAtFor('social_profiles', retrievedAt)?.toISOString() ?? null,
    })
  }

  return evidence
}

const SOCIAL_SCOUT_FIELDS: ReadonlySet<string> = new Set(['work_email', 'email_status'])

export const socialScoutProvider: IntelligenceProvider<SocialScoutOutput | null> = {
  name: 'social-scout',
  category: 'contact_email',

  canHandle: (task: ResearchTask) => {
    if (task.entity.type !== 'person') return false
    const person = task.entity as PersonEntity
    return (
      Boolean(person.companyDomain) &&
      task.fields.some((field) => SOCIAL_SCOUT_FIELDS.has(field))
    )
  },

  estimateCost: async () => 0,

  execute: async (task) =>
    executeSocialScout(task.entity as PersonEntity),

  normalize: (output, task) =>
    socialScoutEvidence(output, task.entity as PersonEntity),
}


// ---------------------------------------------------------------------------
// Company-scoped discovery — the same chain, keyed on the company itself
// ---------------------------------------------------------------------------

export type CompanyScoutOutput = {
  domain: string | null
  socials: Record<string, string>
}

/**
 * Resolves the company's website (probing the name when no domain is known,
 * with the same content-verification and ambiguity-refusal rules as
 * `domain-probe`), then inventories the social accounts it publishes.
 *
 * Self-sufficient ON PURPOSE: a company task carrying `social_profiles` and
 * `company_linkedin` batches with `company_domain` in the company phase, but
 * the entity's domain field cannot see a sibling provider's mid-task
 * discovery — so this provider finds the domain itself when it must.
 */
export async function executeCompanyScout(
  company: CompanyEntity,
  options: {
    fetched?: (url: string) => Promise<string | null>
  } = {},
): Promise<CompanyScoutOutput | null> {
  const fetched = options.fetched ?? fetchProfile

  let domain = normalizeDomain(company.domain)

  if (!domain && company.name) {
    for (const host of candidateHosts(company.name)) {
      let text: string | null = null
      let finalUrl: string | null = null
      try {
        const response = await requestTextWithMeta({
          url: `https://${host}/`,
          method: 'GET',
          timeoutMs: PROFILE_TIMEOUT_MS,
          maxBytes: PROFILE_MAX_BYTES,
          truncateWhenTooLarge: true,
        })
        text = response.text
        finalUrl = response.finalUrl
      } catch {
        continue
      }
      if (!servedDirectly(host, finalUrl)) continue
      if (!verifyPageMentionsCompany(company.name, text)) continue
      domain = normalizeDomain(host)
      break
    }
  }

  if (!domain) return null

  const socials: Record<string, string> = {}
  for (const path of ['', '/contact', '/contact-us', '/about', '/about-us']) {
    const html = await fetched(`https://${domain}${path}/`)
    if (!html) continue
    Object.assign(socials, extractSocialLinks(html))
  }

  if (Object.keys(socials).length === 0) return null
  return { domain, socials }
}

export function companyScoutEvidence(
  output: CompanyScoutOutput | null,
  company: CompanyEntity,
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  if (!output) return []

  const retrievedAtIso = retrievedAt.toISOString()
  const sourceUrl = output.domain ? `https://${output.domain}/` : null
  const evidence: NormalizedEvidence[] = []

  const push = (field: 'social_profiles' | 'company_linkedin', value: Record<string, unknown>) => {
    evidence.push({
      field,
      entityType: 'company',
      entityId: company.id,
      value,
      sourceProvider: 'social-scout-company',
      sourceUrl,
      sourceConfidence: 'high',
      confidence: 0.85,
      retrievedAt: retrievedAtIso,
      expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
    })
  }

  // LinkedIn first-class: the company stating its own public page address.
  // Recorded, never fetched. An employee's /in/ profile is not the company.
  const companyLinkedIn = output.socials.linkedin
  if (companyLinkedIn && isCompanyLinkedInUrl(companyLinkedIn)) {
    push('company_linkedin', { value: companyLinkedIn })
  }

  const { linkedin: _linkedin, ...rest } = output.socials
  if (Object.keys(rest).length > 0) {
    push('social_profiles', rest)
  }

  return evidence
}

const COMPANY_SCOUT_FIELDS: ReadonlySet<string> = new Set(['social_profiles', 'company_linkedin'])

export const companyScoutProvider: IntelligenceProvider<CompanyScoutOutput | null> = {
  name: 'social-scout-company',
  category: 'company_profile',

  canHandle: (task: ResearchTask) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).name) &&
    task.fields.some((field) => COMPANY_SCOUT_FIELDS.has(field)),

  estimateCost: async () => 0,

  execute: async (task) => executeCompanyScout(task.entity as CompanyEntity),

  normalize: (output, task) => companyScoutEvidence(output, task.entity as CompanyEntity),
}
