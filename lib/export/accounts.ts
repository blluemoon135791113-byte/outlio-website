/**
 * Canonical Account List export mapping.
 *
 * Account and lead destinations now share one stable column contract. An
 * Account List row carries a company plus an optional recommended contact; a
 * missing recommendation stays empty and is never replaced with a guessed
 * person.
 */
import type { ParsedAccount } from '@/lib/companies/parse-account-list'
import {
  EXPORT_COLUMN_HEADERS,
  EXPORT_COLUMN_ORDER,
  enrichmentHeaders,
  toCanonicalExportRecord,
  type ExportLead,
} from '@/lib/export/leads'
import { toCsv, type CsvColumn } from '@/lib/export/sanitize'

export const ALWAYS_EXPORTED_ACCOUNT_COLUMNS = [
  EXPORT_COLUMN_HEADERS.company,
  EXPORT_COLUMN_HEADERS.companyLinkedInUrl,
  EXPORT_COLUMN_HEADERS.recordType,
  EXPORT_COLUMN_HEADERS.name,
  EXPORT_COLUMN_HEADERS.salesNavigatorUrl,
  EXPORT_COLUMN_HEADERS.jobTitle,
] as const

export type AccountExportSource = {
  id: string
  companyId: string
  companyName: string
  companySalesNavigatorUrl: string
  sourceList: string | null
  industry: string | null
  connectionPaths: string | null
  alert: string | null
  recommendedName: string | null
  recommendedJobTitle: string | null
  recommendedLinkedInUrl: string | null
  recommendedSalesNavigatorUrl: string | null
  recommendedConnectionDegree: string | null
  companyDomain: string | null
  companyPublicLinkedInUrl: string | null
  companyEmployeeCount: number | null
  companyHeadquarters: string | null
  companyContactEmail: string | null
  companyContactEmailStatus: string | null
  companyContactPhone: string | null
  companyContactPhoneStatus: string | null
  workEmail: string | null
  emailStatus: string | null
  mobilePhone: string | null
  phoneStatus: string | null
  enrichment?: Record<string, string>
}

/** Maps trusted stored rows into the same provider-neutral record as a lead. */
export function normalizeExportAccount(source: AccountExportSource): ExportLead {
  const enrichment = {
    ...(source.enrichment ?? {}),
    ...(source.connectionPaths ? { 'Connection Paths': source.connectionPaths } : {}),
    ...(source.alert ? { Alert: source.alert } : {}),
  }

  return {
    id: source.id,
    recordType: 'account',
    name: source.recommendedName,
    linkedinUrl: source.recommendedLinkedInUrl,
    salesNavigatorUrl: source.recommendedSalesNavigatorUrl,
    jobTitle: source.recommendedJobTitle,
    location: source.companyHeadquarters,
    companyName: source.companyName,
    companyLinkedInUrl: source.companySalesNavigatorUrl,
    companyPublicLinkedIn: source.companyPublicLinkedInUrl,
    companyUrl: source.companyDomain ? `https://${source.companyDomain}` : null,
    companyIndustry: source.industry,
    companyEmployeeCount: source.companyEmployeeCount,
    companyContactEmail: source.companyContactEmail,
    companyContactEmailStatus: source.companyContactEmailStatus,
    companyContactPhone: source.companyContactPhone,
    companyContactPhoneStatus: source.companyContactPhoneStatus,
    workEmail: source.workEmail,
    emailStatus: source.emailStatus,
    mobilePhone: source.mobilePhone,
    phoneStatus: source.phoneStatus,
    connectionDegree: source.recommendedConnectionDegree,
    leadSource: source.recommendedName ? 'Recommended decision maker' : 'Company only',
    sourceList: source.sourceList,
    ...(Object.keys(enrichment).length > 0 ? { enrichment } : {}),
  }
}

function parsedAccount(account: ParsedAccount, index: number): ExportLead {
  const recommendation = account.recommendation
  return normalizeExportAccount({
    id: `captured-account-${index}`,
    companyId: account.companyId,
    companyName: account.companyName,
    companySalesNavigatorUrl: account.salesNavUrl,
    sourceList: account.sourceList ?? null,
    industry: account.industry,
    connectionPaths: account.connectionPaths,
    alert: account.alert,
    recommendedName: recommendation?.fullName ?? null,
    recommendedJobTitle: recommendation?.jobTitle ?? null,
    recommendedLinkedInUrl: recommendation
      ? `https://www.linkedin.com/in/${recommendation.memberId}`
      : null,
    recommendedSalesNavigatorUrl: recommendation?.salesNavUrl ?? null,
    recommendedConnectionDegree: recommendation?.connectionDegree ?? null,
    companyDomain: null,
    companyPublicLinkedInUrl: null,
    companyEmployeeCount: null,
    companyHeadquarters: null,
    companyContactEmail: null,
    companyContactEmailStatus: null,
    companyContactPhone: null,
    companyContactPhoneStatus: null,
    workEmail: null,
    emailStatus: null,
    mobilePhone: null,
    phoneStatus: null,
  })
}

/** Serialises normalized Account List rows using the canonical export schema. */
export function buildAccountRecordCsv(accounts: readonly ExportLead[]): string {
  const records = accounts.map(toCanonicalExportRecord)
  const columns = [...EXPORT_COLUMN_ORDER, ...enrichmentHeaders(accounts)].map((header) => ({
    header,
    value: (row: Record<string, string | null>) => row[header] ?? null,
  })) satisfies CsvColumn<Record<string, string | null>>[]

  return toCsv(records, columns, { alwaysKeep: ALWAYS_EXPORTED_ACCOUNT_COLUMNS })
}

/** Serialises freshly parsed accounts before background enrichment completes. */
export function buildAccountCsv(accounts: readonly ParsedAccount[]): string {
  return buildAccountRecordCsv(accounts.map(parsedAccount))
}
