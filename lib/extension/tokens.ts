import 'server-only'

/**
 * Extension token minting and verification.
 *
 * Two token types, deliberately different shapes:
 *
 *   ACCESS   short lived (15 min), stateless, carries user + device + jti.
 *            Verified by signature, then checked against the device row so a
 *            revoked device cannot keep using an unexpired token.
 *   REFRESH  opaque random bytes, 30 days, ROTATED on every use. Stored only
 *            as a keyed hash, so a database disclosure yields nothing usable.
 *
 * Format follows `lib/auth/session-guard.ts` — `payload.signature`, base64url,
 * HMAC-SHA256 — rather than pulling in a JWT dependency for the same thing.
 *
 * ⚠️ Everything here runs server-side only. The extension receives tokens; it
 * never receives the secret that makes them.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
export const PAIRING_CODE_TTL_SECONDS = 60

export type AccessTokenClaims = {
  /** User id. */
  sub: string
  /** Device id. */
  did: string
  /** Token id, matched against extension_devices.access_token_jti. */
  jti: string
  /** Issued at, epoch seconds. */
  iat: number
  /** Expires at, epoch seconds. */
  exp: number
}

/**
 * Signing key.
 *
 * Falls back the same way `session-guard.ts` does, so the feature works
 * without new environment configuration. Set EXTENSION_TOKEN_SECRET to give
 * extension tokens their own key — preferred, because rotating it should not
 * invalidate web sessions or trial claims.
 */
function secret(): string | null {
  return (
    process.env.EXTENSION_TOKEN_SECRET
    ?? process.env.SESSION_GUARD_SECRET
    ?? process.env.TRIAL_IP_HASH_SECRET
    ?? null
  )
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(`outlio-extension:${payload}`).digest('base64url')
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Keyed hash for anything stored at rest.
 *
 * Keyed, not plain SHA-256: an attacker with the table but not the key cannot
 * test candidate tokens offline.
 */
export function hashToken(token: string): string | null {
  const key = secret()
  if (!key) return null
  return createHmac('sha256', key).update(`outlio-extension-store:${token}`).digest('hex')
}

export function mintAccessToken(
  userId: string,
  deviceId: string,
  jti: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const key = secret()
  if (!key) return null

  const claims: AccessTokenClaims = {
    sub: userId,
    did: deviceId,
    jti,
    iat: nowSeconds,
    exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
  }

  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload, key)}`
}

/**
 * Verifies signature and expiry only.
 *
 * ⚠️ A valid signature is NOT authorisation. The caller must still load the
 * device row and confirm the jti, that the device is enabled, and that the
 * user's subscription is active — see `lib/extension/auth.ts`.
 */
export function verifyAccessToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): AccessTokenClaims | null {
  const key = secret()
  if (!key) return null

  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [payload, signature] = parts
  if (!payload || !signature) return null
  if (!safeEqual(signature, sign(payload, key))) return null

  let claims: AccessTokenClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessTokenClaims
  } catch {
    return null
  }

  if (
    typeof claims.sub !== 'string'
    || typeof claims.did !== 'string'
    || typeof claims.jti !== 'string'
    || typeof claims.exp !== 'number'
  ) {
    return null
  }

  if (claims.exp <= nowSeconds) return null

  return claims
}

/** Opaque refresh token. Returned once, then only ever stored hashed. */
export function mintRefreshToken(): string {
  return randomBytes(32).toString('base64url')
}

/** One-time pairing code, exchanged for a token pair within 60 seconds. */
export function mintPairingCode(): string {
  return randomBytes(24).toString('base64url')
}

/** Reads a bearer token from an Authorization header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}
