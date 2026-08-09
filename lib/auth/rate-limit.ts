import 'server-only'

import { createHmac } from 'node:crypto'

/**
 * Postgres-backed rate limiting.
 *
 * Chosen over Redis/Upstash for the same reasons as the job queue: transactional
 * with application data, no extra vendor, inspectable with SQL. See
 * docs/ARCHITECTURE.md §1.
 *
 * Counting happens in `consume_rate_limit`, a single atomic statement, so
 * concurrent attempts cannot both slip under the threshold.
 */
import { AppError } from '@/lib/errors/catalog'
import { createAdminClient } from '@/lib/supabase/admin'

export type RateLimitRule = {
  /** Logical bucket, e.g. 'auth:signin'. */
  bucket: string
  /** Attempts permitted per window. */
  maxAttempts: number
  /** Window length in seconds. */
  windowSeconds: number
  /** How long to block once the threshold trips. */
  blockSeconds: number
}

/**
 * Spec §8.3: 5 attempts / 15 min per IP+email on auth, exponential backoff.
 * These are policy, not plan limits — plan limits live in `plans.limits`.
 */
export const RULES = {
  signIn: {
    bucket: 'auth:signin',
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    blockSeconds: 15 * 60,
  },
  signUp: {
    bucket: 'auth:signup',
    maxAttempts: 5,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 60,
  },
  passwordReset: {
    bucket: 'auth:reset',
    maxAttempts: 5,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 60,
  },
  resendVerification: {
    bucket: 'auth:resend',
    maxAttempts: 3,
    windowSeconds: 60 * 60,
    blockSeconds: 60 * 60,
  },
} as const satisfies Record<string, RateLimitRule>

function windowStart(windowSeconds: number, now = Date.now()): Date {
  const ms = windowSeconds * 1000
  return new Date(Math.floor(now / ms) * ms)
}

export type RateLimitResult = {
  allowed: boolean
  attempts: number
  blockedUntil: Date | null
}

/**
 * Records an attempt and reports whether it is allowed.
 *
 * Fails CLOSED on infrastructure error. Authentication availability is less
 * important than allowing an unbounded brute-force window during an outage.
 */
export async function consume(
  rule: RateLimitRule,
  subject: string,
): Promise<RateLimitResult> {
  const supabase = createAdminClient()
  const start = windowStart(rule.windowSeconds)

  const { data, error } = await supabase.rpc('consume_rate_limit', {
    p_bucket: rule.bucket,
    p_subject: subject,
    p_window_start: start.toISOString(),
    p_max_attempts: rule.maxAttempts,
    p_block_seconds: rule.blockSeconds,
  })

  if (error) {
    return {
      allowed: false,
      attempts: rule.maxAttempts,
      blockedUntil: new Date(Date.now() + rule.blockSeconds * 1000),
    }
  }

  const row = Array.isArray(data) ? data[0] : null
  const attempts = row?.attempts ?? 0
  const blockedUntil = row?.blocked_until ? new Date(row.blocked_until) : null
  const allowed = !blockedUntil || blockedUntil.getTime() <= Date.now()

  return { allowed, attempts, blockedUntil }
}

/** Throws ERR_RATE_LIMITED when the caller is blocked. */
export async function enforce(
  rule: RateLimitRule,
  subject: string,
): Promise<void> {
  const result = await consume(rule, subject)
  if (!result.allowed) {
    throw new AppError(
      'ERR_RATE_LIMITED',
      `bucket=${rule.bucket} attempts=${result.attempts}`,
    )
  }
}

/**
 * Builds a rate-limit subject.
 *
 * Email is lowercased and included so one attacker cannot lock out an entire
 * shared IP, while still bounding per-account guessing.
 */
export function subjectFor(ip: string | null, email?: string | null): string {
  const parts = [`ip:${ip ?? 'unknown'}`]
  if (email) parts.push(`email:${email.trim().toLowerCase()}`)
  const secret = process.env.TRIAL_IP_HASH_SECRET
  if (!secret) throw new AppError('ERR_INTERNAL', 'Rate-limit hash secret is unavailable')
  return createHmac('sha256', secret).update(parts.join('|')).digest('hex')
}
