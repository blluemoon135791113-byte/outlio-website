import 'server-only'

/**
 * The worker that actually sends a sequence.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ UNTIL THIS FILE EXISTED, A LAUNCHED SALES SEQUENCE SENT NOTHING.      ║
 * ║                                                                           ║
 * ║  `email_sequence_steps` could be authored, a campaign set `running`, and  ║
 * ║  contacts enrolled — and no code path turned any of it into mail.         ║
 * ║  `enqueueEmail` had exactly two callers, a flow action and a manual       ║
 * ║  inbox reply. `next_action_at` was WRITTEN by `bulkEnroll` and by         ║
 * ║  `launchCampaign` and READ BY NOBODY.                                    ║
 * ║                                                                           ║
 * ║  Proven against production before this was written: a `running`           ║
 * ║  sales_sequence, an `active` enrollment, `wait_hours: 0`, and a full tick ║
 * ║  reported `send_email: 0 claimed, 0 sent`. One message had ever been      ║
 * ║  created in that database, by a manual `enqueueEmail` call.              ║
 * ║                                                                           ║
 * ║  ⚠️ `launchCampaign` TOLD THE USER "The first emails go out now."         ║
 * ║  That is the failure this repairs — not a worker missing a trigger, which ║
 * ║  the tick's own header describes, but a worker that was never written.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { enqueueEmail } from '@/lib/email/send'
import { contextFor, renderTemplate } from '@/lib/email/template'
import { createAdminClient } from '@/lib/supabase/admin'

export type SequenceOutcome = {
  /** Enrollments whose next step was due. */
  due: number
  queued: number
  /** Reached the end of the sequence. */
  completed: number
  /** Stopped because the address is suppressed. */
  stopped: number
  /** Left for a later tick — allowance, health or window, not an error. */
  deferred: number
  /** A step whose tokens cannot be filled for this contact. */
  unrenderable: number
  failed: number
}

type DueEnrollment = {
  id: string
  workspace_id: string
  campaign_id: string
  contact_id: string
  to_email: string
  current_step: number
}

/**
 * Enqueues the next due step for each active enrollment.
 *
 * ⚠️ ENQUEUES, IT DOES NOT SEND. `send_email` owns delivery, claiming and
 * retries. Sending here would duplicate that machinery and bypass the ramp,
 * the send window and the daily allowance, all of which `enqueueEmail`
 * enforces — the checks a sequence most needs and is most tempted to skip.
 */
