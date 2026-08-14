import 'server-only'

import { z } from 'zod'

import type { ExportLead } from '@/lib/export/leads'
import type {
  ConnectionTestResult,
  ExportOptions,
  ExportResult,
  LeadExportContext,
  LeadExportProvider,
} from '@/lib/integrations/types'
import { validateSalesforceInstanceUrl } from '@/lib/integrations/salesforce'

const SALESFORCE_API_VERSION = 'v67.0'
const BATCH_SIZE = 25
const REQUEST_TIMEOUT_MS = 20_000

const compositeResponseSchema = z.object({
  compositeResponse: z.array(z.object({
    referenceId: z.string(),
    httpStatusCode: z.number().int(),
    body: z.unknown().optional(),
  })),
})

function splitName(name: string | null): { FirstName?: string; LastName?: string } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return {}
  if (parts.length === 1) return { LastName: parts[0] }
  return { FirstName: parts.slice(0, -1).join(' '), LastName: parts.at(-1) }
}

/** Maps Outlio fields to Salesforce's standard Lead object without custom fields. */
export function toSalesforceLeadFields(lead: ExportLead): Record<string, string> | null {
  const name = splitName(lead.name)
  const company = lead.companyName?.trim()
  if (!name.LastName || !company) return null

  const fields: Record<string, string> = { ...name, Company: company }
  if (lead.jobTitle?.trim()) fields.Title = lead.jobTitle.trim()
  if (lead.companyUrl?.trim()) fields.Website = lead.companyUrl.trim()
  const references = [
    lead.linkedinUrl?.trim() ? `LinkedIn Profile: ${lead.linkedinUrl.trim()}` : null,
    lead.salesNavigatorUrl?.trim()
      ? `Sales Navigator URL: ${lead.salesNavigatorUrl.trim()}`
      : null,
    lead.location?.trim() ? `Location: ${lead.location.trim()}` : null,
  ].filter((value): value is string => Boolean(value))
  if (references.length > 0) fields.Description = references.join('\n')
  return fields
}

type BatchInput = { lead: ExportLead; recordId?: string }

function failureFor(leadId: string, code: string, message: string) {
  return { leadId, code, message }
}

function responseRecordId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('id' in body)) return null
  const id = String(body.id)
  return /^[A-Za-z0-9]{15,18}$/.test(id) ? id : null
}

function salesforceItemFailure(
  leadId: string,
  body: unknown,
  status: number,
): ReturnType<typeof failureFor> {
  const first = Array.isArray(body) ? body[0] : body
  const providerCode = first && typeof first === 'object' && 'errorCode' in first
    ? String(first.errorCode)
    : ''
  const safeMessages: Record<string, string> = {
    DUPLICATES_DETECTED: 'Salesforce duplicate rules prevented this lead from being saved.',
    REQUIRED_FIELD_MISSING: 'Salesforce requires additional information for this lead.',
    FIELD_CUSTOM_VALIDATION_EXCEPTION: 'A Salesforce validation rule rejected this lead.',
    INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY: 'The connected Salesforce user cannot save this lead.',
    INSUFFICIENT_ACCESS_OR_READONLY: 'The connected Salesforce user does not have permission to save leads.',
    INVALID_FIELD: 'A Salesforce Lead field is unavailable in this organization.',
  }
  if (status === 401 || status === 403) {
    return failureFor(
      leadId,
      'SALESFORCE_AUTH_REJECTED',
      'Salesforce authorization was rejected. Reconnect Salesforce.',
    )
  }
  return failureFor(
    leadId,
    providerCode ? `SALESFORCE_${providerCode}` : 'SALESFORCE_LEAD_WRITE_FAILED',
    safeMessages[providerCode] ?? 'Salesforce did not accept this lead.',
  )
}

