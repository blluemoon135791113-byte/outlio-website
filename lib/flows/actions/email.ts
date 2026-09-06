import 'server-only'

/**
 * Email actions in flows — M7 Phase 21.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `SEND_EMAIL` IS THE ONLY IRREVERSIBLE ACTION IN THE CATALOGUE.           ║
 * ║                                                                           ║
 * ║  Every other flow action can be undone. An email cannot be unsent, and a  ║
 * ║  flow can fire it thousands of times before anyone looks. So it passes    ║
 * ║  through the six-condition gate (`lib/flows/send-gate.ts`) every single   ║
 * ║  time, and a refusal it cannot evaluate is treated as a refusal.          ║
 * ║                                                                           ║
 * ║  ⚠️ THE SEND ITSELF STILL GOES THROUGH `enqueueEmail`. The flow does not  ║
 * ║  get a private path to the SMTP layer: it queues like everything else,    ║
 * ║  which means it inherits suppression re-checking at claim time, the ramp, ║
 * ║  the sending window, and at-most-once delivery. A second send path would  ║
 * ║  be a second set of guarantees to keep in step, and they would drift.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { bulkEnroll } from '@/lib/email/enrollment'
import { isAccountSendable } from '@/lib/email/readiness-runner'
import { checkRampAllowance } from '@/lib/email/ramp'
import { rampSettingsOf, todayIn } from '@/lib/email/readiness-runner'
import { getEmailAccount } from '@/lib/email/accounts'
import { enqueueEmail } from '@/lib/email/send'
import { renderTemplate, contextFor } from '@/lib/email/template'
import { checkSendGate, isTransient, type SendGateFacts } from '@/lib/flows/send-gate'
import { registerAction, type ActionHandler, type ActionResult } from '@/lib/flows/engine'
import { createAdminClient } from '@/lib/supabase/admin'

const ok = (output: Record<string, string | number | boolean | null> = {}): ActionResult => ({
  ok: true,
  output,
})

const fail = (code: string, message: string, retryable = false): ActionResult => ({
  ok: false,
  code,
  message,
  retryable,
})

function str(config: Record<string, unknown>, key: string): string | null {
  const value = config[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// ---------------------------------------------------------------------------
// Sequence controls
// ---------------------------------------------------------------------------

const enrollSequence: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact to enrol.')

  const campaignId = str(config, 'campaignId')
  if (!campaignId) return fail('NO_CAMPAIGN', 'This step has no campaign configured.')

  /*
   * ⚠️ GOES THROUGH `bulkEnroll`, which applies suppression, collision and
   * campaign-policy checks. A flow enrolling directly would bypass all three
   * and quietly mail someone who unsubscribed.
   */
  const result = await bulkEnroll({
    workspaceId: ctx.workspaceId,
    campaignId,
    contactIds: [ctx.contactId],
    actorUserId: str(config, 'actorUserId') ?? ctx.runId,
    // A flow cannot "confirm" a collision on a human's behalf; if the contact
    // belongs to a teammate, the enrolment is skipped and says so.
    acknowledgeCollisions: false,
  })

  if (result.enrolled === 1) return ok({ enrolled: true, campaignId })

  const outcome = result.outcomes[0]
  const detail = outcome && !outcome.enrolled ? outcome.detail : 'Could not enrol this contact.'
  // Not a failure of the flow: a skipped enrolment is a legitimate outcome
  // that the run should continue past, recorded with its reason.
  return ok({ enrolled: false, campaignId, skipped: detail })
}

/** Stops a contact's live enrolment in one campaign. */
const removeSequence: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const campaignId = str(config, 'campaignId')
  if (!campaignId) return fail('NO_CAMPAIGN', 'This step has no campaign configured.')

  const db = createAdminClient()
  const { data: enrollment } = await db
    .from('email_enrollments')
    .select('id, to_email')
    .eq('workspace_id', ctx.workspaceId)
    .eq('campaign_id', campaignId)
    .eq('contact_id', ctx.contactId)
    .in('status', ['active', 'paused'])
    .maybeSingle()

  if (!enrollment) return ok({ removed: false })

  /*
   * ⚠️ USES `stop_enrollments_for_email`, which also CANCELS QUEUED MAIL.
   * Marking the enrollment stopped without that would still deliver whatever
   * is already sitting in the queue.
   */
  await db.rpc('stop_enrollments_for_email', {
    p_workspace_id: ctx.workspaceId,
    p_email: enrollment.to_email,
    p_reason: 'manual',
    p_campaign_id: campaignId,
  })

  return ok({ removed: true, campaignId })
}

