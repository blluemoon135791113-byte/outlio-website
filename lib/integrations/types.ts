import type { ExportLead } from '@/lib/export/leads'
import type { IntegrationConnectionStatus, Json } from '@/types/database'

export const INTEGRATION_PROVIDERS = [
  'google',
  'clay',
  'ghl',
  'microsoft',
  'dropbox',
] as const

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export const EXPORT_DESTINATIONS = [
  'csv',
  'google_sheets',
  'google_drive',
  'clay',
  'ghl',
  'onedrive',
  'dropbox',
] as const

export type ExportDestination = (typeof EXPORT_DESTINATIONS)[number]

export type IntegrationConnectionMetadata = {
  id: string
  provider: IntegrationProvider
  status: IntegrationConnectionStatus
  externalAccountName: string | null
  externalAccountEmail: string | null
  scopes: string[]
  connectedAt: string | null
  lastUsedAt: string | null
  lastTestedAt: string | null
  lastError: string | null
}

export type ConnectionTestResult =
  | { ok: true; accountName?: string | null; accountEmail?: string | null }
  | { ok: false; reconnectRequired: boolean; message: string }

export type ExportOptions = {
  name?: string
  fieldMapping?: Record<string, string>
  providerOptions?: Record<string, Json>
}

export type ExportItemFailure = {
  /** Lead id for lead exports; Account List entry id for account exports. */
  sourceId: string
  code: string
  /** Safe for an end user. Raw provider responses are never stored here. */
  message: string
}

export type ExportedRecord = {
  sourceId: string
  providerRecordId: string
}

export type ExportResult = {
  successfulCount: number
  failedCount: number
  destinationId?: string
  destinationUrl?: string
  records?: ExportedRecord[]
  failures?: ExportItemFailure[]
}

export type LeadExportContext = {
  userId: string
  connectionId: string | null
  existingRecordIds: ReadonlyMap<string, string>
}

/**
 * Contract implemented by every destination adapter in its provider phase.
 * Adapters receive only normalized leads and never browser-supplied records.
 */
export interface LeadExportProvider {
  readonly destination: ExportDestination
  readonly connectionProvider: IntegrationProvider | null
  testConnection(context: LeadExportContext): Promise<ConnectionTestResult>
  exportLeads(
    context: LeadExportContext,
    leads: readonly ExportLead[],
    options?: ExportOptions,
  ): Promise<ExportResult>
}

/** Plaintext shape only inside server-only encryption/repository modules. */
export type IntegrationCredentialEnvelope = {
  accessToken?: string
  refreshToken?: string
  tokenType?: string
  instanceUrl?: string
  clayWebhookUrl?: string
  clayAuthenticationToken?: string
  ghlPrivateIntegrationToken?: string
  ghlLocationId?: string
}
