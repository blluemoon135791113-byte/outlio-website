import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_GUARD_COOKIE = 'outlio_session_guard'
// Supabase rotates the short-lived access token using its durable refresh-token
// cookie. This guard adds inactivity and absolute limits without forcing a
// fresh password + MFA challenge every night or every week.
export const SESSION_IDLE_SECONDS = 30 * 24 * 60 * 60
export const SESSION_ABSOLUTE_SECONDS = 90 * 24 * 60 * 60

export type SessionGuard = {
  sessionId: string | null
  issuedAt: number
  activeAt: number
}

function secret(): string | null {
  return process.env.SESSION_GUARD_SECRET
    ?? process.env.TRIAL_IP_HASH_SECRET
    ?? null
}

function signature(payload: string, key: string): string {
  return createHmac('sha256', key).update(`outlio-session:${payload}`).digest('base64url')
}

export function createSessionGuard(
  nowSeconds = Math.floor(Date.now() / 1000),
  previous?: SessionGuard | number,
): string | null {
  const key = secret()
  if (!key) return null
  const issuedAt = typeof previous === 'number'
    ? previous
    : previous?.issuedAt ?? nowSeconds
  const sessionId = typeof previous === 'object' && previous.sessionId
    ? previous.sessionId
    : randomBytes(18).toString('base64url')
  const payload = `${sessionId}.${issuedAt}.${nowSeconds}`
  return `${payload}.${signature(payload, key)}`
}

export function readSessionGuard(value: string | null | undefined): SessionGuard | null {
  const key = secret()
  if (!key || !value) return null
  const parts = value.split('.')
  // Accept the former timestamp-only cookie once so existing users are
  // upgraded in place instead of being signed out during deployment.
  const legacy = parts.length === 3
  const [sessionId, issuedRaw, activeRaw, supplied] = legacy
    ? [null, parts[0], parts[1], parts[2]]
    : parts
  const issuedAt = Number(issuedRaw)
  const activeAt = Number(activeRaw)
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(activeAt) || !supplied) return null
  if (!legacy && (!sessionId || !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId))) return null
  const payload = legacy
    ? `${issuedRaw}.${activeRaw}`
    : `${sessionId}.${issuedRaw}.${activeRaw}`
  const expected = signature(payload, key)
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { sessionId, issuedAt, activeAt }
}

export function sessionGuardExpired(guard: SessionGuard, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return nowSeconds - guard.activeAt > SESSION_IDLE_SECONDS
    || nowSeconds - guard.issuedAt > SESSION_ABSOLUTE_SECONDS
    || guard.activeAt > nowSeconds + 60
    || guard.issuedAt > guard.activeAt
}
