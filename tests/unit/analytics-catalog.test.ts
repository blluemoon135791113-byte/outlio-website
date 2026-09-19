import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  ANALYTICS_SCHEMA_VERSION,
  EVENT_PROPERTY_KEYS,
  isReplaySafeRoute,
  isReplaySampled,
  sanitizeAnalyticsEventUrls,
  sanitizeAnalyticsException,
  sanitizeAnalyticsUrl,
  sanitizeEventProperties,
  workspaceSizeBand,
} from '@/lib/analytics/catalog'

describe('analytics event governance', () => {
  it('uses stable snake_case event names', () => {
    for (const event of Object.keys(EVENT_PROPERTY_KEYS)) {
      expect(event).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
    }
  })

  it('keeps the machine-readable manifest synchronized with the typed catalog', () => {
    const manifest = JSON.parse(readFileSync('.posthog-events.json', 'utf8')) as Array<{
      event_name: string
    }>
    expect(manifest.map((entry) => entry.event_name).sort()).toEqual(
      Object.keys(EVENT_PROPERTY_KEYS).sort(),
    )
  })

  it('keeps only allowlisted scalar properties and adds the schema version', () => {
    const properties = sanitizeEventProperties(
      'hubble_query_completed',
      {
        workspace_id: 'workspace-123',
        feature: 'hubble_ask',
        result: 'answered',
        duration_ms: 42,
        from_cache: false,
        searches: 1,
        pages_fetched: 2,
        browser_fetches: 0,
        llm_calls: 1,
        prompt: 'private question',
        response_body: 'private answer',
        nested: { customer: 'data' },
      } as never,
      { app_environment: 'test', unknown_global: 'drop me' },
    )

    expect(properties).toEqual({
      workspace_id: 'workspace-123',
      feature: 'hubble_ask',
      result: 'answered',
      duration_ms: 42,
      from_cache: false,
      searches: 1,
      pages_fetched: 2,
      browser_fetches: 0,
      llm_calls: 1,
      app_environment: 'test',
      schema_version: ANALYTICS_SCHEMA_VERSION,
    })
  })

  it('drops prohibited property names even when presented to the sanitizer', () => {
    const properties = sanitizeEventProperties('account_signed_up', {
      has_referral_code: true,
      email: 'person@example.com',
      authentication_token: 'secret',
      full_message_body: 'private',
    } as never)

    expect(properties).toEqual({
      has_referral_code: true,
      schema_version: ANALYTICS_SCHEMA_VERSION,
    })
  })

  it('bounds high-cardinality strings and discards non-finite numbers', () => {
    const properties = sanitizeEventProperties('extractor_job_started', {
      source: 'browser_extension',
      correlation_id: 'x'.repeat(500),
      has_page_identifier: true,
      has_page_name: false,
    })

    expect(String(properties.correlation_id)).toHaveLength(120)
    expect(
      sanitizeEventProperties('hubble_query_failed', {
        workspace_id: 'workspace-123',
        feature: 'hubble_ask',
        error_code: 'RESEARCH_FAILED',
        duration_ms: Number.POSITIVE_INFINITY,
      }),
    ).not.toHaveProperty('duration_ms')
  })

  it('keeps CRM, export, and extractor outcomes aggregate-only', () => {
    expect(
      sanitizeEventProperties('crm_opportunity_created', {
        workspace_id: 'workspace-123',
        has_person_link: true,
        has_company_link: false,
        has_value: true,
        title: 'Private deal title',
        contact_id: 'private-contact-id',
        value_amount: 50000,
      } as never),
    ).toEqual({
      workspace_id: 'workspace-123',
      has_person_link: true,
      has_company_link: false,
      has_value: true,
      schema_version: ANALYTICS_SCHEMA_VERSION,
    })

    expect(
      sanitizeEventProperties('records_exported', {
        destination: 'clay',
        record_kind: 'lead',
        result: 'partial',
        records_succeeded: 8,
        records_failed: 2,
        destination_url: 'https://private.example/export',
        response_body: 'private export payload',
      } as never),
    ).toEqual({
      destination: 'clay',
      record_kind: 'lead',
      result: 'partial',
      records_succeeded: 8,
      records_failed: 2,
      schema_version: ANALYTICS_SCHEMA_VERSION,
    })

    expect(
      sanitizeEventProperties('extractor_job_finished', {
        result: 'completed',
        records_parsed: 10,
        records_kept: 9,
        files_processed: 2,
        files_failed: 0,
        html: '<private>',
      } as never),
    ).toEqual({
      result: 'completed',
      records_parsed: 10,
      records_kept: 9,
      files_processed: 2,
      files_failed: 0,
      schema_version: ANALYTICS_SCHEMA_VERSION,
    })
  })
})

