import 'server-only'

/**
 * One-click unsubscribe — M6 Phase 17.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M6 CRITERION 2: "unsubscribe link works one-click, updates suppression,  ║
 * ║  stops applicable campaigns, records events."                             ║
 * ║                                                                           ║
 * ║  RFC 8058 one-click. Since February 2024 Gmail and Yahoo REQUIRE this of  ║
 * ║  bulk senders, and the requirement is specific: the link must work in a   ║
 * ║  single POST with no login, no confirmation page, and no "are you sure".  ║
 * ║  A sender who makes unsubscribing hard gets marked as spam instead, which ║
 * ║  is far more damaging than the lost contact.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ TOKENS ARE DERIVED, NOT STORED. An HMAC over the identifiers needs no
 * table, cannot be exhausted, and cannot leak a list of who was mailed if the
 * database is read. The trade-off — no per-token revocation — does not matter
 * here, because the action is idempotent: unsubscribing twice is unsubscribing.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const VERSION = 'u1'

/**
 * ⚠️ ITS OWN SECRET, NOT the integration encryption key. Unsubscribe tokens
 * travel in the body of every marketing email, so they are the most widely
 * distributed secret-derived value in the product. Deriving them from the key
 * that also protects mailbox CREDENTIALS would mean one leaked token gives an
 * attacker material to attack far more valuable secrets.
 *
 * Falls back to the integration key only so a misconfigured install still
 * functions — but it warns, because rotating one would then break the other.
 */
function secret(): Buffer {
  const dedicated = process.env.UNSUBSCRIBE_TOKEN_SECRET?.trim()
  if (dedicated) return Buffer.from(dedicated, 'utf8')

  const fallback = process.env.INTEGRATION_ENCRYPTION_KEY?.trim()
  if (fallback) {
    console.warn(
      'UNSUBSCRIBE_TOKEN_SECRET is not set; falling back to INTEGRATION_ENCRYPTION_KEY. Set a dedicated secret: rotating the encryption key would otherwise invalidate every unsubscribe link already sitting in recipients’ inboxes.',
    )
    return Buffer.from(fallback, 'utf8')
  }

  throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not configured.')
}

export type UnsubscribeSubject = {
  workspaceId: string
  /** Lowercased address. The person, not the contact row. */
  email: string
  /** Null unsubscribes from everything rather than one campaign. */
  campaignId: string | null
}

function payloadOf(subject: UnsubscribeSubject): string {
  return [
    VERSION,
    subject.workspaceId,
    subject.email.trim().toLowerCase(),
    subject.campaignId ?? 'all',
  ].join(':')
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** A token safe to put in a URL and an email header. */
export function createUnsubscribeToken(subject: UnsubscribeSubject): string {
  const payload = payloadOf(subject)
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload)}`
}

export type VerifiedToken =
  | { valid: true; subject: UnsubscribeSubject }
  | { valid: false; reason: string }

/**
 * Verifies a token.
 *
 * ⚠️ CONSTANT-TIME COMPARISON. A naive `===` leaks, through timing, how many
 * leading bytes of a guess were right, which turns forging a token into a
 * byte-at-a-time search rather than a 2^256 one.
 */
export function verifyUnsubscribeToken(token: string): VerifiedToken {
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra !== undefined) {
    return { valid: false, reason: 'malformed' }
  }

  let payload: string
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return { valid: false, reason: 'malformed' }
  }

  const expected = Buffer.from(sign(payload), 'utf8')
  const provided = Buffer.from(signature, 'utf8')

  // `timingSafeEqual` throws on a length mismatch, which is itself a signal —
  // so the length check comes first and returns the same generic answer.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { valid: false, reason: 'bad signature' }
  }

  const [version, workspaceId, email, campaignId] = payload.split(':')
  if (version !== VERSION || !workspaceId || !email) {
    return { valid: false, reason: 'malformed' }
  }

  return {
    valid: true,
    subject: {
      workspaceId,
      email,
      campaignId: campaignId === 'all' || !campaignId ? null : campaignId,
    },
  }
}

/**
 * The headers RFC 8058 requires for one-click unsubscribe.
 *
 * ⚠️ BOTH HEADERS ARE REQUIRED, AND `List-Unsubscribe-Post` IS THE ONE PEOPLE
 * FORGET. Without it, Gmail treats the link as an ordinary URL and will not
 * show its native unsubscribe button — which is the entire point, since that
 * button is what recipients press INSTEAD of "report spam".
 */
export function unsubscribeHeaders(
  subject: UnsubscribeSubject,
  baseUrl: string,
): Record<string, string> {
  const token = createUnsubscribeToken(subject)
  const url = `${baseUrl.replace(/\/$/, '')}/u/${token}`

  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/** The visible footer link, for recipients who scroll rather than use the header. */
export function unsubscribeUrl(subject: UnsubscribeSubject, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/u/${createUnsubscribeToken(subject)}`
}
