import 'server-only'

/**
 * Workspace invitation tokens.
 *
 * The raw token is shown to the inviter ONCE, inside a link, and is never
 * stored. Only its SHA-256 goes to the database, exactly as a password would
 * be handled: a dump of `workspace_invitations` therefore yields no usable
 * invitation link.
 *
 * Unkeyed SHA-256 is the right primitive here, unlike the HMAC used for
 * extension refresh tokens. The input is 256 bits of CSPRNG output, so there
 * is no dictionary to attack and no secret to rotate — and a keyed hash would
 * make every outstanding invitation unredeemable the day that key changed.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Seven days.
 *
 * Long enough to survive a weekend and a holiday; short enough that a link
 * forwarded into a group chat a month ago is dead. Redemption additionally
 * requires the recipient's own verified email address, so expiry is the second
 * line of defence, not the first.
 */
export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60

const TOKEN_BYTES = 32

export type InvitationToken = {
  /** Goes in the link. Never stored, never logged. */
  token: string
  /** Goes in the database. */
  tokenHash: string
}

export function createInvitationToken(): InvitationToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashInvitationToken(token) }
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Cheap shape check before a lookup.
 *
 * 32 bytes of base64url is always 43 characters. Rejecting anything else means
 * a crawler hitting `/join/favicon.ico` never reaches the database, and keeps
 * the redemption rate limit for genuine attempts.
 */
export function isInvitationTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

/** Constant-time comparison, for callers that compare hashes themselves. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Emails are stored lowercased and trimmed so that an outstanding invitation
 * for `Sam@Example.com` cannot be duplicated as `sam@example.com`. The database
 * enforces the same rule with a CHECK constraint, so a caller that forgets this
 * fails loudly rather than creating a second live invite.
 */
export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function invitationExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_SECONDS * 1000)
}