async function sendCompositeBatch(
  accessToken: string,
  instanceUrl: string,
  inputs: readonly BatchInput[],
): Promise<{
  records: NonNullable<ExportResult['records']>
  failures: NonNullable<ExportResult['failures']>
}> {
  const valid: Array<BatchInput & { fields: Record<string, string>; referenceId: string }> = []
  const failures: NonNullable<ExportResult['failures']> = []
  inputs.forEach((input, index) => {
    const fields = toSalesforceLeadFields(input.lead)
    if (!fields) {
      failures.push(failureFor(
        input.lead.id,
        'SALESFORCE_REQUIRED_FIELDS_MISSING',
        'Salesforce requires a lead name and company.',
      ))
      return
    }
    if (input.recordId && !/^[A-Za-z0-9]{15,18}$/.test(input.recordId)) {
      failures.push(failureFor(
        input.lead.id,
        'SALESFORCE_RECORD_LINK_INVALID',
        'The saved Salesforce lead link is invalid. Reconnect and try again.',
      ))
      return
    }
    valid.push({ ...input, fields, referenceId: `outlioLead${index}` })
  })
  if (valid.length === 0) return { records: [], failures }

  let response: Response
  try {
    response = await fetch(
      `${validateSalesforceInstanceUrl(instanceUrl)}/services/data/${SALESFORCE_API_VERSION}/composite`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allOrNone: false,
          compositeRequest: valid.map(({ recordId, fields, referenceId }) => ({
            method: recordId ? 'PATCH' : 'POST',
            url: `/services/data/${SALESFORCE_API_VERSION}/sobjects/Lead${recordId ? `/${recordId}` : ''}`,
            referenceId,
            body: fields,
          })),
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    )
  } catch {
    return {
      records: [],
      failures: [...failures, ...valid.map(({ lead }) => failureFor(
        lead.id,
        'SALESFORCE_UNAVAILABLE',
        'Salesforce could not be reached. Please try again.',
      ))],
    }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      records: [],
      failures: [...failures, ...valid.map(({ lead }) => failureFor(
        lead.id,
        'SALESFORCE_AUTH_REJECTED',
        'Salesforce authorization was rejected. Reconnect Salesforce.',
      ))],
    }
  }
  if (response.status === 429) {
    return {
      records: [],
      failures: [...failures, ...valid.map(({ lead }) => failureFor(
        lead.id,
        'SALESFORCE_RATE_LIMITED',
        'Salesforce is receiving requests too quickly. Wait and try again.',
      ))],
    }
  }

  const parsed = compositeResponseSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!response.ok || !parsed.success) {
    return {
      records: [],
      failures: [...failures, ...valid.map(({ lead }) => failureFor(
        lead.id,
        'SALESFORCE_LEAD_WRITE_FAILED',
        'Salesforce did not accept this lead.',
      ))],
    }
  }

  const inputByReference = new Map(valid.map((input) => [input.referenceId, input]))
  const records: NonNullable<ExportResult['records']> = []
  const completed = new Set<string>()
  for (const item of parsed.data.compositeResponse) {
    const input = inputByReference.get(item.referenceId)
    if (!input) continue
    if (item.httpStatusCode >= 200 && item.httpStatusCode < 300) {
      const providerRecordId = input.recordId ?? responseRecordId(item.body)
      if (providerRecordId) {
        completed.add(input.lead.id)
        records.push({ leadId: input.lead.id, providerRecordId })
        continue
      }
    }
    failures.push(salesforceItemFailure(input.lead.id, item.body, item.httpStatusCode))
    completed.add(input.lead.id)
  }
  for (const input of valid) {
    if (!completed.has(input.lead.id)) {
      failures.push(failureFor(
        input.lead.id,
        'SALESFORCE_LEAD_WRITE_FAILED',
        'Salesforce did not accept this lead.',
      ))
    }
  }
  return { records, failures }
}

export class SalesforceLeadExportProvider implements LeadExportProvider {
  readonly destination = 'salesforce' as const
  readonly connectionProvider = 'salesforce' as const

  constructor(
    private readonly accessToken: string,
    private readonly instanceUrl: string,
  ) {}

  async testConnection(_context: LeadExportContext): Promise<ConnectionTestResult> {
    try {
      const response = await fetch(
        `${validateSalesforceInstanceUrl(this.instanceUrl)}/services/data/${SALESFORCE_API_VERSION}/limits`,
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      return response.ok
        ? { ok: true }
        : {
            ok: false,
            reconnectRequired: response.status === 401 || response.status === 403,
            message: 'Salesforce connection could not be verified.',
          }
    } catch {
      return { ok: false, reconnectRequired: false, message: 'Salesforce could not be reached.' }
    }
  }

  async exportLeads(
    context: LeadExportContext,
    leads: readonly ExportLead[],
    _options?: ExportOptions,
  ): Promise<ExportResult> {
    const records: NonNullable<ExportResult['records']> = []
    const failures: NonNullable<ExportResult['failures']> = []
    const inputs = leads.map((lead) => ({
      lead,
      recordId: context.existingRecordIds.get(lead.id),
    }))
    for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
      const result = await sendCompositeBatch(
        this.accessToken,
        this.instanceUrl,
        inputs.slice(offset, offset + BATCH_SIZE),
      )
      records.push(...result.records)
      failures.push(...result.failures)
    }
    return {
      successfulCount: records.length,
      failedCount: failures.length,
      records,
      failures,
    }
  }
}
