import 'server-only'

import type { ExportLead } from '@/lib/export/leads'
import type {
  ConnectionTestResult,
  ExportOptions,
  ExportResult,
  IntegrationCredentialEnvelope,
  LeadExportContext,
  LeadExportProvider,
} from '@/lib/integrations/types'

const CLAY_HOST = 'api.clay.com'
const CLAY_WEBHOOK_PREFIX = '/v3/sources/webhook/'
const REQUEST_TIMEOUT_MS = 15_000
const EXPORT_CONCURRENCY = 1
const MIN_REQUEST_INTERVAL_MS = 300
const MAX_TRANSIENT_RETRIES = 5

export type ClayCredentials = Pick<
  IntegrationCredentialEnvelope,
  'clayWebhookUrl' | 'clayAuthenticationToken'
> & { clayWebhookUrl: string }

export function parseClayWebhookUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return null
    if (url.hostname !== CLAY_HOST) return null
    if (!url.pathname.startsWith(CLAY_WEBHOOK_PREFIX)) return null
    if (url.pathname.length <= CLAY_WEBHOOK_PREFIX.length) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url
  } catch {
    return null
  }
}

export function clayConnectionLabel(webhookUrl: string): string {
  return parseClayWebhookUrl(webhookUrl)?.hostname ?? 'Clay webhook'
}

export function toClayLeadPayload(lead: ExportLead): Record<string, string | null> {
  return {
    name: lead.name,
    linkedin_profile_url: lead.linkedinUrl,
    job_title: lead.jobTitle,
    company: lead.companyName,
    company_url: lead.companyUrl,
    location: lead.location,
    sales_navigator_url: lead.salesNavigatorUrl,
  }
}

type ClayRequestResult =
  | { ok: true }
  | { ok: false; code: string; message: string; reconnectRequired: boolean; retryAfterMs?: number }

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(250, Math.min(seconds * 1_000, 10_000))
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 10_000)
  }
  return Math.min(500 * (2 ** attempt), 8_000)
}

async function postToClayOnce(
  credentials: ClayCredentials,
  payload: Record<string, unknown>,
): Promise<ClayRequestResult> {
  const url = parseClayWebhookUrl(credentials.clayWebhookUrl)
  if (!url) {
    return {
      ok: false,
      code: 'CLAY_WEBHOOK_INVALID',
      message: 'The saved Clay webhook URL is invalid. Disconnect and reconnect Clay.',
      reconnectRequired: true,
    }
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  const token = credentials.clayAuthenticationToken?.trim()
  if (token) headers.set('x-clay-webhook-auth', token)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    return {
      ok: false,
      code: 'CLAY_UNAVAILABLE',
      message: 'Clay could not be reached. Check the webhook and try again.',
      reconnectRequired: false,
    }
  }

  if (response.ok) return { ok: true }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: 'CLAY_AUTH_REJECTED',
      message: 'Clay rejected the authentication token. Reconnect with the correct token.',
      reconnectRequired: true,
    }
  }

  if (response.status === 404) {
    return {
      ok: false,
      code: 'CLAY_WEBHOOK_NOT_FOUND',
      message: 'That Clay webhook was not found. Copy the webhook URL from your Clay table again.',
      reconnectRequired: true,
    }
  }

  if (response.status === 429) {
    return {
      ok: false,
      code: 'CLAY_RATE_LIMITED',
      message: 'Clay is receiving requests too quickly. Wait a moment and try again.',
      reconnectRequired: false,
      retryAfterMs: retryDelay(response, 0),
    }
  }

  if (response.status >= 500) {
    return {
      ok: false,
      code: 'CLAY_UNAVAILABLE',
      message: 'Clay could not be reached. Check the webhook and try again.',
      reconnectRequired: false,
      retryAfterMs: 500,
    }
  }

  return {
    ok: false,
    code: 'CLAY_REQUEST_FAILED',
    message: 'Clay did not accept this request. Test the connection and try again.',
    reconnectRequired: response.status >= 400 && response.status < 500,
  }
}

async function postToClay(
  credentials: ClayCredentials,
  payload: Record<string, unknown>,
): Promise<ClayRequestResult> {
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    const result = await postToClayOnce(credentials, payload)
    if (result.ok || !result.retryAfterMs || attempt === MAX_TRANSIENT_RETRIES) return result
    await wait(Math.max(result.retryAfterMs, Math.min(500 * (2 ** attempt), 8_000)))
  }
  return {
    ok: false,
    code: 'CLAY_UNAVAILABLE',
    message: 'Clay could not be reached. Check the webhook and try again.',
    reconnectRequired: false,
  }
}

export async function testClayCredentials(
  credentials: ClayCredentials,
): Promise<ConnectionTestResult> {
  const result = await postToClay(credentials, {
    outlio_connection_test: true,
    source: 'Outlio',
  })

  return result.ok
    ? { ok: true, accountName: clayConnectionLabel(credentials.clayWebhookUrl) }
    : {
        ok: false,
        reconnectRequired: result.reconnectRequired,
        message: result.message,
      }
}

export class ClayExportProvider implements LeadExportProvider {
  readonly destination = 'clay' as const
  readonly connectionProvider = 'clay' as const

  constructor(private readonly credentials: ClayCredentials) {}

  testConnection(_context: LeadExportContext): Promise<ConnectionTestResult> {
    return testClayCredentials(this.credentials)
  }

  async exportLeads(
    _context: LeadExportContext,
    leads: readonly ExportLead[],
    _options?: ExportOptions,
  ): Promise<ExportResult> {
    const failures: NonNullable<ExportResult['failures']> = []
    let successfulCount = 0

    for (let offset = 0; offset < leads.length; offset += EXPORT_CONCURRENCY) {
      const batch = leads.slice(offset, offset + EXPORT_CONCURRENCY)
      const results = await Promise.all(
        batch.map(async (lead) => ({
          lead,
          result: await postToClay(this.credentials, toClayLeadPayload(lead)),
        })),
      )

      for (const { lead, result } of results) {
        if (result.ok) successfulCount += 1
        else {
          failures.push({
            leadId: lead.id,
            code: result.code,
            message: result.message,
          })
        }
      }

      if (offset + EXPORT_CONCURRENCY < leads.length) await wait(MIN_REQUEST_INTERVAL_MS)
    }

    return {
      successfulCount,
      failedCount: failures.length,
      failures,
    }
  }
}
