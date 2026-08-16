import 'server-only'

/**
 * Prospeo — contact enrichment, plus a large windfall.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  TWO RULES THAT COST REAL MONEY IF BROKEN.                               ║
 * ║                                                                          ║
 * ║  1. MASKED IS NOT A VALUE. When a field is not revealed, Prospeo still   ║
 * ║     returns it — masked: `eoghan.*****@intercom.com`, `+1 415-3**-****`, ║
 * ║     with `revealed: false`. Storing one of those as a contact detail     ║
 * ║     would be fabricating lead data (CLAUDE.md rule 4) and would look     ║
 * ║     exactly like a successful enrichment. Every value is gated on        ║
 * ║     `revealed === true` AND the absence of a mask character.             ║
 * ║                                                                          ║
 * ║  2. MOBILE COSTS 10× EMAIL. `enrich_mobile` is only ever set when the    ║
 * ║     plan explicitly asked for a phone number. Requesting it "while we    ║
 * ║     are here" multiplies the bill by ten for data nobody asked for.      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * MATCHING ON THIS DATA: Prospeo accepts a LinkedIn URL, but public profile
 * URLs only — explicitly not member IDs or URNs. Every LinkedIn URL in this
 * product is the URN form built from Sales Navigator, so that path is unusable
 * here. Matching therefore goes through name + company name, which Prospeo also
 * accepts and which the captured data does have.
 *
 * THE WINDFALL: one paid call returns the employer's domain, industry,
 * headcount, revenue band, funding events, technology list and open roles.
 * Those are filed as evidence against the COMPANY, so the next query about that
 * company is free. They never count as answering the contact question.
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

const PROSPEO_HOST = 'api.prospeo.io'
const ENRICH_URL = `https://${PROSPEO_HOST}/enrich-person`

setHostPacing(PROSPEO_HOST, 300)

/** 1 credit per email found. Micros are USD; adjust when the plan price is known. */
const EMAIL_COST_MICROS = 20_000
/** 10 credits per mobile found — the reason phone is never speculative. */
const MOBILE_COST_MICROS = 200_000

type ProspeoContact = {
  status?: string
  revealed?: boolean
  email?: string
  mobile?: string
  mobile_international?: string
  verification_method?: string
}

type ProspeoResponse = {
  error?: boolean
  error_code?: string
  free_enrichment?: boolean
  person?: {
    full_name?: string
    email?: ProspeoContact
    mobile?: ProspeoContact
    job_history?: Array<{
      current?: boolean
      seniority?: string
      departments?: string[]
      title?: string
    }>
  }
  company?: {
    name?: string
    website?: string
    domain?: string
    description?: string
    industry?: string
    employee_count?: number
    location?: { country?: string; state?: string; city?: string }
    revenue_range?: { min?: number; max?: number }
    funding?: {
      total_funding?: number
      latest_funding_date?: string
      latest_funding_stage?: string
      funding_events?: Array<{
        amount?: number | null
        raised_at?: string
        stage?: string
        link?: string
      }>
    }
    technology?: {
      technology_list?: Array<{ name?: string; category?: string }>
    }
    job_postings?: { active_count?: number; active_titles?: string[] }
    twitter_url?: string
    facebook_url?: string
    instagram_url?: string
    youtube_url?: string
    crunchbase_url?: string
    linkedin_url?: string
  }
}

/**
 * A value is real only if Prospeo says it was revealed AND it carries no mask.
 *
 * Both checks, not either: `revealed` is the contract, and the mask character is
 * the observable proof. A provider change that flipped one without the other
 * must not silently start storing `eoghan.*****@intercom.com` as an address.
 */
export function revealedValue(contact: ProspeoContact | undefined, key: 'email' | 'mobile'): string | null {
  if (!contact || contact.revealed !== true) return null

  const raw = key === 'email' ? contact.email : (contact.mobile_international ?? contact.mobile)
  if (typeof raw !== 'string') return null

  const value = raw.trim()
  if (!value || value.includes('*')) return null

  return value
}

export type ProspeoOutput = {
  response: ProspeoResponse
  /** Whether this call asked for — and could be charged for — a mobile number. */
  requestedMobile: boolean
}

function pickLatestFundingEvent(funding: NonNullable<ProspeoResponse['company']>['funding']) {
  const events = (funding?.funding_events ?? []).filter(
    (event) => typeof event.amount === 'number' && event.amount > 0 && event.raised_at,
  )
  if (events.length === 0) return null

  return events.sort(
    (a, b) => Date.parse(b.raised_at ?? '') - Date.parse(a.raised_at ?? ''),
  )[0]!
}

