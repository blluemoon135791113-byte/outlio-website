/**
 * The one public schema for Outlio product analytics.
 *
 * Keep this module runtime-neutral: browser and server helpers both import it.
 * Event properties are deliberately small, bounded, and free of customer data.
 */
export const ANALYTICS_SCHEMA_VERSION = 1 as const

export type AnalyticsPrimitive = string | number | boolean

export type AnalyticsEventMap = {
  account_signed_up: { has_referral_code: boolean }
  account_signed_in: { requires_mfa: boolean }
  checkout_started: {
    plan: 'starter' | 'professional' | 'custom'
    billing_interval: 'month' | 'year'
    is_authenticated: boolean
  }
  extractor_job_started: {
    source: 'browser_extension'
    correlation_id: string
    has_page_identifier: boolean
    has_page_name: boolean
  }
  extractor_job_finished: {
    result: 'completed' | 'partially_completed' | 'failed'
    records_parsed?: number
    records_kept?: number
    files_processed?: number
    files_failed?: number
  }
  leads_imported: {
    workspace_id: string
    records_succeeded: number
    records_matched: number
    records_failed: number
  }
  records_exported: {
    destination: 'clay' | 'google_sheets' | 'google_drive' | 'highlevel'
    record_kind: 'lead' | 'account'
    result: 'completed' | 'partial' | 'failed'
    records_succeeded: number
    records_failed: number
  }
  crm_contact_created: {
    workspace_id: string
    source: 'manual'
  }
  crm_contact_assignment_updated: {
    workspace_id: string
    assignment_state: 'assigned' | 'unassigned'
    override_used: boolean
  }
  crm_opportunity_created: {
    workspace_id: string
    has_person_link: boolean
    has_company_link: boolean
    has_value: boolean
  }
  crm_opportunity_stage_changed: {
    workspace_id: string
    result: 'open' | 'won' | 'lost'
    is_terminal: boolean
    seconds_in_previous_stage: number
  }
  integration_connected: {
    workspace_id: string
    integration_type: 'smtp'
    supports_inbound: boolean
  }
  flow_created: {
    workspace_id: string
    used_template: boolean
    template_key?: string
  }
  flow_published: {
    workspace_id: string
    sends_email: boolean
  }
  campaign_created: {
    workspace_id: string
    campaign_type: string
  }
  campaign_launched: {
    workspace_id: string
    campaign_type: string
    sequence_step_count: number
    enrollment_count: number
  }
  hubble_query_completed: {
    workspace_id: string
    feature: 'hubble_ask'
    result: string
    duration_ms: number
    from_cache: boolean
    searches: number
    pages_fetched: number
    browser_fetches: number
    llm_calls: number
  }
  hubble_query_failed: {
    workspace_id: string
    feature: 'hubble_ask'
    error_code: 'RESEARCH_FAILED'
    duration_ms: number
  }
  analytics_validation_completed: {
    workspace_id: string
    channel: 'browser' | 'server'
    validation_run_id: string
  }
}

export type AnalyticsEventName = keyof AnalyticsEventMap
export type AnalyticsEventProperties<E extends AnalyticsEventName> = AnalyticsEventMap[E]

const COMMON_PROPERTY_KEYS = [
  'schema_version',
  'app_environment',
  'release',
  'is_synthetic',
] as const

