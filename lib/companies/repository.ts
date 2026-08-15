import 'server-only'

/**
 * Company persistence.
 *
 * ⚠️ Uses the service role, which BYPASSES RLS. Every call is scoped by
 * `userId` in code — both here and inside `link_leads_to_companies`, which
 * takes the user id as a parameter and scopes both sides of the write.
 *
 * All normalization happens in `lib/companies/normalize.ts` before anything
 * reaches the database.
 */
import {
  resolveCompanyIdentity,
  type CompanyIdentityInput,
  type CompanyMatchStrategy,
} from '@/lib/companies/normalize'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Rows per RPC call.
 *
 * The function loops in plpgsql and updates one lead per iteration, so a very
 * large array holds a transaction open for longer than it should. 500 matches
 * the chunk size the worker already uses for lead inserts.
 */
const LINK_BATCH_SIZE = 500

/**
 * UUIDs used by PostgREST `.in(...)` are encoded into the GET query string.
 * Five hundred UUIDs can exceed a network/proxy URL limit on the way to
 * Supabase, which only appeared once a tenant crossed a few hundred leads.
 * Writes go in a POST body and safely keep the larger batch above; reads need
 * this deliberately smaller ceiling.
 */
const QUERY_BATCH_SIZE = 100

export type LinkableLead = CompanyIdentityInput & { id: string }

export type LinkResult = {
  leadsLinked: number
  leadsUnidentified: number
  companiesTouched: number
}

type LinkRow = {
  lead_id: string
  company_id: string
  match_strategy: CompanyMatchStrategy
}

/** Truncates upstream error text so an HTML error page never reaches a log. */
function concise(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? ''
  const stripped = first.startsWith('<') ? 'upstream returned HTML' : first
  return stripped.length > 160 ? `${stripped.slice(0, 160)}…` : stripped
}

/**
 * Resolves each lead's company identity and links it, creating companies as
 * needed.
 *
 * Safe to re-run: the RPC finds the existing company rather than creating a
 * second one, and re-linking a lead to the company it already points at is a
 * no-op. That matters because `after()` retries and the reaper can re-run a
 * claim.
 */
export async function linkLeadsToCompanies(
  userId: string,
  leads: readonly LinkableLead[],
): Promise<LinkResult> {
  if (!userId) throw new Error('linkLeadsToCompanies: userId is required')

  const supabase = createAdminClient()

  const payload: Array<Record<string, string | null>> = []
  let leadsUnidentified = 0

  for (const lead of leads) {
    const identity = resolveCompanyIdentity(lead)
    if (!identity) {
      leadsUnidentified += 1
      continue
    }

    payload.push({
      lead_id: lead.id,
      name: identity.name,
      normalized_name: identity.normalizedName,
      domain: identity.domain,
      normalized_domain: identity.normalizedDomain,
      linkedin_url: identity.linkedinUrl,
      normalized_linkedin_url: identity.normalizedLinkedInUrl,
    })
  }

  const companies = new Set<string>()
  let leadsLinked = 0

  for (let i = 0; i < payload.length; i += LINK_BATCH_SIZE) {
    const { data, error } = await supabase.rpc('link_leads_to_companies', {
      p_user_id: userId,
      p_leads: payload.slice(i, i + LINK_BATCH_SIZE),
    })

    if (error) {
      throw new Error(`linkLeadsToCompanies failed: ${concise(error.message)}`)
    }

    for (const row of (data ?? []) as LinkRow[]) {
      leadsLinked += 1
      companies.add(row.company_id)
    }
  }

  return { leadsLinked, leadsUnidentified, companiesTouched: companies.size }
}

export type CompanyRecord = {
  id: string
  name: string | null
  normalizedDomain: string | null
  normalizedLinkedInUrl: string | null
  normalizedName: string | null
}

/**
 * Loads the distinct companies behind a set of leads.
 *
 * This is the entry point for company-level research: callers pass leads and
 * receive companies, so a caller cannot accidentally research the same company
 * once per employee (spec §9).
 */
export async function getCompaniesForLeads(
  userId: string,
  leadIds: readonly string[],
): Promise<{ companies: CompanyRecord[]; companyIdByLeadId: Map<string, string> }> {
  if (!userId) throw new Error('getCompaniesForLeads: userId is required')
  if (leadIds.length === 0) return { companies: [], companyIdByLeadId: new Map() }

  const supabase = createAdminClient()

  const companyIdByLeadId = new Map<string, string>()
  const companyIds = new Set<string>()

  for (let i = 0; i < leadIds.length; i += QUERY_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('extracted_leads')
      .select('id, company_id')
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .in('id', leadIds.slice(i, i + QUERY_BATCH_SIZE))

    if (error) throw new Error(`getCompaniesForLeads failed: ${concise(error.message)}`)

    for (const row of data ?? []) {
      if (!row.company_id) continue
      companyIdByLeadId.set(row.id, row.company_id)
      companyIds.add(row.company_id)
    }
  }

  const ids = [...companyIds]
  const companies: CompanyRecord[] = []

  for (let i = 0; i < ids.length; i += QUERY_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, normalized_domain, normalized_linkedin_url, normalized_name')
      .eq('user_id', userId)
      .in('id', ids.slice(i, i + QUERY_BATCH_SIZE))

    if (error) throw new Error(`getCompaniesForLeads failed: ${concise(error.message)}`)

    for (const row of data ?? []) {
      companies.push({
        id: row.id,
        name: row.name,
        normalizedDomain: row.normalized_domain,
        normalizedLinkedInUrl: row.normalized_linkedin_url,
        normalizedName: row.normalized_name,
      })
    }
  }

  return { companies, companyIdByLeadId }
}