function setEnrollmentStatus(target: 'paused' | 'active'): ActionHandler {
  return async (ctx, config) => {
    if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

    const campaignId = str(config, 'campaignId')
    if (!campaignId) return fail('NO_CAMPAIGN', 'This step has no campaign configured.')

    const db = createAdminClient()
    const { data, error } = await db
      .from('email_enrollments')
      .update({ status: target })
      .eq('workspace_id', ctx.workspaceId)
      .eq('campaign_id', campaignId)
      .eq('contact_id', ctx.contactId)
      // Only a live enrollment can be paused or resumed. A STOPPED one must
      // stay stopped: resuming someone who replied or unsubscribed would
      // restart mail they already ended.
      .in('status', target === 'paused' ? ['active'] : ['paused'])
      .select('id')

    if (error) return fail('SEQUENCE_FAILED', 'Could not change this enrolment.', true)
    return ok({ changed: (data?.length ?? 0) > 0, status: target })
  }
}

const createEmailTask: ActionHandler = async (ctx, config) => {
  if (!ctx.contactId) return fail('NO_CONTACT', 'This step needs a contact.')

  const { data, error } = await createAdminClient()
    .from('crm_tasks')
    .insert({
      workspace_id: ctx.workspaceId,
      contact_id: ctx.contactId,
      title: str(config, 'title') ?? 'Send an email',
      assigned_to_user_id: str(config, 'assignTo'),
      due_at: new Date(Date.now() + Number(config.dueInHours ?? 24) * 3_600_000).toISOString(),
      status: 'open',
    })
    .select('id')
    .single()

  if (error) return fail('TASK_FAILED', 'Could not create the email task.', true)
  return ok({ taskId: data.id })
}

// ---------------------------------------------------------------------------
// SEND_EMAIL — the guarded one
// ---------------------------------------------------------------------------

/**
 * Gathers the six facts, then decides.
 *
 * ⚠️ EVERY FACT IS FETCHED EVEN WHEN AN EARLIER ONE ALREADY FAILS. It costs a
 * few reads and means the recorded step output explains the whole situation,
 * rather than the first thing that happened to be wrong — which is what an
 * operator needs when a flow stops sending overnight.
 */
async function gatherSendFacts(
  workspaceId: string,
  contactId: string | null,
  accountId: string | null,
  actorAuthorized: boolean,
): Promise<SendGateFacts> {
  const db = createAdminClient()

  let recipientEmail: string | null = null
  if (contactId) {
    const { data } = await db
      .from('crm_contact_emails')
      .select('address, is_primary')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .order('is_primary', { ascending: false })
      .order('address', { ascending: true })
      .limit(1)
      .maybeSingle()
    recipientEmail = data?.address ?? null
  }

  let suppressed = false
  let suppressionReason: string | null = null
  if (recipientEmail) {
    const { data } = await db
      .from('email_suppressions')
      .select('reason')
      .eq('workspace_id', workspaceId)
      .eq('email', recipientEmail)
      .maybeSingle()
    suppressed = Boolean(data)
    suppressionReason = data?.reason ?? null
  }

  const account = accountId ? await getEmailAccount(workspaceId, accountId) : null

  let accountHealthy = false
  let accountBlockedReason: string | null = null
  let remainingToday = 0

  if (account) {
    const gate = await isAccountSendable(workspaceId, account.id)
    accountHealthy = gate.sendable
    accountBlockedReason = gate.reason

    const { data: sentToday } = await db.rpc('email_sent_today', {
      p_account_id: account.id,
      p_timezone: account.timezone,
    })

    const allowance = checkRampAllowance(
      rampSettingsOf(account),
      Number(sentToday ?? 0),
      todayIn(account.timezone),
    )
    remainingToday = allowance.allowed ? allowance.remaining : 0
  }

  return {
    accountConnected: Boolean(account) && account!.status !== 'disconnected',
    accountHealthy,
    accountBlockedReason,
    recipientEmail,
    suppressed,
    suppressionReason,
    remainingToday,
    actorAuthorized,
    // Eligibility beyond suppression is campaign-level in M6; at flow level a
    // contact with an address that is not suppressed is eligible.
    recipientEligible: Boolean(recipientEmail),
  }
}