export const EVENT_PROPERTY_KEYS: {
  readonly [E in AnalyticsEventName]: readonly (keyof AnalyticsEventMap[E])[]
} = {
  account_signed_up: ['has_referral_code'],
  account_signed_in: ['requires_mfa'],
  checkout_started: ['plan', 'billing_interval', 'is_authenticated'],
  extractor_job_started: [
    'source',
    'correlation_id',
    'has_page_identifier',
    'has_page_name',
  ],
  extractor_job_finished: [
    'result',
    'records_parsed',
    'records_kept',
    'files_processed',
    'files_failed',
  ],
  leads_imported: [
    'workspace_id',
    'records_succeeded',
    'records_matched',
    'records_failed',
  ],
  records_exported: [
    'destination',
    'record_kind',
    'result',
    'records_succeeded',
    'records_failed',
  ],
  crm_contact_created: ['workspace_id', 'source'],
  crm_contact_assignment_updated: [
    'workspace_id',
    'assignment_state',
    'override_used',
  ],
  crm_opportunity_created: [
    'workspace_id',
    'has_person_link',
    'has_company_link',
    'has_value',
  ],
  crm_opportunity_stage_changed: [
    'workspace_id',
    'result',
    'is_terminal',
    'seconds_in_previous_stage',
  ],
  integration_connected: ['workspace_id', 'integration_type', 'supports_inbound'],
  flow_created: ['workspace_id', 'used_template', 'template_key'],
  flow_published: ['workspace_id', 'sends_email'],
  campaign_created: ['workspace_id', 'campaign_type'],
  campaign_launched: [
    'workspace_id',
    'campaign_type',
    'sequence_step_count',
    'enrollment_count',
  ],
  hubble_query_completed: [
    'workspace_id',
    'feature',
    'result',
    'duration_ms',
    'from_cache',
    'searches',
    'pages_fetched',
    'browser_fetches',
    'llm_calls',
  ],
  hubble_query_failed: ['workspace_id', 'feature', 'error_code', 'duration_ms'],
  analytics_validation_completed: ['workspace_id', 'channel', 'validation_run_id'],
}

/** Keys that must never survive even if somebody weakens an event schema. */
export const PROHIBITED_ANALYTICS_PROPERTY_PATTERN =
  /(?:^|_)(?:email|phone|name|password|secret|token|cookie|authorization|prompt|question|response|message|body|html|content|lead|contact|profile|csv|oauth_code)(?:_|$)/i

const MAX_STRING_LENGTH = 120

export function sanitizeEventProperties<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEventProperties<E> | Record<string, unknown>,
  common: Record<string, unknown> = {},
): Record<string, AnalyticsPrimitive> {
  const allowed = new Set<string>([
    ...COMMON_PROPERTY_KEYS,
    ...EVENT_PROPERTY_KEYS[event].map(String),
  ])
  const output: Record<string, AnalyticsPrimitive> = {}

  for (const [key, value] of Object.entries({ ...properties, ...common })) {
    if (!allowed.has(key) || PROHIBITED_ANALYTICS_PROPERTY_PATTERN.test(key)) continue
    if (typeof value === 'string') output[key] = value.slice(0, MAX_STRING_LENGTH)
    else if (typeof value === 'boolean') output[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value
  }

  output.schema_version = ANALYTICS_SCHEMA_VERSION
  return output
}

export function workspaceSizeBand(memberCount: number): '1' | '2-5' | '6-20' | '21+' {
  if (memberCount <= 1) return '1'
  if (memberCount <= 5) return '2-5'
  if (memberCount <= 20) return '6-20'
  return '21+'
}

/** Drop query strings and fragments before URLs leave the browser. */
export function sanitizeAnalyticsUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    const url = new URL(value, 'https://outlio.invalid')
    return `${url.origin === 'https://outlio.invalid' ? '' : url.origin}${url.pathname}`
  } catch {
    return value.split(/[?#]/, 1)[0]
  }
}

/**
 * Scrub every PostHog URL-shaped property, including SDK-added session-entry
 * and initial URL fields that do not exist until the event is assembled.
 */
export function sanitizeAnalyticsEventUrls(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(properties)) {
    if (/(?:url|referrer|pathname)$/i.test(key)) {
      properties[key] = sanitizeAnalyticsUrl(value)
    }
  }
  return properties
}

export function sanitizeAnalyticsException(error: unknown, message: string): Error {
  const safeError = new Error(message)
  safeError.name = error instanceof Error ? error.name.slice(0, 80) : 'UnknownError'
  if (error instanceof Error && error.stack) {
    safeError.stack = [`${safeError.name}: ${safeError.message}`, ...error.stack.split('\n').slice(1)]
      .join('\n')
  }
  return safeError
}

const REPLAY_SAFE_ROUTES = new Set(['/dashboard', '/flows', '/crm/reports'])

export function isReplaySafeRoute(
  pathname: string,
  search = '',
  hash = '',
): boolean {
  return (
    !search &&
    !hash &&
    REPLAY_SAFE_ROUTES.has(pathname.replace(/\/$/, '') || '/')
  )
}

/** Stable 10% replay sample: the same account is either always in or always out. */
export function isReplaySampled(distinctId: string): boolean {
  let hash = 0
  for (const character of distinctId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % 10 === 0
}
