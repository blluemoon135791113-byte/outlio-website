import 'server-only'

/**
 * Free, official-site company contact discovery.
 *
 * This provider records only literal mailto/text emails and tel/text phone
 * numbers published on the company's own bounded contact-bearing pages. It
 * never turns a generic company inbox into a person's work email.
 */
import { normalizeDomain } from '@/lib/companies/normalize'
import { extractReadable } from '@/lib/hubble/extract/readable'
import { needsBrowser } from '@/lib/hubble/fetch/fetcher'
import { ProviderHttpError, requestTextWithMeta } from '@/lib/intelligence/http'
import { FOLLOW_UP_PAGES, followUpPages, inParallel, siteReadingList } from '@/lib/intelligence/site-pages'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import {
  isProviderMiss,
  type CompanyEntity,
  type IntelligenceProvider,
  type MissReason,
  type NormalizedEvidence,
  type ProviderMiss,
  type ResearchTask,
} from '@/lib/intelligence/types'

const MAX_BYTES = 300_000
const WANTED = new Set(['company_contact_email', 'company_contact_phone'])
const GENERIC_LOCAL_PRIORITY = [
  'sales', 'contact', 'hello', 'info', 'business', 'office', 'support', 'team',
]

export type CompanyContactResult = {
  /** `freemail`: published on the company's own page, on a free-mail domain. */
  email: { value: string; sourceUrl: string; freemail?: boolean } | null
  phone: { value: string; sourceUrl: string } | null
}

/**
 * Consumer mailbox domains a small business publishes as its contact address.
 *
 * ⚠️ ONLY THESE, NEVER ANOTHER COMPANY'S DOMAIN. An off-domain address on a
 * company's site is often its web agency's credit in the footer; a free-mail
 * address is not someone else's business. Measured 2026-10-14: one in five
 * sites with a domain in a real job published only a free-mail address.
 */
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com',
  'gmx.com', 'gmx.de', 'web.de', 'mail.com',
])

function emailRank(email: string): number {
  const local = email.split('@')[0]?.toLowerCase() ?? ''
  const index = GENERIC_LOCAL_PRIORITY.indexOf(local)
  return index === -1 ? GENERIC_LOCAL_PRIORITY.length : index
}

/** Pure, deterministic selection from official-page facts. */
export function selectCompanyContacts(
  domain: string,
  pages: readonly { url: string; emails: string[]; phones: string[] }[],
): CompanyContactResult {
  const host = normalizeDomain(domain)
  if (!host) return { email: null, phone: null }

  const emails = pages.flatMap((page) => page.emails
    .filter((email) => {
      const emailHost = normalizeDomain(email.split('@')[1] ?? '')
      return emailHost === host || Boolean(emailHost?.endsWith(`.${host}`))
    })
    .map((value) => ({ value: value.toLowerCase(), sourceUrl: page.url })))
    .sort((left, right) => emailRank(left.value) - emailRank(right.value))

  const phones = pages.flatMap((page) => page.phones.map((value) => ({ value, sourceUrl: page.url })))

  /*
   * Only when the company's own domain has NO published address: then a
   * free-mail address on the company's own page is its contact address. It is
   * observed and cited (rule 4) — and filed at lower confidence.
   */
  const freemail = emails.length > 0
    ? []
    : pages.flatMap((page) => page.emails
        .filter((email) => FREEMAIL_DOMAINS.has((email.split('@')[1] ?? '').toLowerCase()))
        .map((value) => ({ value: value.toLowerCase(), sourceUrl: page.url, freemail: true as const })))
        .sort((left, right) => emailRank(left.value) - emailRank(right.value))

  return {
    email: emails[0] ?? freemail[0] ?? null,
    phone: phones[0] ?? null,
  }
}

/** What reading one page of the site came to. */
export type PageRead =
  | {
      kind: 'read'
      url: string
      emails: string[]
      phones: string[]
      jsRendered: boolean
      links: { url: string; kind: string }[]
    }
  | { kind: 'refused' }
  | { kind: 'unreachable' }

/** Statuses a site answers with when it is turning automated readers away. */
const REFUSAL_STATUSES = new Set([401, 403, 429, 503])

/**
 * A bot check served with a 200. Recorded as a refusal and left alone: CLAUDE.md
 * rule 1 forbids solving or evading one, and this is how we see how often it
 * costs us.
 */
const BOT_CHECK = /<title>\s*(?:just a moment|attention required|access denied|security check)|cf-chl-|challenge-platform|captcha/i

/**
 * PURE. Why a site gave us nothing, from what each page came to.
 *
 * Ordered by what a person would act on: a page that was read outranks one
 * that refused, because "we read it and there is no contact" is the finding.
 */
export function diagnoseSite(pages: readonly PageRead[]): MissReason {
  const read = pages.filter((page): page is Extract<PageRead, { kind: 'read' }> => page.kind === 'read')
  const withText = read.filter((page) => !page.jsRendered)
  if (withText.some((page) => page.emails.length > 0)) return 'site_off_domain_only'
  if (withText.length > 0) return 'site_no_contact'
  if (read.length > 0) return 'site_js_rendered'
  if (pages.some((page) => page.kind === 'refused')) return 'site_refused'
  return 'site_unreachable'
}

