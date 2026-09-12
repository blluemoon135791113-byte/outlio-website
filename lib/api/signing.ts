/**
 * Key generation, hashing and webhook signing — M8 Phase 25.5.
 *
 * ⚠️ PURE, AND SEPARATE FROM THE DATABASE ON PURPOSE. These are the pieces a
 * customer's own consumer has to mirror to verify our signatures, so they are
 * the pieces most worth testing exhaustively — and none of it should need a
 * database connection to exercise.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * ⚠️ THE PREFIX IS PART OF THE SECURITY STORY, not branding. `outlio_sk_` is
 * matchable by secret scanners — GitHub, GitGuardian and similar work from
 * known prefixes — so a key pasted into a public repo can be detected and
 * revoked automatically. An opaque random string cannot be.
 */
export const API_KEY_PREFIX = 'outlio_sk_'

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

/** Generates a key. The plaintext is returned ONCE and never stored. */
export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return {
    key,
    hash: hashApiKey(key),
    // Enough to identify the key in a list, far too little to reconstruct it.
    prefix: key.slice(0, API_KEY_PREFIX.length + 6),
  }
}

/**
 * Extracts the key from a request.
 *
 * ⚠️ `Authorization: Bearer` ONLY — never a query parameter. A key in a URL
 * ends up in server logs, browser history, referrer headers and analytics,
 * which is how long-lived credentials leak without anyone doing anything wrong.
 */
export function extractApiKey(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null

  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null

  const value = rest.join(' ').trim()
  return value || null
}

/** Constant-time comparison, for any caller-supplied secret. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/* The event catalog lives in `webhook-events.ts` — client-reachable, so it must
   not carry this file's `node:crypto` imports with it. Re-exported here so the
   server-side importers keep their existing `@/lib/api/signing` paths. */
export { WEBHOOK_EVENTS } from './webhook-events'
export type { WebhookEvent } from './webhook-events'

/**
 * ⚠️ EXPONENTIAL, AND IT STARTS SMALL. A consumer that is briefly down should
 * get its event within a minute, not after a fixed hour; one that is badly
 * down should not be hammered. 30s, 2m, 8m, 32m, 2h — five attempts spanning
 * about three hours, which covers a deploy or a short outage without retrying
 * into next week.
 */
export function backoffSeconds(attempt: number): number {
  return 30 * 4 ** Math.max(attempt - 1, 0)
}

/**
 * The same schedule, spread so simultaneous failures do not retry in lockstep.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §5.13 ASKS FOR "EXPONENTIAL BACKOFF + JITTER" AND THE JITTER WAS MISSING.║
 * ║                                                                           ║
 * ║  Not a cosmetic gap. `publishEvent` fans one domain event out to every     ║
 * ║  subscriber in the same instant, and a bulk import emits many events in    ║
 * ║  one tick — so a batch of deliveries shares a `next_attempt_at` to the     ║
 * ║  second. If the consumer is down, every one of them retries together, at   ║
 * ║  30s, then 2m, then 8m: a thundering herd aimed at the endpoint that is    ║
 * ║  already struggling, which is how a brief outage becomes a long one.      ║
 * ║                                                                           ║
 * ║  ⚠️ EQUAL JITTER, NOT FULL JITTER. Full jitter — `random() * base` — can    ║
 * ║  retry almost immediately, throwing away the "do not hammer a consumer     ║
 * ║  that is badly down" property the schedule above exists for. Equal jitter  ║
 * ║  keeps at least half the delay and spreads the rest, so the herd breaks up ║
 * ║  without any single retry arriving early.                                  ║
 * ║                                                                           ║
 * ║  ⚠️ `backoffSeconds` IS LEFT EXACT ON PURPOSE. It documents the schedule    ║
 * ║  and is asserted value-for-value by `api-signing.test.ts`; a randomised    ║
 * ║  function cannot be. This wraps it rather than replacing it.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * @param random injectable so a test can pin the result instead of sampling it.
 */
export function backoffSecondsWithJitter(
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = backoffSeconds(attempt)
  const half = base / 2
  // [half, base) — never zero, never longer than the documented schedule.
  return Math.round(half + random() * half)
}

/**
 * Signs a payload the way we ask consumers to verify it.
 *
 * ⚠️ THE TIMESTAMP IS INSIDE THE SIGNED STRING. Signing the body alone lets
 * anyone who ever captured one delivery replay it forever; binding the time
 * means a consumer can reject anything old, and cannot be tricked by editing
 * the timestamp because that invalidates the signature.
 */
export function signWebhookPayload(
  body: string,
  secret: string,
  at: Date = new Date(),
): { signature: string; timestamp: string } {
  const timestamp = Math.floor(at.getTime() / 1000).toString()
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return { signature: `t=${timestamp},v1=${signature}`, timestamp }
}

/**
 * Verifies one of our own signatures — the reference implementation we hand
 * customers, kept here so it cannot drift from the signer beside it.
 */
export function verifyWebhookSignature(
  body: string,
  header: string,
  secret: string,
  maxAgeSeconds = 300,
  now: Date = new Date(),
): boolean {
  const parts: Record<string, string> = {}
  for (const chunk of header.split(',')) {
    const [k, ...rest] = chunk.split('=')
    if (k && rest.length) parts[k.trim()] = rest.join('=').trim()
  }

  if (!parts.t || !parts.v1) return false

  const timestamp = Number(parts.t)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > maxAgeSeconds) return false

  const expected = createHmac('sha256', secret).update(`${parts.t}.${body}`).digest('hex')
  return secretsMatch(expected, parts.v1)
}