/**
 * Maps a Prospeo response onto evidence.
 *
 * PURE, so every mask, every missing branch and every funding shape is tested
 * against recorded responses rather than against a live account.
 */
export function prospeoEvidence(
  output: ProspeoOutput,
  person: PersonEntity,
  retrievedAt: Date = new Date(),
): NormalizedEvidence[] {
  const { response } = output
  if (response.error) return []

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
      sourceProvider: 'prospeo',
      // Prospeo returns no per-fact citation, and inventing one would be worse
      // than admitting there is none. The provider name is the provenance.
      sourceUrl: null,
      sourceConfidence,
      confidence,
      retrievedAt: retrievedAt.toISOString(),
      expiresAt: expiresAtFor(field, retrievedAt)?.toISOString() ?? null,
    })
  }

  // ---- person: the thing that was actually paid for ----------------------
  const email = revealedValue(response.person?.email, 'email')
  if (email) {
    push('work_email', 'person', person.id, { email }, 'high', 0.9)
    push(
      'email_status',
      'person',
      person.id,
      {
        status: response.person?.email?.status ?? 'UNKNOWN',
        verificationMethod: response.person?.email?.verification_method ?? null,
      },
      'high',
      0.9,
    )
  }

  const mobile = revealedValue(response.person?.mobile, 'mobile')
  if (mobile) {
    push('mobile_phone', 'person', person.id, { phone: mobile }, 'high', 0.85)
    push(
      'phone_status',
      'person',
      person.id,
      { status: response.person?.mobile?.status ?? 'UNKNOWN' },
      'high',
      0.85,
    )
  }

  /*
   * Seniority and department, from the person's CURRENT role only.
   *
   * Spec §19 scores "founder seniority" as a weighted ICP criterion, and
   * Prospeo returns it on a call already paid for. A past role would describe
   * who they used to be.
   */
  const currentRole = response.person?.job_history?.find((role) => role.current === true)
  if (currentRole?.seniority) {
    push('person_seniority', 'person', person.id, { value: currentRole.seniority }, 'high', 0.85)
  }
  if (currentRole?.departments?.length) {
    push('person_department', 'person', person.id, { value: currentRole.departments }, 'high', 0.8)
  }

  // ---- company: the windfall ---------------------------------------------
  const company = response.company
  if (!company || !person.companyId) return evidence

  const companyId = person.companyId

  const domain = normalizeDomain(company.domain ?? company.website)
  if (domain) {
    push('company_domain', 'company', companyId, { domain, website: company.website ?? null }, 'high', 0.9)
  }

  if (company.industry) {
    push('industry', 'company', companyId, { industry: company.industry }, 'medium', 0.8)
  }

  if (typeof company.employee_count === 'number' && company.employee_count >= 0) {
    push('employee_count', 'company', companyId, { count: company.employee_count }, 'medium', 0.8)
  }

  if (company.location?.country) {
    push(
      'headquarters',
      'company',
      companyId,
      {
        headquarters: [company.location.city, company.location.state, company.location.country]
          .filter(Boolean)
          .join(', '),
        country: company.location.country,
      },
      'medium',
      0.8,
    )
  }

  if (company.description) {
    push('company_description', 'company', companyId, { description: company.description }, 'medium', 0.75)
  }

  if (typeof company.revenue_range?.min === 'number') {
    push(
      'revenue_estimate',
      'company',
      companyId,
      { min: company.revenue_range.min, max: company.revenue_range.max ?? null, currency: 'USD' },
      'medium',
      0.6,
    )
  }

  const latest = pickLatestFundingEvent(company.funding)
  if (latest) {
    // MEDIUM: aggregated from a third-party database, not the company speaking.
    const stage = latest.stage && !/unknown/i.test(latest.stage) ? latest.stage : null
    if (stage) push('funding_round', 'company', companyId, { round: stage }, 'medium', 0.75)

    push(
      'funding_amount',
      'company',
      companyId,
      { amount: latest.amount, currency: 'USD', source: latest.link ?? null },
      'medium',
      0.75,
    )
    push('funding_currency', 'company', companyId, { currency: 'USD' }, 'medium', 0.7)

    if (latest.raised_at) {
      push(
        'funding_date',
        'company',
        companyId,
        // A real round date, unlike the announcement date the news-derived
        // provider has to settle for.
        { raisedAt: latest.raised_at, isAnnouncementDate: false },
        'medium',
        0.75,
      )
    }
  }

  const technologies = (company.technology?.technology_list ?? [])
    .filter((item) => item.name)
    .map((item) => ({ id: item.name!.toLowerCase(), name: item.name!, category: item.category ?? 'other' }))

  if (technologies.length > 0) {
    push(
      'tech_stack',
      'company',
      companyId,
      // Real marketing and sales tools, which Lighthouse stack packs cannot see.
      { detected: technologies, coverage: 'vendor_detected' },
      'medium',
      0.8,
    )
  }

  /*
   * Social profiles — free, and the thing users actually asked for.
   *
   * Every one of these arrives on the same paid response. An earlier version of
   * this adapter discarded them, and users asking "their Instagram and X" got a
   * partial answer for data already in hand.
   */
  const socialCandidates: Array<[string, string | undefined]> = [
    ['twitter', company.twitter_url],
    ['instagram', company.instagram_url],
    ['facebook', company.facebook_url],
    ['youtube', company.youtube_url],
    ['crunchbase', company.crunchbase_url],
    ['linkedin', company.linkedin_url],
  ]

  const socials: Record<string, string> = {}
  for (const [platform, url] of socialCandidates) {
    if (typeof url === 'string' && url.trim().length > 0) socials[platform] = url.trim()
  }

  if (Object.keys(socials).length > 0) {
    push('social_profiles', 'company', companyId, socials, 'medium', 0.85)
  }

  const postings = company.job_postings
  if (typeof postings?.active_count === 'number' && postings.active_count > 0) {
    const titles = postings.active_titles ?? []
    push(
      'hiring_signals',
      'company',
      companyId,
      {
        hiring: true,
        openRoles: postings.active_count,
        roles: titles,
        salesHiring: titles.some((title) =>
          /\b(sdr|sales|account executive|business development|revenue)\b/i.test(title),
        ),
      },
      'medium',
      0.8,
    )
  }

  return evidence
}

