import 'server-only'

/**
 * Calendly webhook signature verification — M8 Phase 24.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  AN UNVERIFIED WEBHOOK IS AN OPEN WRITE ENDPOINT.                        ║
 * ║                                                                           ║
 * ║  This URL is public and its shape is guessable. Without a signature check ║
 * ║  anyone could POST a "meeting booked" and have it become a CALL_BOOKED    ║
 * ║  activity on a real contact — poisoning the metrics a team is paid on,    ║
 * ║  and triggering whatever flow watches for booked calls.                   ║
 * ║                                                                           ║
 * ║  Calendly signs with `Calendly-Webhook-Signature: t=<unix>,v1=<hmac>`,    ║
 * ║  where the HMAC is over `<t>.<raw body>`. The RAW body matters: parsing   ║
 * ║  and re-serialising JSON changes key order and whitespace, and the        ║
 * ║  signature would never match.                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type SignatureResult =
  | { valid: true }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'stale' | 'not_configured' }

/**
 * ⚠️ FIVE MINUTES. A signature with no time bound can be replayed forever by
 * anyone who ever saw one — captured from a log, a proxy, or a bug report. The
 * timestamp is inside the signed payload, so it cannot be edited without
 * invalidating the signature.
 */
const MAX_AGE_SECONDS = 300

/** Parses `t=...,v1=...`, tolerating spacing and extra versions. */
export function parseSignatureHeader(header: string): { t: string; v1: string } | null {
  const parts: Record<string, string> = {}

  for (const chunk of header.split(',')) {
    const [key, ...rest] = chunk.split('=')
    if (!key || rest.length === 0) continue
    parts[key.trim()] = rest.join('=').trim()
  }

  if (!parts.t || !parts.v1) return null
  return { t: parts.t, v1: parts.v1 }
}

/**
 * Verifies one delivery.
 *
 * @param rawBody the body EXACTLY as received. Do not JSON.parse first.
 */
export function verifyCalendlySignature(
  rawBody: string,
  header: string | null,
  signingKey: string | undefined,
  now: Date = new Date(),
): SignatureResult {
  /*
   * ⚠️ NO KEY MEANS REJECT, NOT ACCEPT. A missing environment variable must
   * never turn signature checking off — that is how an endpoint silently
   * becomes open in the one environment where the variable was forgotten.
   */
  if (!signingKey) return { valid: false, reason: 'not_configured' }
  if (!header) return { valid: false, reason: 'malformed' }

  const parsed = parseSignatureHeader(header)
  if (!parsed) return { valid: false, reason: 'malformed' }

  const timestamp = Number(parsed.t)
  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'malformed' }

  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - timestamp)
  if (ageSeconds > MAX_AGE_SECONDS) return { valid: false, reason: 'stale' }

  const expected = createHmac('sha256', signingKey)
    .update(`${parsed.t}.${rawBody}`)
    .digest('hex')

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(parsed.v1, 'utf8')

  /*
   * ⚠️ CONSTANT TIME. A plain `===` leaks, through timing, how many leading
   * characters of a guess were right — turning forgery into a
   * character-at-a-time search rather than a 2^256 one. `timingSafeEqual`
   * throws on a length mismatch, so the length is compared first and returns
   * the same generic answer.
   */
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' }
  }

  return { valid: true }
}

/** Builds a signature the way Calendly does. Used by tests and by nothing else. */
export function signCalendlyPayload(
  rawBody: string,
  signingKey: string,
  at: Date = new Date(),
): string {
  const t = Math.floor(at.getTime() / 1000).toString()
  const v1 = createHmac('sha256', signingKey).update(`${t}.${rawBody}`).digest('hex')
  return `t=${t},v1=${v1}`
}
