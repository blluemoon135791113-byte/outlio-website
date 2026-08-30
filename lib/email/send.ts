import 'server-only'

/**
 * The send worker — M5 Phase 14.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ORDER OF OPERATIONS IS THE GUARANTEE. Do not rearrange it.           ║
 * ║                                                                           ║
 * ║   1. CLAIM   — Postgres moves the row `queued` → `sending`, increments    ║
 * ║                attempts and suppresses do-not-contact recipients, all in  ║
 * ║                one statement under FOR UPDATE SKIP LOCKED.                ║
 * ║   2. SEND    — the provider is called at most once per claim.             ║
 * ║   3. RECORD  — `sending` → `sent` or `failed`.                            ║
 * ║                                                                           ║
 * ║  A worker killed between 2 and 3 leaves the row in `sending`. The reaper  ║
 * ║  moves it to `needs_verification` and NEVER back to `queued`, because we  ║
 * ║  cannot know whether the provider accepted it and SMTP gives us no way to ║
 * ║  ask. That is at-most-once, and it is deliberate: a duplicate cold email  ║
 * ║  costs a spam complaint and a domain's reputation, a missed one costs a   ║
 * ║  step the sequence will repeat anyway.                                    ║
 * ║                                                                           ║
 * ║  ⚠️ NEVER claim inside the send loop, and NEVER retry a claimed row       ║
 * ║  in-process. Both turn this into at-least-once without the provider-side  ║
 * ║  dedupe that would make it safe.                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { getEmailAccount } from '@/lib/email/accounts'
import { providerFor } from '@/lib/email/providers/registry'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  applyMinimumDelay,
  nextSendTime,
  UnusableScheduleError,
  type SendSchedule,
} from '@/lib/email/schedule'

export type EnqueueInput = {
  workspaceId: string
  accountId: string
  toEmail: string
  subject: string
  bodyText: string
  bodyHtml?: string | null
  contactId?: string | null
  /**
   * ⚠️ SUPPLIED BY THE CALLER, NEVER GENERATED HERE. Only the caller knows what
   * "the same message" means — flow step 3 for contact X in campaign Y. A key
   * invented inside this function would be unique on every call and would
   * therefore guarantee nothing.
   */
  idempotencyKey: string
  /** Overrides the schedule. Still clamped to the account's sending window. */
  scheduledAt?: Date
}

export type EnqueueResult =
  | { queued: true; messageId: string; scheduledAt: string }
  | { queued: false; reason: 'duplicate'; messageId: string }
  | { queued: false; reason: 'suppressed' }
  | { queued: false; reason: 'no_account' }
  | { queued: false; reason: 'unusable_schedule'; message: string }

function scheduleOf(account: {
  timezone: string
  sendWindowStart: string
  sendWindowEnd: string
  sendDays: number[]
}): SendSchedule {
  return {
    timezone: account.timezone,
    sendWindowStart: account.sendWindowStart,
    sendWindowEnd: account.sendWindowEnd,
    sendDays: account.sendDays,
  }
}

/**
 * Queues one message.
 *
 * ⚠️ SUPPRESSION IS CHECKED HERE *AND* INSIDE THE CLAIM. Here so the caller
 * gets an immediate, honest answer instead of a row that quietly dies later;
 * inside the claim because someone can unsubscribe in between. Neither check
 * makes the other redundant.
 */
