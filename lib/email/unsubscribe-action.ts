import 'server-only'

/**
 * What an unsubscribe actually does — M6 Phase 17.
 *
 * M6 CRITERION 2: "unsubscribe link works one-click, **updates suppression,
 * stops applicable campaigns, records events**."
 *
 * All three, in that order, and all three matter:
 *   - Suppression stops FUTURE campaigns, including ones not yet created.
 *   - Stopping enrollments cancels mail already queued for this person.
 *   - The event is the audit trail — the answer to "prove they opted out".
 *
 * ⚠️ IDEMPOTENT. A recipient may press the button twice, a mail client may
 * retry the POST, and a link may be clicked months later. Every path here
 * tolerates repetition, because the alternative is an error page shown to
 * someone who is trying to opt out — and their next click is "report spam".
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { suppressEmail } from '@/lib/email/send'
import type { UnsubscribeSubject } from '@/lib/email/unsubscribe'

export async function recordUnsubscribe(subject: UnsubscribeSubject): Promise<void> {
  const db = createAdminClient()
  const email = subject.email.trim().toLowerCase()

  /*
   * ⚠️ SUPPRESSION IS WORKSPACE-WIDE EVEN WHEN THE TOKEN NAMES A CAMPAIGN.
   *
   * This is a deliberate choice against the narrower reading. Someone clicking
   * "unsubscribe" in a cold email is not saying "just this campaign, keep the
   * others coming" — they are saying stop. Honouring it narrowly would be
   * technically defensible and would obviously infuriate the recipient, who
   * would then mark the next one as spam. The campaign id is still recorded on
   * the event so reporting can attribute WHICH campaign lost them.
   */
  await suppressEmail({
    workspaceId: subject.workspaceId,
    email,
    reason: 'unsubscribed',
    source: subject.campaignId ? `One-click unsubscribe (campaign ${subject.campaignId})` : 'One-click unsubscribe',
  })

  // Stops live enrollments AND cancels their queued mail in one statement.
  await db.rpc('stop_enrollments_for_email', {
    p_workspace_id: subject.workspaceId,
    p_email: email,
    p_reason: 'unsubscribed',
  })

  /*
   * The audit trail. Recorded with no provider event id, so it is never
   * deduped against a provider's own unsubscribe notification — those are two
   * genuinely different observations of the same intent, and losing either
   * would weaken the record.
   */
  await db.rpc('record_email_event', {
    p_workspace_id: subject.workspaceId,
    p_type: 'unsubscribed',
    p_email: email,
    // `?? undefined`: the generated RPC signature takes an optional string,
    // and passing an explicit null is a different thing to omitting it.
    p_campaign_id: subject.campaignId ?? undefined,
    p_metadata: { source: 'one_click', rfc: '8058' },
  })
}