export async function advanceSequences(limit = 50): Promise<SequenceOutcome> {
  const db = createAdminClient()
  const outcome: SequenceOutcome = {
    due: 0,
    queued: 0,
    completed: 0,
    stopped: 0,
    deferred: 0,
    unrenderable: 0,
    failed: 0,
  }

  /*
   * ⚠️ THE CAMPAIGN MUST STILL BE RUNNING. Pausing a campaign has to stop its
   * next step going out, and the enrollment's own status does not record that
   * — a paused campaign keeps `active` enrollments so it can resume.
   */
  const { data: due, error } = await db
    .from('email_enrollments')
    .select('id, workspace_id, campaign_id, contact_id, to_email, current_step, email_campaigns!inner(status, account_id)')
    .eq('status', 'active')
    .eq('email_campaigns.status', 'running')
    .not('next_action_at', 'is', null)
    .lte('next_action_at', new Date().toISOString())
    .order('next_action_at')
    .limit(limit)

  if (error) throw new Error(`advanceSequences failed: ${error.message}`)

  outcome.due = (due ?? []).length

  for (const row of (due ?? []) as unknown as (DueEnrollment & {
    email_campaigns: { status: string; account_id: string | null }
  })[]) {
    try {
      const accountId = row.email_campaigns?.account_id
      if (!accountId) {
        outcome.deferred += 1
        continue
      }

      const nextIndex = row.current_step + 1

      const { data: step } = await db
        .from('email_sequence_steps')
        .select('step_index, subject, body_text, body_html')
        .eq('campaign_id', row.campaign_id)
        .eq('step_index', nextIndex)
        .maybeSingle()

      // No step at that index means the sequence has run out — that is success.
      if (!step) {
        await db
          .from('email_enrollments')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            next_action_at: null,
          })
          .eq('id', row.id)
          .eq('status', 'active')
        outcome.completed += 1
        continue
      }

      /*
       * ⚠️ RENDERED PER CONTACT. A step is authored with tokens; sending the
       * raw template mails somebody a literal `{{first_name}}`, which is the
       * most visible possible way to look automated.
       */
      const { data: contact } = await db
        .from('crm_contacts')
        .select('full_name, job_title, crm_companies(name)')
        .eq('id', row.contact_id)
        .maybeSingle()

      const full = contact?.full_name ?? null
      const context = contextFor({
        contact: {
          fullName: full,
          firstName: full ? full.trim().split(/\s+/)[0] : null,
          lastName: full ? full.trim().split(/\s+/).slice(1).join(' ') || null : null,
          jobTitle: contact?.job_title ?? null,
          companyName:
            (contact?.crm_companies as unknown as { name?: string } | null)?.name ?? null,
        },
      })

      /*
       * ╔═══════════════════════════════════════════════════════════════════════╗
       * ║  ⚠️ A TOKEN THAT CANNOT BE FILLED REFUSES THE SEND. That is           ║
       * ║  `renderTemplate`'s deliberate contract, not an inconvenience: an     ║
       * ║  empty substitution mails "Hi ," — the most recognisable mass-mail    ║
       * ║  failure there is — and inventing a first name from an address is     ║
       * ║  forbidden outright by CLAUDE.md rule 4.                             ║
       * ║                                                                       ║
       * ║  ⚠️ NOT ADVANCED AND NOT STOPPED. The enrollment stays where it is,   ║
       * ║  so filling in the contact's name makes the next tick send it. The    ║
       * ║  count is reported separately from `deferred` because the fix is a    ║
       * ║  human editing data, not the mailbox waiting for capacity — and a     ║
       * ║  number that never moves is the only way anyone notices.             ║
       * ╚═══════════════════════════════════════════════════════════════════════╝
       */
      const rendered = {
        subject: renderTemplate(step.subject, context),
        text: renderTemplate(step.body_text, context),
        html: step.body_html ? renderTemplate(step.body_html, context, { html: true }) : null,
      }

      const missing = [
        ...(rendered.subject.ok ? [] : rendered.subject.missing),
        ...(rendered.text.ok ? [] : rendered.text.missing),
        ...(rendered.html && !rendered.html.ok ? rendered.html.missing : []),
      ]

      if (missing.length > 0) {
        console.warn('[sequences] step not sent — unfilled tokens', {
          enrollmentId: row.id,
          stepIndex: step.step_index,
          missing: [...new Set(missing)],
        })
        outcome.unrenderable += 1
        continue
      }

      const subject = rendered.subject.ok ? rendered.subject.text : ''
      const bodyText = rendered.text.ok ? rendered.text.text : ''
      const bodyHtml = rendered.html?.ok ? rendered.html.text : null

      /*
       * ⚠️ THE KEY IS (ENROLLMENT, STEP) AND NOTHING ELSE. It must be stable
       * across ticks, because this runs again every time and a key containing a
       * timestamp would send step 1 on every pass forever. `enqueueEmail`
       * dedupes on it, so a crash between enqueue and the update below costs a
       * duplicate row, not a duplicate email.
       */
      const result = await enqueueEmail({
        workspaceId: row.workspace_id,
        accountId,
        toEmail: row.to_email,
        subject,
        bodyText,
        bodyHtml,
        contactId: row.contact_id,
        idempotencyKey: `seq:${row.id}:${step.step_index}`,
      })

      if (result.queued === false && result.reason === 'suppressed') {
        await db
          .from('email_enrollments')
          .update({
            status: 'stopped',
            stopped_at: new Date().toISOString(),
            stop_reason: 'suppressed',
            next_action_at: null,
          })
          .eq('id', row.id)
        outcome.stopped += 1
        continue
      }

      /*
       * ⚠️ DEFERRED IS NOT FAILED, AND MUST NOT ADVANCE THE STEP. A daily
       * allowance, a closed send window or an unhealthy mailbox are all "not
       * yet". Advancing `current_step` here would skip the step permanently —
       * the person never receives it and nothing reports that they did not.
       */
      if (result.queued === false && result.reason !== 'duplicate') {
        outcome.deferred += 1
        continue
      }

      // Queued, or already queued by an earlier interrupted run. Both advance.
      const { data: following } = await db
        .from('email_sequence_steps')
        .select('wait_hours')
        .eq('campaign_id', row.campaign_id)
        .eq('step_index', nextIndex + 1)
        .maybeSingle()

      /*
       * `next_action_at` is when the FOLLOWING step becomes due, measured from
       * now. Null when there is no following step: the enrollment completes on
       * the next pass rather than being polled forever.
       */
      const nextAt = following
        ? new Date(Date.now() + Math.max(0, following.wait_hours) * 3_600_000).toISOString()
        : new Date().toISOString()

      await db
        .from('email_enrollments')
        .update({
          current_step: step.step_index,
          last_sent_at: new Date().toISOString(),
          next_action_at: nextAt,
        })
        .eq('id', row.id)
        .eq('status', 'active')

      outcome.queued += 1
    } catch (error) {
      // One bad enrollment must not stop the rest of the campaign.
      console.error('[sequences] enrollment failed', {
        enrollmentId: row.id,
        message: error instanceof Error ? error.message : 'failed',
      })
      outcome.failed += 1
    }
  }

  return outcome
}
