import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESSION_GUARD_COOKIE = 'outlio_session_guard'
export const SESSION_IDLE_SECONDS = 8 * 60 * 60
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60

type SessionGuard = { issuedAt: number; activeAt: number }

function secret(): string | null {
  return process.env.SESSION_GUARD_SECRET
    ?? process.env.TRIAL_IP_HASH_SECRET
    ?? null
}

function signature(payload: string, key: string): string {
  return createHmac('sha256', key).update(`outlio-session:${payload}`).digest('base64url')
}

export function createSessionGuard(nowSeconds = Math.floor(Date.now() / 1000), issuedAt = nowSeconds): string | null {
  const key = secret()
  if (!key) return null
  const payload = `${issuedAt}.${nowSeconds}`
  return `${payload}.${signature(payload, key)}`
}

export function readSessionGuard(value: string | null | undefined): SessionGuard | null {
  const key = secret()
  if (!key || !value) return null
  const [issuedRaw, activeRaw, supplied] = value.split('.')
  const issuedAt = Number(issuedRaw)
  const activeAt = Number(activeRaw)
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(activeAt) || !supplied) return null
  const expected = signature(`${issuedRaw}.${activeRaw}`, key)
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { issuedAt, activeAt }
}

export function sessionGuardExpired(guard: SessionGuard, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return nowSeconds - guard.activeAt > SESSION_IDLE_SECONDS
    || nowSeconds - guard.issuedAt > SESSION_ABSOLUTE_SECONDS
    || guard.activeAt > nowSeconds + 60
    || guard.issuedAt > guard.activeAt
}
