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
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  CompanyEntity,
  IntelligenceProvider,
  NormalizedEvidence,
  ResearchTask,
} from '@/lib/intelligence/types'

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us'] as const
const MAX_BYTES = 300_000
const WANTED = new Set(['company_contact_email', 'company_contact_phone'])
const GENERIC_LOCAL_PRIORITY = [
  'sales', 'contact', 'hello', 'info', 'business', 'office', 'support', 'team',
]

export type CompanyContactResult = {
  email: { value: string; sourceUrl: string } | null
  phone: { value: string; sourceUrl: string } | null
}

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

  return {
    email: emails[0] ?? null,
    phone: phones[0] ?? null,
  }
}

async function fetchContacts(company: CompanyEntity): Promise<CompanyContactResult | null> {
  const domain = normalizeDomain(company.domain)
  if (!domain) return null
  const pages: Array<{ url: string; emails: string[]; phones: string[] }> = []

  for (const path of CONTACT_PATHS) {
    const requestedUrl = `https://${domain}${path}/`
    try {
      const response = await requestTextWithMeta({
        url: requestedUrl,
        method: 'GET',
        timeoutMs: 8_000,
        maxBytes: MAX_BYTES,
        truncateWhenTooLarge: true,
      })
      const readable = extractReadable(response.text, response.finalUrl || requestedUrl)
      pages.push({
        url: response.finalUrl || requestedUrl,
        emails: readable.structured.emails,
        phones: readable.structured.phones,
      })
    } catch {
      // A missing /contact page does not make the company or the run fail.
    }
  }

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
