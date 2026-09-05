import { enrichmentCells } from '@/lib/intelligence/merge'
import type { ExtractedLeadRow } from '@/types/database'

/**
 * Provider-neutral lead shape.
 *
 * These seven values are the canonical export contract for every destination.
 */
export type ExportLead = {
  id: string
  /** `account` means one company row with an optional recommended contact. */
  recordType?: 'lead' | 'account'
  name: string | null
  linkedinUrl: string | null
  jobTitle: string | null
  companyName: string | null
  /** External company website. */
  companyUrl: string | null
  /** LinkedIn Sales Navigator company page. */
  companyLinkedInUrl?: string | null
  salesNavigatorUrl: string | null
  location: string | null
  workEmail?: string | null
  emailStatus?: string | null
  mobilePhone?: string | null
  phoneStatus?: string | null
  companyContactEmail?: string | null
  companyContactEmailStatus?: string | null
  companyContactPhone?: string | null
  companyContactPhoneStatus?: string | null
  /*
   * Intelligence values the user merged onto this lead, already flattened to
   * strings and keyed by their column header.
   *
   * ⚠️ SEPARATE FROM THE CORE EIGHT, DELIBERATELY. The fields above are the
   * contract every destination has always received; a customer's CRM field
   * mapping is built on their names and their order. Merged data is additive
   * and appended, so an account that never enriches anything exports exactly
   * the file it exported before this existed.
   */
  enrichment?: Record<string, string>

  /* ---- also on the saved page --------------------------------------------- */
  companyIndustry?: string | null
  companySize?: string | null
  companyPublicLinkedIn?: string | null
  companyEmployeeCount?: number | null
  companyDecisionMakers?: number | null
  companyInvestors?: number | null
  leadSource?: string | null
  connectionDegree?: string | null
  reachable?: string | null
  listCount?: number | null
  lastActivity?: string | null
  addedToList?: string | null

  /** Which Sales Navigator list or search the lead came from. */
  sourceList?: string | null
}

export const EXPORT_COLUMN_HEADERS = {
  name: 'Name',
  linkedinProfile: 'LinkedIn Profile',
  jobTitle: 'Job Title',
  company: 'Company',
  // ⚠️ EXPLICIT BY REQUEST: this is the SALES NAVIGATOR company page, not the
  // public linkedin.com/company one — two identifiers users kept conflating.
  companyLinkedInUrl: 'Company Sales Navigator URL',
  companyUrl: 'Company Website URL',
  location: 'Location',
  salesNavigatorUrl: 'Sales Navigator URL',

  /* Appended after the original eight — see the note in process-job.ts. */
  companyIndustry: 'Company Industry',
  companySize: 'Company Size',
  /** `linkedin.com/company/<slug>` — the public page, not the Sales Nav one. */
  companyPublicLinkedIn: 'Company LinkedIn Profile (public)',
  /** An exact number from the company page, unlike the "2-10" range. */
  companyEmployeeCount: 'Company Employees',
  companyDecisionMakers: 'Decision Makers',
  companyInvestors: 'Investors',
  /** How this row entered the database: a search row, or a company page. */
  leadSource: 'Lead Source',
  connectionDegree: 'Connection Degree',
  reachable: 'Reachable',
  listCount: 'Saved Lists',
  lastActivity: 'Last Activity',
  addedToList: 'Added To List',

  /** Which Sales Navigator list or search the lead came from. */
  sourceList: 'Source List',
  workEmail: 'Work Email',
  emailStatus: 'Email Status',
  mobilePhone: 'Mobile Phone',
  phoneStatus: 'Phone Status',
  companyContactEmail: 'Company Email',
  companyContactEmailStatus: 'Company Email Status',
  companyContactPhone: 'Company Phone',
  companyContactPhoneStatus: 'Company Phone Status',
  recordType: 'Record Type',
} as const