const sendEmail: ActionHandler = async (ctx, config) => {
  const accountId = str(config, 'accountId')
  const subjectTemplate = str(config, 'subject')
  const bodyTemplate = str(config, 'body')

  if (!subjectTemplate || !bodyTemplate) {
    return fail('NO_CONTENT', 'This send step has no subject or body.')
  }

  /*
   * ⚠️ AUTHORIZATION IS PASSED IN, NOT ASSUMED. A flow runs unattended, so the
   * permission belongs to whoever published it. `false` when absent, because
   * this gate fails closed.
   */
  const actorAuthorized = config.actorAuthorized === true

  const facts = await gatherSendFacts(ctx.workspaceId, ctx.contactId, accountId, actorAuthorized)
  const gate = checkSendGate(facts)

  if (!gate.allowed) {
    /*
     * ⚠️ A TRANSIENT REFUSAL IS RETRYABLE; A PERMANENT ONE IS NOT. A daily
     * limit clears overnight, so the run should come back. A suppression never
     * clears, and retrying would park a run forever on something that can
     * never become true.
     */
    return fail(gate.failure.toUpperCase(), gate.reason, isTransient(gate.failure))
  }

  // Render against the contact. A missing variable with no fallback refuses,
  // rather than mailing "Hi ,".
  const { data: contact } = await createAdminClient()
    .from('crm_contacts')
    .select('first_name, last_name, full_name, job_title')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', ctx.contactId!)
    .maybeSingle()

  const renderContext = contextFor({
    contact: {
      firstName: contact?.first_name,
      lastName: contact?.last_name,
      fullName: contact?.full_name,
      jobTitle: contact?.job_title,
    },
  })

  const subject = renderTemplate(subjectTemplate, renderContext)
  const body = renderTemplate(bodyTemplate, renderContext)

  if (!subject.ok || !body.ok) {
    const missing = [...(subject.ok ? [] : subject.missing), ...(body.ok ? [] : body.missing)]
    return fail(
      'MISSING_VARIABLES',
      `This contact has no ${[...new Set(missing)].join(', ')}. Give those variables a fallback, like {{first_name|there}}.`,
    )
  }

  /*
   * ⚠️ THE IDEMPOTENCY KEY IS THE RUN AND STEP. Two workers on the same run
   * cannot both queue this, and a retry after a crash finds the row already
   * there. This is what makes M7 criterion 1 hold for the one action where it
   * matters most.
   */
  const result = await enqueueEmail({
    workspaceId: ctx.workspaceId,
    accountId: accountId!,
    toEmail: gate.email,
    subject: subject.text,
    bodyText: body.text,
    contactId: ctx.contactId,
    idempotencyKey: `flow:${ctx.runId}:${String(config.__stepId ?? 'send')}`,
  })

  if (result.queued) return ok({ queued: true, messageId: result.messageId })

  if (result.reason === 'duplicate') {
    // Already queued by an earlier attempt of this same step. Success.
    return ok({ queued: false, alreadyQueued: true, messageId: result.messageId })
  }

  return fail(
    result.reason.toUpperCase(),
    'message' in result ? result.message : 'This message could not be queued.',
    result.reason === 'daily_limit',
  )
}

export function registerEmailActions(): void {
  registerAction('ENROLL_SEQUENCE', enrollSequence)
  registerAction('REMOVE_SEQUENCE', removeSequence)
  registerAction('PAUSE_SEQUENCE', setEnrollmentStatus('paused'))
  registerAction('RESUME_SEQUENCE', setEnrollmentStatus('active'))
  registerAction('CREATE_EMAIL_TASK', createEmailTask)
  registerAction('SEND_EMAIL', sendEmail)
}
