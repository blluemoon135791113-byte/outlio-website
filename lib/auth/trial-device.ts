import 'server-only'

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const TRIAL_DEVICE_COOKIE = 'outlio_trial_device'
export const TRIAL_DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 400

const MIN_HASH_SECRET_LENGTH = 32
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/

function trialSecret(secret?: string): string {
  const value = secret ?? process.env.TRIAL_IP_HASH_SECRET
  if (!value || value.length < MIN_HASH_SECRET_LENGTH) {
    throw new Error(
      `TRIAL_IP_HASH_SECRET must contain at least ${MIN_HASH_SECRET_LENGTH} characters`,
    )
  }
  return value
}

function hmac(namespace: string, value: string, secret?: string): string {
  return createHmac('sha256', trialSecret(secret))
    .update(`${namespace}:${value}`)
    .digest('hex')
}

/**
 * Issues a signed, pseudonymous first-party device token. The signature stops
 * callers from inventing arbitrary device identifiers without the server
 * secret. The raw identifier is never written to the database.
 */
export function createTrialDeviceCookie(secret?: string): string {
  const deviceId = randomBytes(24).toString('base64url')
  const signature = hmac('device-cookie', deviceId, secret)
  return `${deviceId}.${signature}`
}

export function trialDeviceId(
  cookieValue: string | undefined,
  secret?: string,
): string | null {
  if (!cookieValue || cookieValue.length > 128) return null
  const [deviceId, suppliedSignature, extra] = cookieValue.split('.')
  if (
    extra !== undefined ||
    !deviceId ||
    !suppliedSignature ||
    !DEVICE_ID_PATTERN.test(deviceId) ||
    !HEX_SHA256_PATTERN.test(suppliedSignature)
  ) {
    return null
  }

  let expectedSignature: string
  try {
    expectedSignature = hmac('device-cookie', deviceId, secret)
  } catch {
    return null
  }

  const supplied = Buffer.from(suppliedSignature, 'hex')
  const expected = Buffer.from(expectedSignature, 'hex')
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null
  }

  return deviceId
}

/** Returns a stable HMAC claim only for a valid server-signed cookie. */
export function hashTrialDeviceCookie(
  cookieValue: string | undefined,
  secret?: string,
): string | null {
  const deviceId = trialDeviceId(cookieValue, secret)
  return deviceId ? hmac('device-claim', deviceId, secret) : null
}

export type SignupIdentityKind = 'email' | 'phone' | 'linkedin'

/**
 * Persistent identity claims make changing IP or enabling a VPN insufficient
 * to obtain another trial. Inputs must already be normalized by the auth flow.
 */
export function hashSignupIdentity(
  kind: SignupIdentityKind,
  normalizedValue: string,
  secret?: string,
): string {
  if (!normalizedValue) throw new Error('Signup identity cannot be empty')
  return hmac(`identity-${kind}`, normalizedValue, secret)
}