describe('analytics privacy helpers', () => {
  it('removes URL query strings and fragments', () => {
    expect(sanitizeAnalyticsUrl('https://app.outlio.io/dashboard?token=secret#row')).toBe(
      'https://app.outlio.io/dashboard',
    )
    expect(sanitizeAnalyticsUrl('/pricing?utm_campaign=launch')).toBe('/pricing')
  })

  it('scrubs SDK-added current, initial, and session-entry URL properties', () => {
    const properties = sanitizeAnalyticsEventUrls({
      $current_url: 'https://app.outlio.io/dashboard?token=secret#row',
      $session_entry_url: 'https://app.outlio.io/dashboard?invite=private#panel',
      $initial_current_url: 'https://app.outlio.io/sign-in?code=private',
      $referrer: 'https://example.com/source?person=private',
      $session_entry_referrer: 'https://example.com/start?person=private',
      $pathname: '/dashboard?not-a-normal-path=value',
      channel: 'browser',
    })

    expect(properties).toEqual({
      $current_url: 'https://app.outlio.io/dashboard',
      $session_entry_url: 'https://app.outlio.io/dashboard',
      $initial_current_url: 'https://app.outlio.io/sign-in',
      $referrer: 'https://example.com/source',
      $session_entry_referrer: 'https://example.com/start',
      $pathname: '/dashboard',
      channel: 'browser',
    })
  })

  it('retains stack frames without retaining a potentially sensitive message', () => {
    const source = new Error('person@example.com supplied token abc123')
    source.stack = 'Error: person@example.com supplied token abc123\n    at safeFrame (app.ts:10:2)'
    const sanitized = sanitizeAnalyticsException(source, 'Sanitized exception')

    expect(sanitized.name).toBe('Error')
    expect(sanitized.message).toBe('Sanitized exception')
    expect(sanitized.stack).toContain('at safeFrame (app.ts:10:2)')
    expect(sanitized.stack).not.toContain('person@example.com')
    expect(sanitized.stack).not.toContain('abc123')
  })

  it('permits replay only on explicitly low-risk overview routes', () => {
    expect(isReplaySafeRoute('/dashboard')).toBe(true)
    expect(isReplaySafeRoute('/flows')).toBe(true)
    expect(isReplaySafeRoute('/crm/reports/')).toBe(true)
    expect(isReplaySafeRoute('/sign-in')).toBe(false)
    expect(isReplaySafeRoute('/dashboard/settings')).toBe(false)
    expect(isReplaySafeRoute('/crm/contacts')).toBe(false)
    expect(isReplaySafeRoute('/email/campaigns')).toBe(false)
    expect(isReplaySafeRoute('/dashboard', '?token=private')).toBe(false)
    expect(isReplaySafeRoute('/dashboard', '', '#private')).toBe(false)
  })

  it('uses coarse workspace size bands', () => {
    expect([workspaceSizeBand(1), workspaceSizeBand(3), workspaceSizeBand(10), workspaceSizeBand(30)])
      .toEqual(['1', '2-5', '6-20', '21+'])
  })

  it('uses a stable bounded replay sample', () => {
    const decisions = Array.from({ length: 1_000 }, (_, index) =>
      isReplaySampled(`synthetic-user-${index}`),
    )
    expect(decisions.filter(Boolean).length).toBeGreaterThanOrEqual(80)
    expect(decisions.filter(Boolean).length).toBeLessThanOrEqual(120)
    expect(isReplaySampled('same-user')).toBe(isReplaySampled('same-user'))
  })
})