export async function enqueueEmail(input: EnqueueInput): Promise<EnqueueResult> {
  const db = createAdminClient()
  const toEmail = input.toEmail.trim().toLowerCase()

  const account = await getEmailAccount(input.workspaceId, input.accountId)
  if (!account) return { queued: false, reason: 'no_account' }

  const { data: suppressed } = await db
    .from('email_suppressions')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('email', toEmail)
    .maybeSingle()

  if (suppressed) return { queued: false, reason: 'suppressed' }

  let scheduledAt: Date
  try {
    const candidate = input.scheduledAt ?? new Date()
    scheduledAt = account.lastSendAt
      ? applyMinimumDelay(
          scheduleOf(account),
          candidate,
          new Date(account.lastSendAt),
          account.minDelaySeconds,
        )
      : nextSendTime(scheduleOf(account), candidate)
  } catch (error) {
    if (error instanceof UnusableScheduleError) {
      return { queued: false, reason: 'unusable_schedule', message: error.message }
    }
    throw error
  }

  const { data, error } = await db
    .from('email_messages')
    .insert({
      workspace_id: input.workspaceId,
      account_id: input.accountId,
      contact_id: input.contactId ?? null,
      to_email: toEmail,
      subject: input.subject,
      body_text: input.bodyText,
      body_html: input.bodyHtml ?? null,
      idempotency_key: input.idempotencyKey,
      scheduled_at: scheduledAt.toISOString(),
    })
    .select('id, scheduled_at')
    .single()

  if (error) {
    // 23505 is the idempotency index doing its job: this exact message is
    // already queued or already sent. Returning the existing row makes the
    // caller's retry a no-op rather than an error it has to interpret.
    if (error.code === '23505') {
      const { data: existing } = await db
        .from('email_messages')
        .select('id')
        .eq('workspace_id', input.workspaceId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle()

      if (existing) return { queued: false, reason: 'duplicate', messageId: existing.id }
    }
    throw new Error(`enqueueEmail failed: ${error.message}`)
  }

  return { queued: true, messageId: data.id, scheduledAt: data.scheduled_at }
}

export type WorkerResult = {
  claimed: number
  sent: number
  failed: number
  /** Claimed but not sendable — no adapter, or the account went away. */
  skipped: number
}

/**
 * Claims a batch of due messages and sends them.
 *
 * @param claimedBy identifies the worker in the claim, so an abandoned claim
 *   can be traced to the process that dropped it.
 */
export async function runSendWorker(
  claimedBy: string,
  limit = 10,
  claimSeconds = 120,
): Promise<WorkerResult> {
  const db = createAdminClient()
  const result: WorkerResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 }

  const { data: claimed, error } = await db.rpc('claim_email_messages', {
    p_claimed_by: claimedBy,
    p_limit: limit,
    p_claim_seconds: claimSeconds,
  })

  if (error) throw new Error(`claim_email_messages failed: ${error.message}`)
  result.claimed = claimed?.length ?? 0

  for (const message of claimed ?? []) {
    const account = await getEmailAccount(message.workspace_id, message.account_id)

    if (!account) {
      await fail(db, message.message_id, 'ACCOUNT_MISSING', 'The sending mailbox no longer exists.')
      result.skipped += 1
      continue
    }

    const provider = providerFor(account.provider)
    if (!provider) {
      await fail(
        db,
        message.message_id,
        'PROVIDER_UNAVAILABLE',
        `Outlio cannot send from ${account.provider} mailboxes yet.`,
      )
      result.skipped += 1
      continue
    }

    /*
     * ⚠️ ONE PROVIDER CALL PER CLAIM, AND NO IN-PROCESS RETRY. Retrying here
     * after an ambiguous failure — a timeout, a dropped socket — is exactly
     * how a duplicate is sent: the first attempt may well have been accepted.
     * A retryable failure goes back to `queued` for a LATER claim only when
     * the provider told us plainly that nothing was sent.
     */
    const outcome = await provider.send(
      {
        id: account.id,
        workspaceId: account.workspaceId,
        provider: account.provider,
        fromEmail: account.fromEmail,
        fromName: account.fromName,
        configuration: account.configuration,
        secretReference: account.secretReference,
      },
      {
        to: message.to_email,
        subject: message.subject,
        text: message.body_text,
        html: message.body_html,
        replyTo: account.replyToEmail ?? undefined,
        threadId: message.thread_id ?? undefined,
        idempotencyKey: message.idempotency_key,
      },
    )

    if (outcome.ok) {
      const sentAt = new Date().toISOString()
      await db
        .from('email_messages')
        .update({
          status: 'sent',
          sent_at: sentAt,
          provider_message_id: outcome.providerMessageId,
          thread_id: outcome.threadId,
          claimed_by: null,
          claim_expires_at: null,
        })
        .eq('id', message.message_id)

      // Drives the minimum-delay pacing for the next message on this mailbox.
      await db
        .from('email_accounts')
        .update({ last_send_at: sentAt })
        .eq('id', account.id)

      result.sent += 1
      continue
    }

    if (outcome.retryable && message.attempts < 3) {
      /*
       * Back to the queue with a backoff. Safe ONLY because `classifySmtpError`
       * marks a failure retryable when the server refused or was unreachable —
       * cases where nothing was accepted. An ambiguous outcome is not retryable
       * and must not be made one.
       */
      const backoffMinutes = 2 ** message.attempts
      await db
        .from('email_messages')
        .update({
          status: 'queued',
          scheduled_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
          error_code: outcome.code,
          error_message: outcome.message,
          claimed_by: null,
          claim_expires_at: null,
        })
        .eq('id', message.message_id)

      result.failed += 1
      continue
    }

    await fail(db, message.message_id, outcome.code, outcome.message)
    result.failed += 1
  }

  return result
}

async function fail(
  db: ReturnType<typeof createAdminClient>,
  messageId: string,
  code: string,
  message: string,
): Promise<void> {
  await db
    .from('email_messages')
    .update({
      status: 'failed',
      error_code: code,
      error_message: message,
      claimed_by: null,
      claim_expires_at: null,
    })
    .eq('id', messageId)
}

/**
 * Moves abandoned claims out of the queue.
 *
 * ⚠️ RUN THIS ON A SCHEDULE, NOT ONLY AT STARTUP. A message stuck in `sending`
 * is invisible in every report until it is reaped, so a worker that crashes
 * and never restarts would leave it hidden indefinitely.
 */
export async function reapExpiredClaims(): Promise<number> {
  const { data, error } = await createAdminClient().rpc('reap_expired_email_claims')
  if (error) throw new Error(`reap_expired_email_claims failed: ${error.message}`)
  return data ?? 0
}

/** Adds an address to the do-not-contact list. Idempotent by design. */
export async function suppressEmail(input: {
  workspaceId: string
  email: string
  reason: 'unsubscribed' | 'hard_bounce' | 'complaint' | 'manual' | 'invalid_address'
  source?: string | null
  contactId?: string | null
  createdBy?: string | null
}): Promise<void> {
  const { error } = await createAdminClient()
    .from('email_suppressions')
    .upsert(
      {
        workspace_id: input.workspaceId,
        email: input.email.trim().toLowerCase(),
        reason: input.reason,
        source: input.source ?? null,
        contact_id: input.contactId ?? null,
        created_by: input.createdBy ?? null,
      },
      // ⚠️ The FIRST reason wins. If someone unsubscribed and later hard
      // bounced, "unsubscribed" is the fact that matters — it is a stated
      // wish, not a delivery accident, and overwriting it would lose consent
      // provenance.
      { onConflict: 'workspace_id,email', ignoreDuplicates: true },
    )

  if (error) throw new Error(`suppressEmail failed: ${error.message}`)
}
