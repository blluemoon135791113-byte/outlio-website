import { enrichmentCells } from '@/lib/intelligence/merge'
import type { ExtractedLeadRow } from '@/types/database'

/**
 * Provider-neutral lead shape.
 *
 * These seven values are the canonical export contract for every destination.
 */
export type ExportLead = {
  id: string
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
}

export const EXPORT_COLUMN_HEADERS = {
  name: 'Name',
  linkedinProfile: 'LinkedIn Profile',
  jobTitle: 'Job Title',
  company: 'Company',
  companyLinkedInUrl: 'Company LinkedIn URL',
  companyUrl: 'Company Website URL',
  location: 'Location',
  salesNavigatorUrl: 'Sales Navigator URL',
} as const

export const EXPORT_COLUMN_ORDER = [
  EXPORT_COLUMN_HEADERS.name,
  EXPORT_COLUMN_HEADERS.linkedinProfile,
  EXPORT_COLUMN_HEADERS.jobTitle,
  EXPORT_COLUMN_HEADERS.company,
  EXPORT_COLUMN_HEADERS.companyLinkedInUrl,
  EXPORT_COLUMN_HEADERS.companyUrl,
  EXPORT_COLUMN_HEADERS.location,
  EXPORT_COLUMN_HEADERS.salesNavigatorUrl,
] as const

export function toCanonicalExportRecord(
  lead: ExportLead,
): Record<string, string | null> {
  return {
    // Merged columns first in the literal, so a research field that somehow
    // collided with a core header could never overwrite one.
    ...(lead.enrichment ?? {}),
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
> & { enrichment?: unknown }

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