export function hasProspeoCredentials(): boolean {
  return Boolean(process.env.PROSPEO_API_KEY)
}

async function callProspeo(person: PersonEntity, wantMobile: boolean): Promise<ProspeoOutput> {
  const apiKey = process.env.PROSPEO_API_KEY!

  // Name + company name. The LinkedIn path is unusable here: Prospeo takes
  // public profile URLs, and every URL this product holds is the member-URN
  // form built from Sales Navigator.
  const data: Record<string, string> = { full_name: person.fullName ?? '' }
  if (person.companyDomain) data.company_website = person.companyDomain
  else if (person.companyName) data.company_name = person.companyName

  const response = await requestJson<ProspeoResponse>({
    url: ENRICH_URL,
    method: 'POST',
    headers: { 'x-key': apiKey },
    body: {
      only_verified_email: true,
      enrich_mobile: wantMobile,
      data,
    },
  })

  return { response, requestedMobile: wantMobile }
}

/**
 * Turns a provider error into "no match" rather than a failure.
 *
 * Prospeo answers a genuine miss with HTTP 400 and `NO_MATCH`. Treating that as
 * an outage would trigger a pointless retry and a fallback provider for a
 * person who simply is not in their dataset.
 */
async function safeCall(person: PersonEntity, wantMobile: boolean): Promise<ProspeoOutput> {
  try {
    return await callProspeo(person, wantMobile)
  } catch (error) {
    if (error instanceof ProviderHttpError && error.code === 'ERR_PROVIDER_REJECTED') {
      return { response: { error: true, error_code: 'NO_MATCH' }, requestedMobile: wantMobile }
    }
    throw error
  }
}

function canEnrich(task: ResearchTask): boolean {
  if (task.entity.type !== 'person') return false
  const person = task.entity
  return (
    Boolean(person.fullName) &&
    Boolean(person.companyName ?? person.companyDomain) &&
    hasProspeoCredentials()
  )
}

export const prospeoEmailProvider: IntelligenceProvider<ProspeoOutput> = {
  name: 'prospeo-email',
  category: 'contact_email',

  canHandle: canEnrich,
  estimateCost: async () => EMAIL_COST_MICROS,

  // enrich_mobile stays FALSE here. This provider answers email questions, and
  // a phone number nobody asked for costs ten times as much.
  execute: (task) => safeCall(task.entity as PersonEntity, false),
  normalize: (output, task) => prospeoEvidence(output, task.entity as PersonEntity),
}

export const prospeoPhoneProvider: IntelligenceProvider<ProspeoOutput> = {
  name: 'prospeo-phone',
  category: 'contact_phone',

  canHandle: canEnrich,
  // Email comes free with a mobile request, so the mobile price is the price.
  estimateCost: async () => MOBILE_COST_MICROS,

  execute: (task) => safeCall(task.entity as PersonEntity, true),
  normalize: (output, task) => prospeoEvidence(output, task.entity as PersonEntity),
}