/**
 * ⚠️ THE FIRST EIGHT ARE FROZEN.
 *
 * Every destination and every customer field-mapping is built on these names in
 * this order. New columns are APPENDED; inserting one among them would shift a
 * customer's import without any error to notice.
 */
export const EXPORT_COLUMN_ORDER = [
  /*
   * ⚠️ THE TWO PERSON URLS SIT TOGETHER, and the two company URLs after them.
   * They were columns B and H, so reading one lead's two links meant scrolling
   * past six unrelated fields. Related values belong beside each other.
   *
   * `Company HQ` is gone: it duplicated `Location` on almost every row and
   * carried nothing the location column did not already say.
   */
  EXPORT_COLUMN_HEADERS.name,
  EXPORT_COLUMN_HEADERS.linkedinProfile,
  EXPORT_COLUMN_HEADERS.salesNavigatorUrl,
  EXPORT_COLUMN_HEADERS.jobTitle,
  EXPORT_COLUMN_HEADERS.location,

  EXPORT_COLUMN_HEADERS.company,
  EXPORT_COLUMN_HEADERS.companyLinkedInUrl,
  EXPORT_COLUMN_HEADERS.companyPublicLinkedIn,
  EXPORT_COLUMN_HEADERS.companyUrl,
  EXPORT_COLUMN_HEADERS.companyIndustry,
  EXPORT_COLUMN_HEADERS.companySize,
  EXPORT_COLUMN_HEADERS.companyEmployeeCount,
  EXPORT_COLUMN_HEADERS.companyDecisionMakers,
  EXPORT_COLUMN_HEADERS.companyInvestors,
  EXPORT_COLUMN_HEADERS.companyContactEmail,
  EXPORT_COLUMN_HEADERS.companyContactEmailStatus,
  EXPORT_COLUMN_HEADERS.companyContactPhone,
  EXPORT_COLUMN_HEADERS.companyContactPhoneStatus,

  EXPORT_COLUMN_HEADERS.workEmail,
  EXPORT_COLUMN_HEADERS.emailStatus,
  EXPORT_COLUMN_HEADERS.mobilePhone,
  EXPORT_COLUMN_HEADERS.phoneStatus,

  EXPORT_COLUMN_HEADERS.connectionDegree,
  EXPORT_COLUMN_HEADERS.reachable,
  EXPORT_COLUMN_HEADERS.listCount,
  EXPORT_COLUMN_HEADERS.lastActivity,
  EXPORT_COLUMN_HEADERS.leadSource,
  EXPORT_COLUMN_HEADERS.sourceList,
  EXPORT_COLUMN_HEADERS.recordType,
] as const

/**
 * The value written when a field has no data.
 *
 * ⚠️ AN EMPTY CELL IS AMBIGUOUS. It reads as "this person has no job title" as
 * easily as "we could not find one", and a spreadsheet gives no way to tell.
 * `N/A` says a value was looked for and is not available — which is the honest
 * claim, and the one CLAUDE.md rule 4 requires instead of a guess.
 */
export const NOT_AVAILABLE = 'N/A'

/**
 * Columns that appear in every export, however sparse the batch.
 *
 * ⚠️ THE STABLE SPINE OF THE FILE. Everything else is dropped when no row has a
 * value, so a sheet never shows a column of pure N/A — which reads as the
 * extractor having failed rather than the field simply not being on the page.
 *
 * These stay because a CRM import mapping has to be buildable against
 * something: a file whose every column came and went would be unmappable.
 */
export const ALWAYS_EXPORTED: readonly string[] = [
  EXPORT_COLUMN_HEADERS.name,
  EXPORT_COLUMN_HEADERS.linkedinProfile,
  EXPORT_COLUMN_HEADERS.salesNavigatorUrl,
  EXPORT_COLUMN_HEADERS.jobTitle,
  EXPORT_COLUMN_HEADERS.location,
  EXPORT_COLUMN_HEADERS.company,
  EXPORT_COLUMN_HEADERS.companyLinkedInUrl,
  EXPORT_COLUMN_HEADERS.companyPublicLinkedIn,
]