/**
 * The whole site read, both waves, inside the executor's 15s provider budget.
 *
 * ⚠️ MEASURED 2026-10-29: one company took 71s. Each page was retried with
 * backoff after a 429/503, and nothing bounded the total, so the executor
 * killed the task and every page already read was thrown away as a timeout.
 * A site that refused us will refuse again a second later.
 */
const SITE_BUDGET_MS = 13_000

/** Reads one page of the company's site. Never throws. */
async function readPage(requestedUrl: string, deadlineAt: number): Promise<PageRead> {
  try {
    const response = await requestTextWithMeta({
      url: requestedUrl,
      method: 'GET',
      timeoutMs: Math.max(1, Math.min(8_000, deadlineAt - Date.now())),
      deadlineAt,
      maxRetries: 0,
      maxBytes: MAX_BYTES,
      truncateWhenTooLarge: true,
    })
    if (BOT_CHECK.test(response.text.slice(0, 20_000))) return { kind: 'refused' }
    const readable = extractReadable(response.text, response.finalUrl || requestedUrl)
    return {
      kind: 'read',
      url: response.finalUrl || requestedUrl,
      emails: readable.structured.emails,
      phones: readable.structured.phones,
      jsRendered:
        readable.structured.emails.length === 0 &&
        readable.structured.phones.length === 0 &&
        needsBrowser(response.text, readable.text.length),
      links: readable.structured.interestingLinks,
    }
  } catch (error) {
    // A missing /contact page does not make the company or the run fail.
    return error instanceof ProviderHttpError && error.status !== null && REFUSAL_STATUSES.has(error.status)
      ? { kind: 'refused' }
      : { kind: 'unreachable' }
  }
}

/**
 * Reads the homepage, then the pages it links to for contact and about.
 *
 * Two waves, as before: the five fixed pages were read three at a time, which
 * is also two waves. The homepage alone is often enough — a footer carries
 * both the address and the switchboard — and then nothing else is read.
 */
async function fetchContacts(company: CompanyEntity): Promise<CompanyContactResult | ProviderMiss | null> {
  const domain = normalizeDomain(company.domain)
  if (!domain) return null

  const homepageUrl = siteReadingList(domain)[0]
  if (!homepageUrl) return null
  const deadlineAt = Date.now() + SITE_BUDGET_MS
  const homepage = await readPage(homepageUrl, deadlineAt)

  const fromHome = homepage.kind === 'read' ? selectCompanyContacts(domain, [homepage]) : null
  const done = Boolean(fromHome?.phone && fromHome.email && !fromHome.email.freemail)
  const next = done
    ? []
    : followUpPages(domain, homepage.kind === 'read' ? homepage.links : [])
  const rest = Date.now() < deadlineAt
    ? await inParallel(next, FOLLOW_UP_PAGES, (url) => readPage(url, deadlineAt))
    : []

  const read = [homepage, ...rest]
  const pages = read.flatMap((page) => (page.kind === 'read' ? [page] : []))

  const selected = selectCompanyContacts(domain, pages)
  return selected.email || selected.phone ? selected : { miss: diagnoseSite(read) }
}

function companyContactEvidence(
  output: CompanyContactResult | ProviderMiss | null,
  task: ResearchTask,
): NormalizedEvidence[] {
  if (!output || isProviderMiss(output)) return []
  const retrievedAt = new Date()
  const common = {
    entityType: 'company' as const,
    entityId: task.entity.id,
    sourceProvider: 'company-contact',
    sourceConfidence: 'high' as const,
    confidence: 0.88,
    retrievedAt: retrievedAt.toISOString(),
  }
  const evidence: NormalizedEvidence[] = []
  if (output.email && task.fields.includes('company_contact_email')) {
    evidence.push({
      ...common,
      // A free-mail address names no company by itself: the company's page
      // publishing it is the whole link, so it is filed below an on-domain one.
      ...(output.email.freemail ? { sourceConfidence: 'medium' as const, confidence: 0.72 } : {}),
      field: 'company_contact_email',
      value: { email: output.email.value, status: 'publicly_found' },
      sourceUrl: output.email.sourceUrl,
      expiresAt: expiresAtFor('company_contact_email', retrievedAt)?.toISOString() ?? null,
    })
  }
  if (output.phone && task.fields.includes('company_contact_phone')) {
    evidence.push({
      ...common,
      field: 'company_contact_phone',
      value: { phone: output.phone.value, status: 'publicly_found' },
      sourceUrl: output.phone.sourceUrl,
      expiresAt: expiresAtFor('company_contact_phone', retrievedAt)?.toISOString() ?? null,
    })
  }
  return evidence
}

export const companyContactProvider: IntelligenceProvider<CompanyContactResult | ProviderMiss | null> = {
  name: 'company-contact',
  category: 'company_profile',
  canHandle: (task) =>
    task.entity.type === 'company' &&
    Boolean((task.entity as CompanyEntity).domain) &&
    task.fields.some((field) => WANTED.has(field)),
  estimateCost: async () => 0,
  execute: async (task) => fetchContacts(task.entity as CompanyEntity),
  normalize: companyContactEvidence,
}
