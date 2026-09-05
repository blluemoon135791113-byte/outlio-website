import 'server-only'

/**
 * Structured logging for the FastSpring webhook path.
 *
 * Every line is one JSON object under a fixed prefix so deliveries can be
 * traced end to end in Vercel's log search: filter on `[fastspring]`, then on
 * an `eventId` to see that event's whole journey.
 *
 * ⚠️ What must never appear here: the webhook secret, API credentials, the raw
 * body, the signature, or a customer's email or name. A user is identified by
 * their Outlio UUID and nothing else. FastSpring's own identifiers are safe —
 * they are opaque and meaningless without authenticated API access.
 */

type Level = 'info' | 'warn' | 'error'

export type FastSpringLogEvent =
  | 'webhook.received'
  | 'webhook.verification_failed'
  | 'webhook.unreadable'
  | 'event.processing'
  | 'event.duplicate_ignored'
  | 'event.ignored_test_mode'
  | 'event.unhandled_type'
  | 'event.failed'
  | 'user.matched'
  | 'user.unmatched'
  | 'credits.allocated'
  | 'credits.none_needed'
  | 'billing.status_changed'
  | 'billing.charge_failed'

export function logFastSpring(
  level: Level,
  event: FastSpringLogEvent,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const line = JSON.stringify({
    scope: 'fastspring',
    event,
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  })

  if (level === 'error') console.error(`[fastspring] ${line}`)
  else if (level === 'warn') console.warn(`[fastspring] ${line}`)
  else console.info(`[fastspring] ${line}`)
}