export function toCanonicalExportRecord(
  lead: ExportLead,
): Record<string, string | null> {
  return {
    // Merged columns first in the literal, so a research field that somehow
    // collided with a core header could never overwrite one.
    ...(lead.enrichment ?? {}),
    [EXPORT_COLUMN_HEADERS.companyIndustry]: lead.companyIndustry ?? null,
    [EXPORT_COLUMN_HEADERS.companySize]: lead.companySize ?? null,
    [EXPORT_COLUMN_HEADERS.companyPublicLinkedIn]: lead.companyPublicLinkedIn ?? null,
    [EXPORT_COLUMN_HEADERS.companyEmployeeCount]:
      lead.companyEmployeeCount === null || lead.companyEmployeeCount === undefined
        ? null
        : String(lead.companyEmployeeCount),
    [EXPORT_COLUMN_HEADERS.companyDecisionMakers]:
      lead.companyDecisionMakers === null || lead.companyDecisionMakers === undefined
        ? null
        : String(lead.companyDecisionMakers),
    [EXPORT_COLUMN_HEADERS.companyInvestors]:
      lead.companyInvestors === null || lead.companyInvestors === undefined
        ? null
        : String(lead.companyInvestors),
    [EXPORT_COLUMN_HEADERS.leadSource]: lead.leadSource ?? null,
    [EXPORT_COLUMN_HEADERS.connectionDegree]: lead.connectionDegree ?? null,
    [EXPORT_COLUMN_HEADERS.reachable]: lead.reachable ?? null,
    [EXPORT_COLUMN_HEADERS.listCount]:
      lead.listCount === null || lead.listCount === undefined ? null : String(lead.listCount),
    [EXPORT_COLUMN_HEADERS.lastActivity]: lead.lastActivity ?? null,
    [EXPORT_COLUMN_HEADERS.sourceList]: lead.sourceList ?? null,
    [EXPORT_COLUMN_HEADERS.workEmail]: lead.workEmail ?? null,
    [EXPORT_COLUMN_HEADERS.emailStatus]: lead.emailStatus ?? null,
    [EXPORT_COLUMN_HEADERS.mobilePhone]: lead.mobilePhone ?? null,
    [EXPORT_COLUMN_HEADERS.phoneStatus]: lead.phoneStatus ?? null,
    [EXPORT_COLUMN_HEADERS.companyContactEmail]: lead.companyContactEmail ?? null,
    [EXPORT_COLUMN_HEADERS.companyContactEmailStatus]: lead.companyContactEmailStatus ?? null,
    [EXPORT_COLUMN_HEADERS.companyContactPhone]: lead.companyContactPhone ?? null,
    [EXPORT_COLUMN_HEADERS.companyContactPhoneStatus]: lead.companyContactPhoneStatus ?? null,
    [EXPORT_COLUMN_HEADERS.recordType]: lead.recordType === 'account' ? 'Account' : 'Lead',
    [EXPORT_COLUMN_HEADERS.name]: lead.name,
    [EXPORT_COLUMN_HEADERS.linkedinProfile]: lead.linkedinUrl,
    [EXPORT_COLUMN_HEADERS.jobTitle]: lead.jobTitle,
    [EXPORT_COLUMN_HEADERS.company]: lead.companyName,
    [EXPORT_COLUMN_HEADERS.companyLinkedInUrl]: lead.companyLinkedInUrl ?? null,
    [EXPORT_COLUMN_HEADERS.companyUrl]: lead.companyUrl,
    [EXPORT_COLUMN_HEADERS.location]: lead.location,
    [EXPORT_COLUMN_HEADERS.salesNavigatorUrl]: lead.salesNavigatorUrl,
  }
}

