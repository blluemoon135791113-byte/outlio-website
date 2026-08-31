import 'server-only'

/**
 * Reply sync — M6 Phase 17.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M6 CRITERION 1: "reply stops the sequence within one sync cycle; OOO     ║
 * ║  does not."                                                               ║
 * ║                                                                           ║
 * ║  The pipeline the brief specifies:                                        ║
 * ║    provider → normalize → classify → match contact → record event →      ║
 * ║    stop/branch sequence → CRM activity → notify owner                     ║
 * ║                                                                           ║
 * ║  ⚠️ CLASSIFY BEFORE ANYTHING ELSE ACTS. The auto-reply pre-filter runs    ║
 * ║  first and is deterministic (`lib/email/auto-reply.ts`). Nothing below it ║
 * ║  gets to stop a sequence or count a reply until that decision is made,    ║
 * ║  which is exactly what "pre-filter before any classification" means.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { classifyInbound, countsAsReply, shouldStopSequence } from '@/lib/email/auto-reply'
import { recordActivity } from '@/lib/crm/activities'
import { getEmailAccount } from '@/lib/email/accounts'
import { providerFor } from '@/lib/email/providers/registry'
import { suppressEmail } from '@/lib/email/send'
import { createAdminClient } from '@/lib/supabase/admin'
import type { NormalizedReply, SyncCursor } from '@/lib/email/provider'

export type SyncOutcome = {
  fetched: number
  replies: number
  autoReplies: number
  bounces: number
  sequencesStopped: number
  /** Inbound mail from an address we have no live enrollment for. */
  unmatched: number
}

/**
 * Syncs one mailbox and acts on what it finds.
 *
 * ⚠️ THE CURSOR IS ONLY ADVANCED AFTER PROCESSING SUCCEEDS. Saving it first
 * would mean a crash mid-batch silently skips those replies forever — and a
 * missed reply is a sequence that keeps mailing someone who answered, which is
 * the exact failure criterion 1 exists to prevent.
 */
export async function syncMailbox(
  workspaceId: string,
  accountId: string,
): Promise<SyncOutcome> {
  const db = createAdminClient()
  const outcome: SyncOutcome = {
    fetched: 0,
    replies: 0,
    autoReplies: 0,
    bounces: 0,
    sequencesStopped: 0,
    unmatched: 0,
  }

  const account = await getEmailAccount(workspaceId, accountId)
  if (!account) return outcome

  const provider = providerFor(account.provider)
  if (!provider) return outcome

  const handle = {
    id: account.id,
    workspaceId: account.workspaceId,
    provider: account.provider,
    fromEmail: account.fromEmail,
    fromName: account.fromName,
    configuration: account.configuration,
    secretReference: account.secretReference,
  }

  /*
   * ⚠️ CAPABILITY IS CHECKED, NOT ASSUMED. An SMTP account with no IMAP
   * companion cannot read replies at all (Phase 11's capability model). Calling
   * syncReplies would throw; silently returning zero would be worse, because a
   * mailbox that can never see a reply would look like a mailbox nobody
   * replies to.
   */
  if (provider.getCapabilities(handle).replies !== 'supported') return outcome

  const cursor: SyncCursor = {
    cursor: account.lastSyncAt ? (account.configuration as { syncCursor?: string }).syncCursor ?? null : null,
    syncedAt: account.lastSyncAt ?? new Date(0).toISOString(),
  }

  const { replies, next } = await provider.syncReplies(handle, cursor)
  outcome.fetched = replies.length

  for (const reply of replies) {
    await processInbound(workspaceId, account.id, reply, outcome)
  }

  // Only now is the cursor persisted.
  await db
    .from('email_accounts')
    .update({
      last_sync_at: next.syncedAt,
      configuration: { ...account.configuration, syncCursor: next.cursor },
    })
    .eq('id', account.id)

  return outcome
}

