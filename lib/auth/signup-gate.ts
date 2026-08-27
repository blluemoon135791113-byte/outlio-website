import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'

import { cookies, headers } from 'next/headers'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  hashSignupIdentity,
  hashTrialDeviceCookie,
  TRIAL_DEVICE_COOKIE,
} from '@/lib/auth/trial-device'

const RESERVATION_SECONDS = 10 * 60

export type SignupReservation = {
  attemptHash: string
  token: string
  tokenHash: string
}

export type SignupReservationResult =
  | { status: 'reserved'; reservation: SignupReservation }
  | { status: 'unavailable' }

export type SignupSecurityClaims = {
  deviceHash: string
  emailHash: string
  phoneHash: string
  linkedinHash: string
}

/**
 * Canonicalize an address before hashing so alternate IPv6 spellings cannot
 * turn one network into multiple trial identities.
 */
export function normalizeClientIp(value: string | null): string | null {
  if (!value) return null

  let candidate = value.split(',')[0]?.trim().replace(/^"|"$/g, '') ?? ''
  if (!candidate) return null

  const bracketed = candidate.match(/^\[([^\]]+)](?::\d+)?$/)
  if (bracketed?.[1]) candidate = bracketed[1]

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (ipv4WithPort?.[1]) candidate = ipv4WithPort[1]

  if (candidate.toLowerCase().startsWith('::ffff:')) {
    const mapped = candidate.slice(7)
    if (isIP(mapped) === 4) return mapped
  }

  const version = isIP(candidate)
  if (version === 4) return candidate
  if (version !== 6 || candidate.includes('%')) return null

  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname
    return hostname.slice(1, -1).toLowerCase()
  } catch {
    return null
  }
}

/** Vercel's trusted forwarding header wins over generic proxy headers. */
export async function clientIp(): Promise<string | null> {
  const requestHeaders = await headers()
  const vercelIp = normalizeClientIp(requestHeaders.get('x-vercel-forwarded-for'))
  if (vercelIp) return vercelIp

  // On Vercel, never fall back to a generic header supplied by the caller.
  // Missing trusted metadata fails the signup gate closed instead of letting a
  // forged x-forwarded-for value mint another trial identity.
  if (process.env.VERCEL === '1') return null

  const forwardedIp = normalizeClientIp(requestHeaders.get('x-forwarded-for'))
  if (forwardedIp) return forwardedIp

  return normalizeClientIp(requestHeaders.get('x-real-ip'))
}

export function hashReservationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function signupSecurityClaims(input: {
  email: string
  phone: string
  linkedinUrl: string
}): Promise<SignupSecurityClaims | null> {
  const cookieStore = await cookies()
  const deviceHash = hashTrialDeviceCookie(
    cookieStore.get(TRIAL_DEVICE_COOKIE)?.value,
  )
  if (!deviceHash) return null

  try {
    return {
      deviceHash,
      emailHash: hashSignupIdentity('email', input.email),
      phoneHash: hashSignupIdentity('phone', input.phone),
      linkedinHash: hashSignupIdentity('linkedin', input.linkedinUrl),
    }
  } catch {
    return null
  }
}

/**
 * Reserve one server-authorized sign-up attempt before calling Supabase Auth.
 *
 * `signup_ip_claims.ip_hash` is retained as a legacy storage column so this
 * change can ship without a database cut-over. It now receives a random,
 * per-attempt identifier—not a network identity. Shared offices, households,
 * and VPN exits therefore never block each other, while the database trigger
 * still rejects direct or replayed Auth sign-ups.
 */
export async function reserveSignupAttempt(): Promise<SignupReservationResult> {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashReservationToken(token)
  const attemptHash = createHash('sha256')
    .update(`signup-attempt:${randomBytes(32).toString('base64url')}`)
    .digest('hex')
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('reserve_signup_ip', {
    p_ip_hash: attemptHash,
    p_token_hash: tokenHash,
    p_reservation_seconds: RESERVATION_SECONDS,
  })

  if (error) return { status: 'unavailable' }
  // A collision is cryptographically improbable; treating it as unavailable
  // gives the caller a safe retry without reviving a network-level block.
  if (!data) return { status: 'unavailable' }

  return {
    status: 'reserved',
    reservation: { attemptHash, token, tokenHash },
  }
}

/** Release only an unconsumed reservation after an ordinary sign-up failure. */
export async function releaseSignupAttempt(
  reservation: SignupReservation,
): Promise<void> {
  const admin = createAdminClient()
  await admin.rpc('release_signup_ip', {
    p_ip_hash: reservation.attemptHash,
    p_token_hash: reservation.tokenHash,
  })
}

/** Confirm that the auth trigger consumed every claim for this exact user. */
export async function signupClaimsWereClaimed(
  reservation: SignupReservation,
  userId: string,
  claims: SignupSecurityClaims,
): Promise<boolean> {
  const admin = createAdminClient()
  const [attempt, device, identities] = await Promise.all([
    admin
      .from('signup_ip_claims')
      .select('claimed_at')
      .eq('ip_hash', reservation.attemptHash)
      .eq('user_id', userId)
      .not('claimed_at', 'is', null)
      .maybeSingle(),
    admin
      .from('signup_device_claims')
      .select('claimed_at')
      .eq('device_hash', claims.deviceHash)
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('signup_identity_claims')
      .select('identity_hash')
      .eq('user_id', userId)
      .in('identity_hash', [
        claims.emailHash,
        claims.phoneHash,
        claims.linkedinHash,
      ]),
  ])

  return Boolean(
    !attempt.error &&
      attempt.data?.claimed_at &&
      !device.error &&
      device.data?.claimed_at &&
      !identities.error &&
      identities.data?.length === 3,
  )
}
