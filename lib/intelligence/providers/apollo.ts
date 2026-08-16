import 'server-only'

/**
 * Apollo — the second provider in the email waterfall.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  EMAIL ONLY, DELIBERATELY.                                               ║
 * ║                                                                          ║
 * ║  Apollo's `reveal_phone_number` requires a `webhook_url`: the enrichment ║
 * ║  response comes back synchronously and the phone numbers arrive LATER,   ║
 * ║  asynchronously, at a public callback. That needs a webhook route,       ║
 * ║  signature verification, and a way to match a callback back to a lead —  ║
 * ║  none of which exists. Prospeo already returns mobile synchronously.     ║
 * ║                                                                          ║
 * ║  Half-wiring the phone path would produce a provider that appears to     ║
 * ║  support phone numbers and silently never delivers one. It is left       ║
 * ║  unimplemented until the webhook exists.                                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A LOCKED EMAIL IS NOT AN EMAIL. Apollo returns a placeholder —
 * `email_not_unlocked@domain.com` — when an address exists but has not been
 * unlocked on the account's plan. Storing that would put a deliverable-looking
 * address on a lead that bounces on first send. Guarded the same way as
 * Prospeo's masking.
 */
import { normalizeDomain } from '@/lib/companies/normalize'
import { requestJson, setHostPacing, ProviderHttpError } from '@/lib/intelligence/http'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import type {
  IntelligenceProvider,
  NormalizedEvidence,
  PersonEntity,
  ResearchField,
  ResearchTask,
  SourceConfidence,
} from '@/lib/intelligence/types'

const APOLLO_HOST = 'api.apollo.io'
const MATCH_URL = `https://${APOLLO_HOST}/api/v1/people/match`

setHostPacing(APOLLO_HOST, 300)

/** Credits per match vary by plan; recorded as an estimate for the ledger. */
const MATCH_COST_MICROS = 20_000

type ApolloOrganization = {
  name?: string
  website_url?: string
  primary_domain?: string
  industry?: string
  estimated_num_employees?: number
  technology_names?: string[]
  total_funding?: number
  latest_funding_round_date?: string
  latest_funding_stage?: string
  city?: string
  state?: string
  country?: string
  short_description?: string
  annual_revenue?: number
  founded_year?: number
  twitter_url?: string | null
  facebook_url?: string | null
  linkedin_url?: string | null
  crunchbase_url?: string | null
}

type ApolloResponse = {
  person?: {
    id?: string
    name?: string
    email?: string | null
    email_status?: string | null
    linkedin_url?: string | null
    title?: string | null
    seniority?: string | null
    departments?: string[] | null
    organization?: ApolloOrganization
  }
}

export type ApolloOutput = { response: ApolloResponse }

/**
 * Placeholders Apollo substitutes for an address it will not hand over.
 *
 * Matched on shape rather than an exact string: the local part is the tell, and
 * the domain varies per company.
 */
const LOCKED_EMAIL_PATTERNS = [
  /^email_not_unlocked/i,
  /^not_unlocked/i,
  /^email_hidden/i,
  /^locked/i,
]

/**
 * An address is real only if it looks like one and is not a placeholder.
 *
 * PURE, so every placeholder shape is testable without an Apollo account.
 */
export function usableEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const email = raw.trim().toLowerCase()
  if (!email || !email.includes('@')) return null

  const localPart = email.split('@')[0] ?? ''
  if (LOCKED_EMAIL_PATTERNS.some((pattern) => pattern.test(localPart))) return null

  // A masked address is no more usable than a locked one.
  if (email.includes('*')) return null

  return email
}

/**
 * Maps an Apollo response onto evidence.
 *
 * PURE. Same windfall treatment as Prospeo: the organization block is filed
 * against the COMPANY, so the facts outlive this one contact lookup.
 */
