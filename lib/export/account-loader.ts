import 'server-only'

import { normalizeExportAccount } from '@/lib/export/accounts'
import type { ExportLead } from '@/lib/export/leads'
import { enrichmentCells } from '@/lib/intelligence/merge'
import { createAdminClient } from '@/lib/supabase/admin'

const PAGE = 500
const QUERY_BATCH = 100

type EntryRow = {
  id: string
  company_id: string
  company_name_snapshot: string
  company_sales_navigator_url: string
  source_list: string | null
  industry_snapshot: string | null
  connection_paths: string | null
  alert: string | null
  recommended_contact_name: string | null
  recommended_contact_job_title: string | null
  recommended_contact_sales_nav_url: string | null
  recommended_contact_member_id: string | null
  recommended_contact_connection: string | null
  recommended_lead_id: string | null
}

type CompanyRow = {
  id: string
  name: string | null
  normalized_domain: string | null
  linkedin_url: string | null
  public_linkedin_url: string | null
  industry: string | null
  employee_count: number | null
  employee_count_exact: number | null
  headquarters: string | null
  contact_email: string | null
  contact_email_status: string | null
  contact_phone: string | null
  contact_phone_status: string | null
}

type LeadRow = {
  id: string
  full_name: string | null
  linkedin_url: string | null
  sales_navigator_url: string | null
  job_title: string | null
  connection_degree: string | null
  work_email: string | null
  email_status: string | null
  mobile_phone: string | null
  phone_status: string | null
  enrichment: unknown
}

/** Loads a trusted Account List run into provider-neutral export records. */
export async function loadAccountExportRecords(
  userId: string,
  extractionJobId: string,
): Promise<ExportLead[]> {
  if (!userId) throw new Error('loadAccountExportRecords: userId is required')
  const supabase = createAdminClient()
  const entries: EntryRow[] = []

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('account_list_entries')
      .select('id, company_id, company_name_snapshot, company_sales_navigator_url, source_list, industry_snapshot, connection_paths, alert, recommended_contact_name, recommended_contact_job_title, recommended_contact_sales_nav_url, recommended_contact_member_id, recommended_contact_connection, recommended_lead_id')
      .eq('user_id', userId)
      .eq('extraction_job_id', extractionJobId)
      .order('source_row_index', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error('EXPORT_ACCOUNTS_UNAVAILABLE')
    const rows = (data ?? []) as EntryRow[]
    entries.push(...rows)
    if (rows.length < PAGE) break
  }

  if (entries.length === 0) throw new Error('EXPORT_SOURCE_NOT_FOUND')

  const companies = new Map<string, CompanyRow>()
  const companyIds = [...new Set(entries.map((entry) => entry.company_id))]
  for (let index = 0; index < companyIds.length; index += QUERY_BATCH) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, name, normalized_domain, linkedin_url, public_linkedin_url, industry, employee_count, employee_count_exact, headquarters, contact_email, contact_email_status, contact_phone, contact_phone_status')
      .eq('user_id', userId)
      .in('id', companyIds.slice(index, index + QUERY_BATCH))
    if (error) throw new Error('EXPORT_ACCOUNTS_UNAVAILABLE')
    for (const row of (data ?? []) as CompanyRow[]) companies.set(row.id, row)
  }

  const leads = new Map<string, LeadRow>()
  const leadIds = [...new Set(entries.flatMap((entry) => entry.recommended_lead_id ? [entry.recommended_lead_id] : []))]
  for (let index = 0; index < leadIds.length; index += QUERY_BATCH) {
    const { data, error } = await supabase
      .from('extracted_leads')
      .select('id, full_name, linkedin_url, sales_navigator_url, job_title, connection_degree, work_email, email_status, mobile_phone, phone_status, enrichment')
      .eq('user_id', userId)
      .in('id', leadIds.slice(index, index + QUERY_BATCH))
    if (error) throw new Error('EXPORT_ACCOUNTS_UNAVAILABLE')
    for (const row of (data ?? []) as LeadRow[]) leads.set(row.id, row)
  }

  return entries.map((entry) => {
    const company = companies.get(entry.company_id)
    const lead = entry.recommended_lead_id ? leads.get(entry.recommended_lead_id) : null
    return normalizeExportAccount({
      id: entry.id,
      companyId: entry.company_id,
      companyName: company?.name ?? entry.company_name_snapshot,
      companySalesNavigatorUrl: entry.company_sales_navigator_url,
      sourceList: entry.source_list,
      industry: company?.industry ?? entry.industry_snapshot,
      connectionPaths: entry.connection_paths,
      alert: entry.alert,
      recommendedName: lead?.full_name ?? entry.recommended_contact_name,
      recommendedJobTitle: lead?.job_title ?? entry.recommended_contact_job_title,
      recommendedLinkedInUrl: lead?.linkedin_url ?? (entry.recommended_contact_member_id
        ? `https://www.linkedin.com/in/${entry.recommended_contact_member_id}`
        : null),
      recommendedSalesNavigatorUrl: lead?.sales_navigator_url ?? entry.recommended_contact_sales_nav_url,
      recommendedConnectionDegree: lead?.connection_degree ?? entry.recommended_contact_connection,
      companyDomain: company?.normalized_domain ?? null,
      companyPublicLinkedInUrl: company?.public_linkedin_url ?? null,
      companyEmployeeCount: company?.employee_count_exact ?? company?.employee_count ?? null,
      companyHeadquarters: company?.headquarters ?? null,
      companyContactEmail: company?.contact_email ?? null,
      companyContactEmailStatus: company?.contact_email_status ?? null,
      companyContactPhone: company?.contact_phone ?? null,
      companyContactPhoneStatus: company?.contact_phone_status ?? null,
      workEmail: lead?.work_email ?? null,
      emailStatus: lead?.email_status ?? null,
      mobilePhone: lead?.mobile_phone ?? null,
      phoneStatus: lead?.phone_status ?? null,
      enrichment: lead ? enrichmentCells(lead.enrichment) : undefined,
    })
  })
}