export type ExportLeadSource = Pick<
  ExtractedLeadRow,
  | 'id'
  | 'full_name'
  | 'linkedin_url'
  | 'sales_navigator_url'
  | 'job_title'
  | 'company_name'
  | 'company_url'
  | 'company_website_url'
  | 'location'
> &
  /*
   * Optional so a caller that predates migration 0052 — or a test constructing
   * a minimal row — still type-checks. Every one reads as absent, which is the
   * same as the column being NULL.
   */
  Partial<
    Pick<
      ExtractedLeadRow,
      | 'company_industry'
      | 'company_size'
      | 'company_public_linkedin_url'
      | 'company_employee_count'
      | 'company_decision_maker_count'
      | 'company_investor_count'
      | 'lead_source'
      | 'connection_degree'
      | 'is_reachable'
      | 'list_count'
      | 'last_activity'
      | 'added_to_list_at'
      | 'source_list'
      | 'work_email'
      | 'email_status'
      | 'mobile_phone'
      | 'phone_status'
    >
  > & { enrichment?: unknown }

/** Drops keys whose value is null or undefined. */
function definedOnly<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined) out[key as keyof T] = value as T[keyof T]
  }
  return out
}

/** Maps one trusted database row into the only shape adapters may consume. */
export function normalizeExportLead(row: ExportLeadSource): ExportLead {
  const cells = enrichmentCells(row.enrichment)

  return {
    id: row.id,
    name: row.full_name,
    linkedinUrl: row.linkedin_url,
    jobTitle: row.job_title,
    companyName: row.company_name,
    companyUrl: row.company_website_url,
    companyLinkedInUrl: row.company_url,
    salesNavigatorUrl: row.sales_navigator_url,
    location: row.location,
    /*
     * Omitted entirely when there is none, so a lead nobody enriched produces
     * exactly the object this function produced before merging existed. That
     * is the contract holding, not a formality: `tests/unit/export-leads.test.ts`
     * asserts the whole shape, and it still passes untouched.
     */
    ...(Object.keys(cells).length > 0 ? { enrichment: cells } : {}),

    /*
     * ⚠️ OMITTED WHEN ABSENT, like `enrichment` above. A lead captured without
     * the hovercard pass and never contact-enriched produces exactly the object
     * this function produced before migration 0052 — which is why
     * `tests/unit/export-leads.test.ts` still asserts the whole shape and still
     * passes untouched. The CSV writer fills a missing key with an empty cell,
     * so the file stays rectangular either way.
     */
    ...definedOnly({
      companyIndustry: row.company_industry,
      companySize: row.company_size,
      companyPublicLinkedIn: row.company_public_linkedin_url,
      companyEmployeeCount: row.company_employee_count,
      companyDecisionMakers: row.company_decision_maker_count,
      companyInvestors: row.company_investor_count,
      leadSource: row.lead_source,
      connectionDegree: row.connection_degree,
      // `null` means the badge was absent, which is not the same as "no".
      reachable: row.is_reachable === true ? 'Yes' : null,
      listCount: row.list_count,
      lastActivity: row.last_activity,
      addedToList: row.added_to_list_at,
      sourceList: row.source_list,
      workEmail: row.work_email,
      emailStatus: row.email_status,
      mobilePhone: row.mobile_phone,
      phoneStatus: row.phone_status,
    }),
  }
}

/**
 * The merged columns present across a batch, in a stable order.
 *
 * A row missing a column that another row has gets an empty cell, so every row
 * in one export has the same width — a ragged CSV is not a CSV.
 */
export function enrichmentHeaders(leads: readonly ExportLead[]): string[] {
  const headers = new Set<string>()
  for (const lead of leads) {
    for (const header of Object.keys(lead.enrichment ?? {})) headers.add(header)
  }
  return [...headers].sort()
}

export function normalizeExportLeads(
  rows: readonly ExportLeadSource[],
): ExportLead[] {
  return rows.map(normalizeExportLead)
}
