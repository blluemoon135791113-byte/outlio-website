import 'server-only'

import { z } from 'zod'

import type { ExportLead } from '@/lib/export/leads'
import type { ConnectionTestResult, ExportResult } from '@/lib/integrations/types'

const GHL_ORIGIN = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'
const REQUEST_TIMEOUT_MS = 20_000
const LOCATION_ID = /^[A-Za-z0-9_-]{8,128}$/

export type GhlCredentials = { token: string; locationId: string }

const locationSchema = z.object({
  location: z.object({ id: z.string().min(1), name: z.string().optional() }).optional(),
  id: z.string().optional(),
  name: z.string().optional(),
}).passthrough()

function headers(token: string, json = false): HeadersInit {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    Version: API_VERSION,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  }
}

export function validateGhlCredentials(input: { token: string; locationId: string }): GhlCredentials | null {
  const token = input.token.trim()
  const locationId = input.locationId.trim()
  if (token.length < 20 || token.length > 4096 || !LOCATION_ID.test(locationId)) return null
  return { token, locationId }
}

export async function testGhlCredentials(credentials: GhlCredentials): Promise<ConnectionTestResult> {
  let response: Response
  try {
    response = await fetch(`${GHL_ORIGIN}/locations/${encodeURIComponent(credentials.locationId)}`, {
      headers: headers(credentials.token),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reconnectRequired: false, message: 'HighLevel could not be reached. Please try again.' }
  }
  if (response.status === 401) return { ok: false, reconnectRequired: true, message: 'HighLevel rejected this Private Integration Token.' }
  if (response.status === 403) return { ok: false, reconnectRequired: false, message: 'This token is missing locations.readonly permission.' }
  if (response.status === 404 || response.status === 422) return { ok: false, reconnectRequired: false, message: 'The HighLevel Location ID does not match this token.' }
  const parsed = locationSchema.safeParse(await response.json().catch(() => null))
  if (!response.ok || !parsed.success) return { ok: false, reconnectRequired: false, message: 'HighLevel could not verify this location.' }
  const location = parsed.data.location
  const id = location?.id ?? parsed.data.id
  if (id && id !== credentials.locationId) return { ok: false, reconnectRequired: false, message: 'The HighLevel Location ID does not match this token.' }
  return { ok: true, accountName: location?.name ?? parsed.data.name ?? `HighLevel location ${credentials.locationId}` }
}

type CustomField = { id: string; name: string; fieldKey?: string }

async function ensureCustomFields(credentials: GhlCredentials): Promise<Map<string, string>> {
  const wanted = [
    'Outlio Record Type',
    'Outlio LinkedIn Profile URL',
    'Outlio Sales Navigator URL',
    'Outlio Company Sales Navigator URL',
    'Outlio Company LinkedIn URL',
  ]
  const url = `${GHL_ORIGIN}/locations/${encodeURIComponent(credentials.locationId)}/customFields?model=contact`
  const response = await fetch(url, { headers: headers(credentials.token), cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) return new Map()
  const body = await response.json().catch(() => null) as { customFields?: CustomField[] } | null
  const fields = body?.customFields ?? []
  const result = new Map(fields.map((field) => [field.name.toLowerCase(), field.id]))

  for (const name of wanted) {
    if (result.has(name.toLowerCase())) continue
    const createdResponse = await fetch(url.split('?')[0], {
      method: 'POST',
      headers: headers(credentials.token, true),
      body: JSON.stringify({ name, dataType: 'TEXT', model: 'contact' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!createdResponse.ok) continue
    const created = await createdResponse.json().catch(() => null) as { customField?: CustomField; id?: string } | null
    const id = created?.customField?.id ?? created?.id
    if (id) result.set(name.toLowerCase(), id)
  }
  return result
}

function nameParts(name: string | null): { firstName: string; lastName: string } {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? []
  if (!parts.length) return { firstName: '', lastName: 'Unknown' }
  if (parts.length === 1) return { firstName: '', lastName: parts[0] }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! }
}

export async function exportLeadsToGhl(credentials: GhlCredentials, leads: readonly ExportLead[]): Promise<ExportResult> {
  const customFields = await ensureCustomFields(credentials).catch(() => new Map<string, string>())
  const failures: NonNullable<ExportResult['failures']> = []
  const records: NonNullable<ExportResult['records']> = []

  for (const lead of leads) {
    const names = nameParts(lead.name)
    const values = [
      ['Outlio Record Type', lead.recordType === 'account' ? 'Account List' : 'Lead'],
      ['Outlio LinkedIn Profile URL', lead.linkedinUrl],
      ['Outlio Sales Navigator URL', lead.salesNavigatorUrl],
      ['Outlio Company Sales Navigator URL', lead.companyLinkedInUrl],
      ['Outlio Company LinkedIn URL', lead.companyPublicLinkedIn],
    ] as const
    const displayName = lead.name ?? (lead.recordType === 'account' ? lead.companyName : null)
    const payload = {
      locationId: credentials.locationId,
      name: displayName ?? names.lastName,
      firstName: lead.name ? names.firstName || undefined : undefined,
      lastName: lead.name ? names.lastName : displayName ?? names.lastName,
      companyName: lead.companyName ?? undefined,
      website: lead.companyUrl ?? undefined,
      address1: lead.location ?? undefined,
      email: lead.workEmail ?? lead.companyContactEmail ?? undefined,
      phone: lead.mobilePhone ?? lead.companyContactPhone ?? undefined,
      source: 'Outlio',
      customFields: values.flatMap(([name, value]) => {
        const id = customFields.get(name.toLowerCase())
        return id && value ? [{ id, value }] : []
      }),
    }
    let response: Response | null = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await fetch(`${GHL_ORIGIN}/contacts/`, {
        method: 'POST',
        headers: headers(credentials.token, true),
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }).catch(() => null)
      if (response?.status !== 429 && (!response || response.status < 500)) break
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)))
    }
    const body = response ? await response.json().catch(() => null) as { contact?: { id?: string }; id?: string } | null : null
    const recordId = body?.contact?.id ?? body?.id
    if (response?.ok && recordId) records.push({ sourceId: lead.id, providerRecordId: recordId })
    else {
      const code = response?.status === 401 ? 'GHL_AUTH_REJECTED' : response?.status === 403 ? 'GHL_INSUFFICIENT_SCOPES' : response?.status === 422 ? 'GHL_LOCATION_REJECTED' : 'GHL_CONTACT_CREATE_FAILED'
      const message = code === 'GHL_AUTH_REJECTED' ? 'HighLevel rejected the saved token. Update the token.' : code === 'GHL_INSUFFICIENT_SCOPES' ? 'The HighLevel token is missing contacts.write permission.' : code === 'GHL_LOCATION_REJECTED' ? 'HighLevel rejected the saved Location ID.' : 'HighLevel could not create this contact.'
      failures.push({ sourceId: lead.id, code, message })
    }
  }
  return { successfulCount: records.length, failedCount: failures.length, records, failures }
}
