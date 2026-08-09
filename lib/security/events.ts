import 'server-only'

import { createHmac } from 'node:crypto'

import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

type SecurityEvent = {
  event: string
  level?: 'info' | 'warn' | 'error'
  userId?: string | null
  subject?: string | null
  context?: Record<string, Json | undefined>
}

/** Pseudonymises email/IP subjects before they enter durable security logs. */
export function securitySubject(value: string): string | null {
  const secret = process.env.SECURITY_LOG_HASH_SECRET ?? process.env.TRIAL_IP_HASH_SECRET
  if (!secret) return null
  return createHmac('sha256', secret).update(value).digest('hex')
}

/** Logging must never reveal credentials and must never break an auth flow. */
export async function recordSecurityEvent(input: SecurityEvent): Promise<void> {
  const context: Record<string, Json | undefined> = { ...input.context }
  if (input.subject) context.subject_hash = securitySubject(input.subject) ?? undefined

  try {
    await createAdminClient().from('system_events').insert({
      level: input.level ?? 'info',
      event: input.event,
      user_id: input.userId ?? null,
      context,
    })
  } catch {
    // Authentication availability is not coupled to telemetry availability.
  }
}