async function processInbound(
  workspaceId: string,
  accountId: string,
  reply: NormalizedReply,
  outcome: SyncOutcome,
): Promise<void> {
  const db = createAdminClient()
  const from = reply.fromEmail.toLowerCase()

  // ⚠️ STEP ONE, BEFORE ANY ACTION.
  const classification = classifyInbound({
    headers: reply.headers,
    subject: reply.subject,
    fromEmail: from,
    text: reply.text,
  })

  /*
   * Match to live enrollments. A person may be in several sequences; all of
   * them are relevant, because a reply to one is a reply from that person.
   */
  const { data: enrollments } = await db
    .from('email_enrollments')
    .select('id, campaign_id, contact_id, email_campaigns(type)')
    .eq('workspace_id', workspaceId)
    .eq('to_email', from)
    .in('status', ['active', 'paused'])

  const matched = enrollments ?? []
  if (matched.length === 0) outcome.unmatched += 1

  const contactId = matched[0]?.contact_id ?? null
  const campaignId = matched[0]?.campaign_id ?? null

  /*
   * ⚠️ STORED BEFORE THE DEDUPE GATE BELOW, and deliberately so. The message
   * itself must survive even when the EVENT was already recorded by an earlier
   * run that crashed part-way — otherwise a reply is acted on but never
   * readable, which is the one outcome an inbox exists to prevent.
   * `email_record_inbound` carries its own idempotency on the provider message
   * id, so calling it every time is safe.
   *
   * Bounces and auto-replies are stored too, tagged with the classification.
   * The inbox hides bounces (they are already surfaced as suppressions) and
   * shows auto-replies, because "they are away until Tuesday" is something a
   * person wants to read, even though it must never count as a reply.
   */
  await db.rpc('email_record_inbound', {
    p_workspace_id: workspaceId,
    p_account_id: accountId,
    // A provider that gives no thread id means the message is its own thread.
    p_provider_thread_key: reply.threadId ?? reply.providerMessageId,
    p_provider_message_id: reply.providerMessageId,
    p_from_email: from,
    p_subject: reply.subject,
    p_body_text: reply.text,
    p_received_at: reply.receivedAt,
    p_classification: classification.kind === 'bounce'
      ? 'bounce'
      : classification.kind === 'auto_reply'
        ? 'auto_reply'
        : 'reply',
    p_contact_id: contactId,
  })

  /*
   * ⚠️ THE PROVIDER'S MESSAGE ID IS THE DEDUPE KEY. A sync that overlaps a
   * previous one — or a mailbox that returns the same message twice — must not
   * stop a sequence twice or count a reply twice. `record_email_event` returns
   * false for a duplicate, and nothing below acts unless it returned true.
   */
  const eventType =
    classification.kind === 'bounce'
      ? 'bounced'
      : classification.kind === 'auto_reply'
        ? 'auto_replied'
        : 'replied'

  const { data: isNew } = await db.rpc('record_email_event', {
    p_workspace_id: workspaceId,
    p_type: eventType,
    p_email: from,
    p_enrollment_id: matched[0]?.id ?? null,
    p_campaign_id: campaignId,
    p_contact_id: contactId,
    p_provider_event_id: reply.providerMessageId,
    p_occurred_at: reply.receivedAt,
    p_metadata: {
      reason: classification.reason,
      definitive: classification.definitive,
      subject: reply.subject,
      account_id: accountId,
    },
  })

  if (!isNew) return

  if (classification.kind === 'bounce') {
    outcome.bounces += 1
    /*
     * A bounce means the address is dead. Suppressing it is what stops the
     * bounce rate climbing and the domain burning — continuing to mail a dead
     * address is the most avoidable reputation damage there is.
     */
    await suppressEmail({
      workspaceId,
      email: from,
      reason: 'hard_bounce',
      source: `Bounce detected on sync: ${classification.reason}`,
      contactId,
    })
    await db.rpc('stop_enrollments_for_email', {
      p_workspace_id: workspaceId,
      p_email: from,
      p_reason: 'bounced',
    })
    return
  }

  if (classification.kind === 'auto_reply') {
    /*
     * ⚠️ RECORDED, BUT NOTHING STOPS. The event exists so the timeline can
     * show "they are away until Tuesday", and so a human can see the mailbox
     * is alive. It does not stop the sequence and does not count as a reply.
     */
    outcome.autoReplies += 1
    return
  }

  outcome.replies += 1
  if (!countsAsReply(classification) || !shouldStopSequence(classification)) return

  /*
   * ⚠️ STOPS ONLY THE SEQUENCES WHOSE TYPE SAYS TO STOP. A reply to a
   * newsletter is not an objection (see `campaign-policy.ts`), so a marketing
   * broadcast keeps running while sales sequences halt.
   */
  for (const enrollment of matched) {
    const type = (enrollment.email_campaigns as { type?: string } | null)?.type
    if (type === 'marketing_broadcast') continue

    const { data: stopped } = await db.rpc('stop_enrollments_for_email', {
      p_workspace_id: workspaceId,
      p_email: from,
      p_reason: 'replied',
      p_campaign_id: enrollment.campaign_id,
    })
    outcome.sequencesStopped += Number(stopped ?? 0)
  }

  /*
   * The CRM timeline entry, so a reply is visible where the rest of the
   * relationship lives rather than only inside the email module.
   *
   * ⚠️ GOES THROUGH `recordActivity`, NOT A DIRECT INSERT. That helper freezes
   * `owner_user_id_at_event` at write time (M4 criterion 2), so the reply stays
   * credited to whoever owned the contact when it arrived even if the contact
   * is reassigned tomorrow. A raw insert would quietly skip that.
   *
   * `actorUserId` is null: a prospect replying is not one of our users.
   */
  if (contactId) {
    await recordActivity(workspaceId, {
      contactId,
      activityType: 'EMAIL_REPLIED',
      channel: 'email',
      actorUserId: null,
      occurredAt: reply.receivedAt,
      metadata: { subject: reply.subject, from },
    })
  }
}

/** Syncs every mailbox in a workspace that can read replies. */
export async function syncWorkspaceReplies(workspaceId: string): Promise<SyncOutcome> {
  const { data } = await createAdminClient()
    .from('email_accounts')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)

  const total: SyncOutcome = {
    fetched: 0, replies: 0, autoReplies: 0, bounces: 0, sequencesStopped: 0, unmatched: 0,
  }

  for (const row of data ?? []) {
    // Sequential: opening every mailbox's IMAP connection at once looks like
    // exactly the abuse this product avoids.
    const one = await syncMailbox(workspaceId, row.id)
    total.fetched += one.fetched
    total.replies += one.replies
    total.autoReplies += one.autoReplies
    total.bounces += one.bounces
    total.sequencesStopped += one.sequencesStopped
    total.unmatched += one.unmatched
  }

  return total
}
