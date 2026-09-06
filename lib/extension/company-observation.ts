import 'server-only'

/**
 * Recording a company website the user saw on a company page.
 *
 * ⚠️ THIS IS A BACK-FILL, NOT A CAPTURE. No page is uploaded, no leads are
 * created, no credit is consumed and the session's page count does not move.
 * Billing a company page as a capture would charge for a page that yields no
 * leads.
 *
 * The website is written onto every lead the user already holds at that
 * company, because a CRM row is a person and the person's row is where a seller
 * reads it. It is matched on the Sales Navigator company id, which is the only
 * identifier both the results page and the company page agree on.
 */
import { normalizeDomain } from '@/lib/companies/normalize'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ExtractedLeadRow } from '@/types/database'

export type CompanyPersonInput = {
  name: string
  salesNavUrl: string | null
  linkedinUrl: string | null
  jobTitle: string | null
}

export type CompanyObservationInput = {
  companyId: string
  companyName: string | null
  websiteUrl: string | null
  publicLinkedinUrl: string | null
  employeeCount: number | null
  decisionMakerCount: number | null
  people: CompanyPersonInput[]
}

export type CompanyObservationOutcome = {
  /** Leads whose empty company columns have now been filled. */
  leadsUpdated: number
  /** True when a `companies` row also adopted the domain. */
  companyUpdated: boolean
  /** People found on the company page and added as new leads. */
  peopleAdded: number
  /** People skipped because they are already in the database. */
  peopleAlreadyKnown: number
}

/**
 * Every URL shape the parser may have stored for one company id.
 *
 * `companyProfileUrl` keeps the absolute href exactly as LinkedIn rendered it,
 * and LinkedIn renders it with and without `www`, with and without a trailing
 * slash. Matching on one spelling would quietly update a fraction of the rows.
 */
function companyUrlPatterns(companyId: string): string[] {
  return [
    `https://www.linkedin.com/sales/company/${companyId}`,
    `https://linkedin.com/sales/company/${companyId}`,
  ]
}

/**
 * Applies one observation.
 *
 * ⚠️ ONLY FILLS EMPTY CELLS. A website already stored came from the results
 * page for that specific lead; overwriting it from a company page the user
 * happened to open would let one visit rewrite data the user never questioned.
 * `is('company_website_url', null)` is the whole safety property.
 */
export async function recordCompanyObservation(
  userId: string,
  input: CompanyObservationInput,
): Promise<CompanyObservationOutcome> {
  const supabase = createAdminClient()
  const patterns = companyUrlPatterns(input.companyId)

  let leadsUpdated = 0

  /*
   * ⚠️ ONE UPDATE PER COLUMN, EACH GUARDED BY ITS OWN `is(..., null)`.
   *
   * A single UPDATE setting every column would overwrite values that came from
   * the results page for that specific lead. Each field is filled only where it
   * is genuinely empty, so opening a company page can add information and never
   * replace it.
   */
  const fills: Array<[keyof ExtractedLeadRow & string, string | number | null]> = [
    ['company_website_url', input.websiteUrl],
    ['company_public_linkedin_url', input.publicLinkedinUrl],
    ['company_employee_count', input.employeeCount],
    ['company_decision_maker_count', input.decisionMakerCount],
  ]

  for (const pattern of patterns) {
    for (const [column, value] of fills) {
      if (value === null) continue

      const { data } = await supabase
        .from('extracted_leads')
        .update({ [column]: value } as never)
        // Service role bypasses RLS — scoping by user_id is mandatory.
        .eq('user_id', userId)
        // Both the bare URL and any suffixed spelling of it.
        .like('company_url', `${pattern}%`)
        .is(column, null)
        .select('id')

      if (column === 'company_website_url') leadsUpdated += data?.length ?? 0
    }
  }

  /*
   * The `companies` row adopts the domain too, so the intelligence layer starts
   * from it instead of paying a provider to rediscover it. Guarded: another
   * company may already own that domain, and a unique-index collision is not a
   * reason to fail an observation whose leads are already updated.
   */
  let companyUpdated = false
  const domain = normalizeDomain(input.websiteUrl)

  if (domain) {
    try {
      const { data } = await supabase
        .from('companies')
        .update({ domain })
        .eq('user_id', userId)
        .eq('linkedin_url', `https://www.linkedin.com/sales/company/${input.companyId}`)
        .is('domain', null)
        .select('id')

      companyUpdated = (data?.length ?? 0) > 0
    } catch {
      // The leads are updated either way; identity can be resolved later.
    }
  }

  const { peopleAdded, peopleAlreadyKnown } = await ingestPeople(userId, input)

  return { leadsUpdated, companyUpdated, peopleAdded, peopleAlreadyKnown }
}

