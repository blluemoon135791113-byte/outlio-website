import 'server-only'

/**
 * Durable Account List membership and recommended-contact persistence.
 *
 * Companies stay first-class company rows. A recommendation becomes an
 * extracted lead only when LinkedIn actually rendered a person on that account
 * row, which lets the ordinary contact providers enrich it without inventing a
 * decision maker for company-only entries.
 */
import type { AccountIngestResult } from '@/lib/companies/ingest-accounts'
import type { ParsedAccount } from '@/lib/companies/parse-account-list'
import { resolveKey } from '@/lib/leads/dedupe'
import type { ParsedLead } from '@/lib/leads/parse'
import { createAdminClient } from '@/lib/supabase/admin'

const QUERY_BATCH = 100
const WRITE_BATCH = 500

export type PersistedAccountList = {
  accountCount: number
  recommendedContactCount: number
  companyIds: string[]
  recommendedLeadIds: string[]
}

function recommendedLead(account: ParsedAccount): ParsedLead | null {
  const recommendation = account.recommendation
  if (!recommendation) return null

  return {
    fullName: recommendation.fullName,
    // This is the same stable member-id fallback used by the lead parser when
    // a captured Sales Navigator row carries no public /in/ slug.
    linkedinUrl: `https://www.linkedin.com/in/${recommendation.memberId}`,
    salesNavUrl: recommendation.salesNavUrl,
    memberUrn: recommendation.memberId,
    jobTitle: recommendation.jobTitle,
    companyName: account.companyName,
    companyWebsiteUrl: null,
    companyUrl: account.salesNavUrl,
    location: null,
    personBlurb: null,
    tenureInRole: null,
    tenureInCompany: null,
    connectionDegree: recommendation.connectionDegree,
    isReachable: null,
    listCount: null,
    lastActivity: null,
    addedToListAt: null,
    sourceList: account.sourceList ?? null,
    companyPublicLinkedInUrl: null,
    companyIndustry: account.industry,
    companySize: null,
    companyHeadquarters: null,
    sourceRowIndex: account.sourceRowIndex + 1,
  }
}

/** Prefer the row that actually carries a recommendation when pages overlap. */
function dedupeCompanies(entries: AccountIngestResult['entries']): AccountIngestResult['entries'] {
  const byCompany = new Map<string, AccountIngestResult['entries'][number]>()
  for (const entry of entries) {
    const previous = byCompany.get(entry.companyId)
    if (!previous || (!previous.account.recommendation && entry.account.recommendation)) {
      byCompany.set(entry.companyId, entry)
    }
  }
  return [...byCompany.values()]
}

/**
 * Upserts one stable Account List entry per company and links its recommendation
 * to a reusable lead identity. Safe to run again after a stale worker claim.
 */
export async function persistAccountList(
  userId: string,
  extractionJobId: string,
  ingested: AccountIngestResult,
): Promise<PersistedAccountList> {
  if (!userId) throw new Error('persistAccountList: userId is required')
  const entries = dedupeCompanies(ingested.entries)
  if (entries.length === 0) {
    return { accountCount: 0, recommendedContactCount: 0, companyIds: [], recommendedLeadIds: [] }
  }

  const supabase = createAdminClient()
  const recommendations = entries.flatMap((entry) => {
    const lead = recommendedLead(entry.account)
    if (!lead) return []
    const key = resolveKey(lead)
    return [{ entry, lead, ...key }]
  })

  const leadIdByKey = new Map<string, string>()
  const keys = [...new Set(recommendations.map((item) => item.key))]
  for (let index = 0; index < keys.length; index += QUERY_BATCH) {
    const { data, error } = await supabase
      .from('extracted_leads')
      .select('id, dedupe_key')
      .eq('user_id', userId)
      .in('dedupe_key', keys.slice(index, index + QUERY_BATCH))
      .order('created_at', { ascending: true })
    if (error) throw new Error('Could not resolve existing recommended contacts.')
    for (const row of data ?? []) {
      if (!leadIdByKey.has(row.dedupe_key)) leadIdByKey.set(row.dedupe_key, row.id)
    }
  }

  const missing = recommendations.filter((item) => !leadIdByKey.has(item.key))
  for (let index = 0; index < missing.length; index += WRITE_BATCH) {
    const batch = missing.slice(index, index + WRITE_BATCH)
    const { data, error } = await supabase
      .from('extracted_leads')
      .insert(batch.map(({ entry, lead, key, strategy }) => ({
        user_id: userId,
        extraction_job_id: extractionJobId,
        full_name: lead.fullName,
        linkedin_url: lead.linkedinUrl,
        sales_navigator_url: lead.salesNavUrl,
        job_title: lead.jobTitle,
        company_name: lead.companyName,
        company_url: lead.companyUrl,
        company_website_url: null,
        source_list: lead.sourceList,
        company_industry: lead.companyIndustry,
        connection_degree: lead.connectionDegree,
        source_row_index: lead.sourceRowIndex,
        dedupe_key: key,
        dedupe_strategy: strategy,
        is_duplicate: false,
        lead_source: 'decision_maker',
        company_id: entry.companyId,
        company_match_strategy: 'linkedin',
      })))
      .select('id, dedupe_key')

    if (error) throw new Error('Could not save recommended contacts for this Account List.')
    for (const row of data ?? []) leadIdByKey.set(row.dedupe_key, row.id)
  }

  const accountRows = entries.map((entry) => {
    const recommendation = entry.account.recommendation
    const lead = recommendation ? recommendedLead(entry.account) : null
    const key = lead ? resolveKey(lead).key : null
    return {
      user_id: userId,
      extraction_job_id: extractionJobId,
      company_id: entry.companyId,
      source_row_index: entry.account.sourceRowIndex,
      source_list: entry.account.sourceList ?? null,
      company_name_snapshot: entry.account.companyName,
      company_sales_navigator_url: entry.account.salesNavUrl,
      industry_snapshot: entry.account.industry,
      connection_paths: entry.account.connectionPaths,
      alert: entry.account.alert,
      recommended_contact_name: recommendation?.fullName ?? null,
      recommended_contact_job_title: recommendation?.jobTitle ?? null,
      recommended_contact_sales_nav_url: recommendation?.salesNavUrl ?? null,
      recommended_contact_member_id: recommendation?.memberId ?? null,
      recommended_contact_connection: recommendation?.connectionDegree ?? null,
      recommended_lead_id: key ? leadIdByKey.get(key) ?? null : null,
    }
  })

  for (let index = 0; index < accountRows.length; index += WRITE_BATCH) {
    const { error } = await supabase
      .from('account_list_entries')
      .upsert(accountRows.slice(index, index + WRITE_BATCH), {
        onConflict: 'extraction_job_id,company_id',
      })
    if (error) throw new Error('Could not save Account List membership.')
  }

  return {
    accountCount: accountRows.length,
    recommendedContactCount: recommendations.length,
    companyIds: [...new Set(entries.map((entry) => entry.companyId))],
    recommendedLeadIds: [...new Set([...leadIdByKey.values()])],
  }
}
