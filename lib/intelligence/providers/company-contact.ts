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
import { requestTextWithMeta } from '@/lib/intelligence/http'
import { inParallel, siteReadingList } from '@/lib/intelligence/site-pages'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
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

/** Reads the company's own contact-bearing pages, three at a time. */
async function fetchContacts(company: CompanyEntity): Promise<CompanyContactResult | null> {
  const domain = normalizeDomain(company.domain)
  if (!domain) return null

  const reading = siteReadingList(domain)
  const read = await inParallel(reading, 3, async (requestedUrl) => {
    try {
      const response = await requestTextWithMeta({
        url: requestedUrl,
        method: 'GET',
        timeoutMs: 8_000,
        maxBytes: MAX_BYTES,
        truncateWhenTooLarge: true,
      })
      const readable = extractReadable(response.text, response.finalUrl || requestedUrl)
      return {
        url: response.finalUrl || requestedUrl,
        emails: readable.structured.emails,
        phones: readable.structured.phones,
      }
    } catch {
      // A missing /contact page does not make the company or the run fail.
      return null
    }
  })
  const pages = read.filter((page): page is NonNullable<typeof page> => page !== null)

  const selected = selectCompanyContacts(domain, pages)
  return selected.email || selected.phone ? selected : null
}

function companyContactEvidence(
  output: CompanyContactResult | null,
  task: ResearchTask,
): NormalizedEvidence[] {
  if (!output) return []
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

export const companyContactProvider: IntelligenceProvider<CompanyContactResult | null> = {
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
