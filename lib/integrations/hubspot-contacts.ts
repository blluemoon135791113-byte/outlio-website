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

const HUBSPOT_CONTACTS_URL = 'https://api.hubapi.com/crm/objects/2026-03/contacts'
const HUBSPOT_ACCOUNT_URL = 'https://api.hubapi.com/account-info/2026-03/details'
const HUBSPOT_PROPERTIES_URL = 'https://api.hubapi.com/crm/properties/2026-03/contacts'
const BATCH_SIZE = 100
const REQUEST_TIMEOUT_MS = 20_000

const OUTLIO_CONTACT_PROPERTIES = [
  ['outlio_lead_url', 'Outlio Lead URL', 'Exact public LinkedIn profile when available; otherwise the exact Sales Navigator lead URL.'],
  ['outlio_job_title', 'Outlio Job Title', 'Job title exported from Outlio.'],
  ['outlio_company', 'Outlio Company', 'Company name exported from Outlio.'],
  ['outlio_company_linkedin_url', 'Outlio Company LinkedIn URL', 'LinkedIn Sales Navigator company-page URL exported from Outlio.'],
  ['outlio_company_website_url', 'Outlio Company Website URL', 'External company website URL exported from Outlio.'],
  ['outlio_location', 'Outlio Location', 'Raw lead location exported from Outlio.'],
  ['outlio_sales_navigator_url', 'Outlio Sales Navigator URL', 'Exact Sales Navigator lead URL exported from Outlio.'],
] as const

async function ensureOutlioContactProperties(
  accessToken: string,
): Promise<'ok' | 'auth_rejected' | 'schema_scope_required' | 'unavailable'> {
  for (const [name, label, description] of OUTLIO_CONTACT_PROPERTIES) {
    let response: Response
    try {
      response = await fetch(HUBSPOT_PROPERTIES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          groupName: 'contactinformation',
          name,
          label,
          description,
          type: 'string',
          fieldType: 'text',
          hidden: false,
          formField: false,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      return 'unavailable'
    }
    // 409 means this stable property was already created for this portal.
    if (response.status === 401) return 'auth_rejected'
    if (response.status === 403) return 'schema_scope_required'
    if (!response.ok && response.status !== 409) return 'unavailable'
  }
  return 'ok'
}

const batchResponseSchema = z.object({
  results: z.array(z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    objectWriteTraceId: z.string().optional(),
  })).default([]),
})

function setProperty(
  properties: Record<string, string>,
  name: string,
  value: string | null,
): void {
  const normalized = value?.trim()
  if (normalized) properties[name] = normalized
}

function splitContactName(name: string | null): { firstname?: string; lastname?: string } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstname: parts[0] }
  return {
    firstname: parts.slice(0, -1).join(' '),
    lastname: parts.at(-1),
  }
}

/** Maps Outlio's canonical seven export fields to writable contact fields. */
export function toHubSpotContactProperties(lead: ExportLead): Record<string, string> {
  const properties: Record<string, string> = {}
  const name = splitContactName(lead.name)
  if (name.firstname) properties.firstname = name.firstname
  if (name.lastname) properties.lastname = name.lastname
  // HubSpot's special LinkedIn property turns Sales Navigator links into a
  // generic linkedin.com link. Only populate it with a verified public URL.
  setProperty(properties, 'hs_linkedin_url', lead.linkedinUrl)
  setProperty(properties, 'jobtitle', lead.jobTitle)
  setProperty(properties, 'company', lead.companyName)
  setProperty(properties, 'website', lead.companyUrl)
  setProperty(properties, 'outlio_lead_url', lead.linkedinUrl ?? lead.salesNavigatorUrl)
  setProperty(properties, 'outlio_job_title', lead.jobTitle)
  setProperty(properties, 'outlio_company', lead.companyName)
  setProperty(properties, 'outlio_company_linkedin_url', lead.companyLinkedInUrl ?? null)
  setProperty(properties, 'outlio_company_website_url', lead.companyUrl)
  setProperty(properties, 'outlio_location', lead.location)
  setProperty(properties, 'outlio_sales_navigator_url', lead.salesNavigatorUrl)
  const notes = [
    lead.location?.trim() ? `Location: ${lead.location.trim()}` : null,
    lead.salesNavigatorUrl?.trim()
      ? `Sales Navigator URL: ${lead.salesNavigatorUrl.trim()}`
      : null,
    lead.companyLinkedInUrl?.trim()
      ? `Company LinkedIn URL: ${lead.companyLinkedInUrl.trim()}`
      : null,
  ].filter((value): value is string => Boolean(value))
  if (notes.length > 0) properties.message = notes.join('\n')
  return properties
}

type BatchInput = {
  lead: ExportLead
  recordId?: string
}

type BatchResult = {
  records: NonNullable<ExportResult['records']>
  failures: NonNullable<ExportResult['failures']>
}

function failureFor(leadId: string, code: string, message: string) {
  return { leadId, code, message }
}

