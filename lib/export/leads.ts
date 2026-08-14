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
): Record<(typeof EXPORT_COLUMN_ORDER)[number], string | null> {
  return {
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
>

function legacyGeneratedMemberId(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null
    const match = /^\/in\/(ACw[A-Za-z0-9_-]+)\/?$/i.exec(parsed.pathname)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/** Maps one trusted database row into the only shape adapters may consume. */
export function normalizeExportLead(row: ExportLeadSource): ExportLead {
  const legacyMemberId = legacyGeneratedMemberId(row.linkedin_url)
  return {
    id: row.id,
    name: row.full_name,
    linkedinUrl: legacyMemberId ? null : row.linkedin_url,
    jobTitle: row.job_title,
    companyName: row.company_name,
    companyUrl: row.company_website_url,
    companyLinkedInUrl: row.company_url,
    salesNavigatorUrl: row.sales_navigator_url ?? (legacyMemberId
      ? `https://www.linkedin.com/sales/lead/${legacyMemberId}`
      : null),
    location: row.location,
  }
}

export function normalizeExportLeads(
  rows: readonly ExportLeadSource[],
): ExportLead[] {
  return rows.map(normalizeExportLead)
}
