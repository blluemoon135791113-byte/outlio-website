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

export type CompanyObservationInput = {
  companyId: string
  companyName: string | null
  websiteUrl: string
}

export type CompanyObservationOutcome = {
  /** Leads whose website column was empty and has now been filled. */
  leadsUpdated: number
  /** True when a `companies` row also adopted the domain. */
  companyUpdated: boolean
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

  for (const pattern of patterns) {
    const { data } = await supabase
      .from('extracted_leads')
      .update({ company_website_url: input.websiteUrl })
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      // Both the bare URL and any suffixed spelling of it.
      .like('company_url', `${pattern}%`)
      .is('company_website_url', null)
      .select('id')

    leadsUpdated += data?.length ?? 0
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

  return { leadsUpdated, companyUpdated }
}