/**
 * Adds the people listed on a company page as leads.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ DEDUPLICATED AGAINST THE WHOLE ACCOUNT, NOT JUST THIS COMPANY.       ║
 * ║                                                                          ║
 * ║  A founder is frequently both a search result and their own company's    ║
 * ║  decision maker. Inserting blind would give the user the same person      ║
 * ║  twice in one export, which is exactly the duplication the extraction    ║
 * ║  pipeline exists to prevent. Matching is on the member id inside the     ║
 * ║  profile URL — the one identifier that survives a name being rendered    ║
 * ║  differently on two pages.                                               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * They join the extraction job their company's existing leads belong to, so a
 * user exporting that run gets them, and `lead_source` records that they were
 * discovered rather than searched for.
 */
async function ingestPeople(
  userId: string,
  input: CompanyObservationInput,
): Promise<{ peopleAdded: number; peopleAlreadyKnown: number }> {
  if (input.people.length === 0) return { peopleAdded: 0, peopleAlreadyKnown: 0 }

  const supabase = createAdminClient()

  // The job and company these people should attach to: whichever run already
  // holds leads at this company. Without one there is nothing to attach to.
  const { data: anchor } = await supabase
    .from('extracted_leads')
    .select('extraction_job_id, company_id, company_name, company_url')
    .eq('user_id', userId)
    .like('company_url', `${companyUrlPatterns(input.companyId)[0]}%`)
    .limit(1)
    .maybeSingle()

  if (!anchor?.extraction_job_id) return { peopleAdded: 0, peopleAlreadyKnown: 0 }

  const { data: existing } = await supabase
    .from('extracted_leads')
    .select('linkedin_url, sales_navigator_url')
    .eq('user_id', userId)

  const known = new Set<string>()
  for (const row of existing ?? []) {
    for (const url of [row.linkedin_url, row.sales_navigator_url]) {
      const id = memberId(url)
      if (id) known.add(id)
    }
  }

  const rows: Array<Record<string, unknown>> = []
  let peopleAlreadyKnown = 0

  for (const person of input.people) {
    const id = memberId(person.salesNavUrl) ?? memberId(person.linkedinUrl)
    // No member id means no way to tell this person from anyone else later.
    if (!id) continue

    if (known.has(id)) {
      peopleAlreadyKnown += 1
      continue
    }
    known.add(id)

    rows.push({
      user_id: userId,
      extraction_job_id: anchor.extraction_job_id,
      full_name: person.name,
      job_title: person.jobTitle,
      linkedin_url: person.linkedinUrl,
      sales_navigator_url: person.salesNavUrl,
      company_name: anchor.company_name ?? input.companyName,
      company_url: anchor.company_url,
      company_id: anchor.company_id,
      company_website_url: input.websiteUrl,
      company_public_linkedin_url: input.publicLinkedinUrl,
      company_employee_count: input.employeeCount,
      lead_source: 'company_page',
      source_list: input.companyName ? `${input.companyName} · company page` : null,
      // Hashed, like every other key — see lib/leads/dedupe.ts.
      dedupe_key: `li:lead:${id}`,
      dedupe_strategy: 'linkedin_url',
      is_duplicate: false,
      source_row_index: 0,
    })
  }

  if (rows.length === 0) return { peopleAdded: 0, peopleAlreadyKnown }

  const { data: inserted } = await supabase
    .from('extracted_leads')
    .insert(rows as never)
    .select('id')

  return { peopleAdded: inserted?.length ?? 0, peopleAlreadyKnown }
}

/**
 * The stable member id inside a LinkedIn or Sales Navigator profile URL.
 *
 * `/in/ACwAAAF8aVAB…` and `/sales/lead/ACwAAAF8aVAB…,NAME_SEARCH,abcd` are the
 * same person; the id is the only part both spellings share, so it is the only
 * safe thing to deduplicate on.
 */
export function memberId(url: string | null | undefined): string | null {
  if (!url) return null

  const match = /\/(?:in|sales\/lead)\/([A-Za-z0-9_-]{10,})/.exec(url)
  return match?.[1] ?? null
}
