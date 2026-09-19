import posthog from 'posthog-js'

import { sanitizeAnalyticsEventUrls } from '@/lib/analytics/catalog'

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST

if (!token || !host) {
  // Analytics is optional infrastructure. A missing environment variable must
  // never prevent local development, rendering, authentication, or mutations,
  // but development must make the data-loss risk visible.
  if (process.env.NODE_ENV === 'development') {
    if (!token) {
      console.error(
        'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured',
      )
    }
    if (!host) {
      console.error(
        'NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured',
      )
    }
  }
} else {
  posthog.init(token, {
    api_host: host,
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
    capture_pageview: 'history_change',
    disable_capture_url_hashes: true,
    // Automatic exception messages can contain customer/provider data. Outlio
    // reports selected failures through the sanitized manual helper instead.
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
    // Product screens contain customer and lead data. Keep analytics useful
    // while ensuring PostHog never receives rendered text, element attributes,
    // or form values from autocapture/session replay.
    autocapture: {
      dom_event_allowlist: ['click', 'submit'],
      element_allowlist: ['a', 'button', 'form'],
    },
    mask_all_text: true,
    mask_all_element_attributes: true,
    mask_personal_data_properties: true,
    custom_personal_data_properties: [
      'email',
      'token',
      'code',
      'invite',
      'referral_code',
    ],
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
      maskAllElementAttributes: true,
      blockSelector:
        'input[type="hidden"], input[type="file"], [data-private], [data-sensitive]',
      recordHeaders: false,
      recordBody: false,
      recordCrossOriginIframes: false,
      captureJsonLd: false,
    },
    // ProductShell starts recording only on a small, explicitly safe route
    // allowlist. Sensitive product surfaces never start a recorder.
    disable_session_recording: true,
    enable_recording_console_log: false,
    capture_performance: false,
    before_send: (event) => {
      if (!event) return null
      sanitizeAnalyticsEventUrls(event.properties)
      event.properties.app_environment =
        process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown'
      event.properties.is_synthetic =
        process.env.NEXT_PUBLIC_POSTHOG_SYNTHETIC === 'true'
      event.properties.$geoip_disable = true
      event.properties.$ip = '0.0.0.0'
      return event
    },
    // Do not create analytics cookies or browser storage. Authenticated users
    // are identified from the server-provided account ID on every page load.
    disable_persistence: true,
    // With persistence disabled, never merge a newly minted anonymous ID into
    // the same authenticated person after each hard load. This prevents person
    // merge-limit exhaustion while deliberately sacrificing cross-load
    // anonymous attribution until the owner approves an opaque consented ID.
    reuseAnonymousId: true,
    respect_dnt: true,
    debug: process.env.NODE_ENV === 'development',
  })
}