export function apolloEvidence(
  output: ApolloOutput,
  person: PersonEntity,
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  const found = output.response.person
  if (!found) return []

  const evidence: NormalizedEvidence[] = []

  const push = (
    field: ResearchField,
    entityType: 'person' | 'company',
    entityId: string,
    value: Record<string, unknown>,
    sourceConfidence: SourceConfidence,
    confidence: number,
  ) => {
    evidence.push({
      field,
      entityType,
      entityId,
      value,
      sourceProvider: 'apollo',
      sourceUrl: null,
      sourceConfidence,
      confidence,
      retrievedAt: retrievedAt.toISOString(),
      expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
    })
  }

  const email = usableEmail(found.email)
  if (email) {
    push('work_email', 'person', person.id, { email }, 'high', 0.85)
    push(
      'email_status',
      'person',
      person.id,
      { status: (found.email_status ?? 'unknown').toUpperCase() },
      'high',
      0.85,
    )
  }

  /*
   * Seniority and department — already on the response, previously discarded.
   *
   * Spec §19 weights seniority as an ICP criterion, and Apollo returns it on the
   * match that was paid for anyway. Unlike Prospeo's, these describe the CURRENT
   * role by construction: `people/match` resolves one person at one company.
   */
  if (typeof found.seniority === 'string' && found.seniority.trim()) {
    push('person_seniority', 'person', person.id, { value: found.seniority.trim() }, 'medium', 0.75)
  }

  const departments = (found.departments ?? []).filter(
    (name): name is string => typeof name === 'string' && name.trim().length > 0,
  )
  if (departments.length > 0) {
    push('person_department', 'person', person.id, { value: departments }, 'medium', 0.7)
  }

  const org = found.organization
  if (!org || !person.companyId) return evidence

  const companyId = person.companyId

  const domain = normalizeDomain(org.primary_domain ?? org.website_url)
  if (domain) {
    push('company_domain', 'company', companyId, { domain, website: org.website_url ?? null }, 'high', 0.85)
  }

  if (org.industry) {
    push('industry', 'company', companyId, { industry: org.industry }, 'medium', 0.75)
  }

  if (typeof org.estimated_num_employees === 'number' && org.estimated_num_employees >= 0) {
    push(
      'employee_count',
      'company',
      companyId,
      // Named as the estimate it is, so a range filter is not applied to it as
      // though it were a headcount from a filing.
      { count: org.estimated_num_employees, isEstimate: true },
      'medium',
      0.7,
    )
  }

  if (org.country) {
    push(
      'headquarters',
      'company',
      companyId,
      {
        headquarters: [org.city, org.state, org.country].filter(Boolean).join(', '),
        country: org.country,
      },
      'medium',
      0.75,
    )
  }

  if (org.short_description) {
    push('company_description', 'company', companyId, { description: org.short_description }, 'medium', 0.7)
  }

  const stage = org.latest_funding_stage
  if (stage && !/unknown/i.test(stage)) {
    push('funding_round', 'company', companyId, { round: stage }, 'medium', 0.7)
  }

  if (typeof org.total_funding === 'number' && org.total_funding > 0) {
    push(
      'funding_amount',
      'company',
      companyId,
      // TOTAL raised across all rounds, not the latest round. Labelled, because
      // a "raised more than $5M" filter means something different against each.
      { amount: org.total_funding, currency: 'USD', isTotalFunding: true },
      'medium',
      0.65,
    )
  }

  if (org.latest_funding_round_date) {
    push(
      'funding_date',
      'company',
      companyId,
      { raisedAt: org.latest_funding_round_date, isAnnouncementDate: false },
      'medium',
      0.7,
    )
  }

  const technologies = (org.technology_names ?? [])
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ id: name.toLowerCase(), name, category: 'other' }))

  if (technologies.length > 0) {
    push(
      'tech_stack',
      'company',
      companyId,
      { detected: technologies, coverage: 'vendor_detected' },
      'medium',
      0.75,
    )
  }

  if (typeof org.annual_revenue === 'number' && org.annual_revenue > 0) {
    push(
      'revenue_estimate',
      'company',
      companyId,
      // A single modelled figure, not a range — recorded as both bounds so a
      // range filter has something to compare, and labelled as an estimate.
      { min: org.annual_revenue, max: org.annual_revenue, currency: 'USD', isEstimate: true },
      'low',
      0.5,
    )
  }

  /*
   * ⚠️ A FOUNDING YEAR IS NOT AN INCORPORATION FILING.
   *
   * Companies House and SEC give a registry date; Apollo gives a year the
   * company reports about itself. Both answer "when did this company begin", so
   * they share a field — but `precision: 'year'` is carried through so company
   * age is not computed to a false day, and confidence is set well below a
   * filing's so a registry date wins the waterfall.
   */
  if (
    typeof org.founded_year === 'number' &&
    org.founded_year > 1700 &&
    org.founded_year <= retrievedAt.getUTCFullYear()
  ) {
    push(
      'incorporation_date',
      'company',
      companyId,
      { value: String(org.founded_year), year: org.founded_year, precision: 'year', isFoundingYear: true },
      'low',
      0.55,
    )
  }

  // Free on a response already paid for. See the same harvest in `prospeo.ts`.
  const socials: Record<string, string> = {}
  for (const [platform, url] of [
    ['twitter', org.twitter_url],
    ['facebook', org.facebook_url],
    ['linkedin', org.linkedin_url],
    ['crunchbase', org.crunchbase_url],
  ] as const) {
    if (typeof url === 'string' && url.trim().length > 0) socials[platform] = url.trim()
  }

  if (Object.keys(socials).length > 0) {
    push('social_profiles', 'company', companyId, socials, 'medium', 0.8)
  }

  return evidence
}

export function hasApolloCredentials(): boolean {
  return Boolean(process.env.APOLLO_API_KEY)
}

async function callApollo(person: PersonEntity): Promise<ApolloOutput> {
  const body: Record<string, unknown> = {
    name: person.fullName ?? undefined,
    organization_name: person.companyName ?? undefined,
    domain: person.companyDomain ?? undefined,
    // reveal_phone_number is deliberately absent — see the header comment.
    reveal_personal_emails: false,
  }

  const response = await requestJson<ApolloResponse>({
    url: MATCH_URL,
    method: 'POST',
    headers: { 'x-api-key': process.env.APOLLO_API_KEY! },
    body,
  })

  return { response }
}

/** A miss is `not_found`, not an outage — no retry, no fallback storm. */
async function safeCall(person: PersonEntity): Promise<ApolloOutput> {
  try {
    return await callApollo(person)
  } catch (error) {
    if (error instanceof ProviderHttpError && error.code === 'ERR_PROVIDER_REJECTED') {
      return { response: {} }
    }
    throw error
  }
}

export const apolloEmailProvider: IntelligenceProvider<ApolloOutput> = {
  name: 'apollo-email',
  category: 'contact_email',

  canHandle: (task: ResearchTask) => {
    if (task.entity.type !== 'person') return false
    const person = task.entity
    return (
      Boolean(person.fullName) &&
      Boolean(person.companyName ?? person.companyDomain) &&
      hasApolloCredentials()
    )
  },

  estimateCost: async () => MATCH_COST_MICROS,
  execute: (task) => safeCall(task.entity as PersonEntity),
  normalize: (output, task) => apolloEvidence(output, task.entity as PersonEntity),
}