async function sendBatch(
  accessToken: string,
  operation: 'create' | 'update',
  inputs: readonly BatchInput[],
): Promise<BatchResult> {
  let response: Response
  try {
    response = await fetch(`${HUBSPOT_CONTACTS_URL}/batch/${operation}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-HubSpot-Batch-Input-Multi-Status': 'true',
      },
      body: JSON.stringify({
        inputs: inputs.map(({ lead, recordId }) => ({
          ...(recordId ? { id: recordId } : {}),
          objectWriteTraceId: lead.id,
          properties: toHubSpotContactProperties(lead),
        })),
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return {
      records: [],
      failures: inputs.map(({ lead }) => failureFor(
        lead.id,
        'HUBSPOT_UNAVAILABLE',
        'HubSpot could not be reached. Please try again.',
      )),
    }
  }

  if (response.status === 401 || response.status === 403) {
    return {
      records: [],
      failures: inputs.map(({ lead }) => failureFor(
        lead.id,
        'HUBSPOT_AUTH_REJECTED',
        'HubSpot authorization was rejected. Reconnect HubSpot.',
      )),
    }
  }

  if (response.status === 429) {
    return {
      records: [],
      failures: inputs.map(({ lead }) => failureFor(
        lead.id,
        'HUBSPOT_RATE_LIMITED',
        'HubSpot is receiving requests too quickly. Wait and try again.',
      )),
    }
  }

  const body: unknown = await response.json().catch(() => null)
  const parsed = batchResponseSchema.safeParse(body)
  if (!response.ok && response.status !== 207) {
    return {
      records: [],
      failures: inputs.map(({ lead }) => failureFor(
        lead.id,
        'HUBSPOT_CONTACT_WRITE_FAILED',
        'HubSpot did not accept this contact.',
      )),
    }
  }

  if (!parsed.success) {
    return {
      records: [],
      failures: inputs.map(({ lead }) => failureFor(
        lead.id,
        'HUBSPOT_RESPONSE_INVALID',
        'HubSpot returned an invalid contact response.',
      )),
    }
  }

  const inputByTrace = new Map(inputs.map((input) => [input.lead.id, input]))
  const records: BatchResult['records'] = []
  const completedLeadIds = new Set<string>()

  parsed.data.results.forEach((result, index) => {
    const fallbackInput = inputs[index]
    const input = result.objectWriteTraceId
      ? inputByTrace.get(result.objectWriteTraceId)
      : fallbackInput
    if (!input) return
    completedLeadIds.add(input.lead.id)
    records.push({ leadId: input.lead.id, providerRecordId: result.id })
  })

  return {
    records,
    failures: inputs
      .filter(({ lead }) => !completedLeadIds.has(lead.id))
      .map(({ lead }) => failureFor(
        lead.id,
        'HUBSPOT_CONTACT_WRITE_FAILED',
        'HubSpot did not accept this contact.',
      )),
  }
}

export class HubSpotContactExportProvider implements LeadExportProvider {
  readonly destination = 'hubspot' as const
  readonly connectionProvider = 'hubspot' as const

  constructor(private readonly accessToken: string) {}

  async testConnection(_context: LeadExportContext): Promise<ConnectionTestResult> {
    try {
      const response = await fetch(HUBSPOT_ACCOUNT_URL, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      return response.ok
        ? { ok: true }
        : {
            ok: false,
            reconnectRequired: response.status === 401 || response.status === 403,
            message: 'HubSpot connection could not be verified.',
          }
    } catch {
      return {
        ok: false,
        reconnectRequired: false,
        message: 'HubSpot could not be reached.',
      }
    }
  }

  async exportLeads(
    context: LeadExportContext,
    leads: readonly ExportLead[],
    _options?: ExportOptions,
  ): Promise<ExportResult> {
    const propertyStatus = await ensureOutlioContactProperties(this.accessToken)
    if (propertyStatus !== 'ok') {
      const code = propertyStatus === 'auth_rejected'
        ? 'HUBSPOT_AUTH_REJECTED'
        : propertyStatus === 'schema_scope_required'
          ? 'HUBSPOT_SCHEMA_SCOPE_REQUIRED'
          : 'HUBSPOT_PROPERTIES_UNAVAILABLE'
      return {
        successfulCount: 0,
        failedCount: leads.length,
        records: [],
        failures: leads.map((lead) => failureFor(
          lead.id,
          code,
          propertyStatus === 'unavailable'
            ? 'HubSpot contact properties could not be prepared. Please try again.'
            : 'Reconnect HubSpot to approve Outlio contact properties.',
        )),
      }
    }
    const records: NonNullable<ExportResult['records']> = []
    const failures: NonNullable<ExportResult['failures']> = []
    const createInputs: BatchInput[] = []
    const updateInputs: BatchInput[] = []

    for (const lead of leads) {
      const recordId = context.existingRecordIds.get(lead.id)
      if (recordId) updateInputs.push({ lead, recordId })
      else createInputs.push({ lead })
    }

    for (const [operation, operationInputs] of [
      ['create', createInputs],
      ['update', updateInputs],
    ] as const) {
      for (let offset = 0; offset < operationInputs.length; offset += BATCH_SIZE) {
        const result = await sendBatch(
          this.accessToken,
          operation,
          operationInputs.slice(offset, offset + BATCH_SIZE),
        )
        records.push(...result.records)
        failures.push(...result.failures)
      }
    }

    return {
      successfulCount: records.length,
      failedCount: failures.length,
      records,
      failures,
    }
  }
}
