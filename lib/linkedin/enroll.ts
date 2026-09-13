import 'server-only'

/**
 * Putting a contact into a LinkedIn sequence, and preparing their first card.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ ENROLLING IS NOT CONTACTING. Nothing is sent here and nothing ever     ║
 * ║  will be — CLAUDE.md rule 1. This creates an enrollment row and a PENDING  ║
 * ║  card. A human releases it, performs the action in LinkedIn themselves,    ║
 * ║  and comes back to say what they did.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE MESSAGE IS RENDERED AT ENROLLMENT, NOT AT RELEASE, and the contact's
 * version is stamped on it. §4.7's durable cancellation depends on the pair:
 * content approved against a state, and a preflight that refuses when the state
 * has moved. Rendering at release would make the version meaningless, because
 * there would be nothing older to compare.
 */
import { contactIsStopped } from '@/lib/crm/contact-stop'
import {
  canTransition,
  type EnrollmentState,
  type TerminalReason,
} from '@/lib/linkedin/enrollment'
import { profileReference } from '@/lib/linkedin/profile-reference'
import { renderLinkedInMessage } from '@/lib/linkedin/render'
import type { TemplateId } from '@/lib/linkedin/templates'
import type { LinkedInContext } from '@/lib/linkedin/render'
import type { TaskKind } from '@/lib/linkedin/outcomes'
import { createAdminClient } from '@/lib/supabase/admin'

export type EnrollResult =
  | { ok: true; enrollmentId: string; taskId: string }
  | { ok: false; reason: EnrollRefusal; message: string }

export type EnrollRefusal =
  | 'stopped'
  | 'no_profile'
  | 'sender_unavailable'
  | 'already_enrolled'
  | 'needs_manual_rewrite'
  | 'failed'

/**
 * §4.17's stable key: workspace + enrollment + node + occurrence.
 *
 * ⚠️ THE ATTEMPT NUMBER IS DELIBERATELY ABSENT. The brief calls including it a
 * defect: a retry would become a new logical action and could duplicate a real
 * external effect — a second connection request to a stranger who already had
 * one.
 */
function logicalActionId(input: {
  workspaceId: string
  enrollmentId: string
  node: string
  occurrence: number
}): string {
  return `${input.workspaceId}:${input.enrollmentId}:${input.node}:${input.occurrence}`
}

/**
 * The first touch of a sequence.
 *
 * ⚠️ `REVIEW_PROFILE` RATHER THAN A CONNECTION REQUEST, and that is §4.10's
 * ladder rather than caution for its own sake: a new sender releases nothing
 * until reviewed, and the cheapest first action against a real account is one
 * that reads rather than writes. A profile view cannot get anybody restricted.
 */
const FIRST_NODE = 'n1_review' as const

export async function enrollContact(input: {
  workspaceId: string
  contactId: string
  senderId: string
  templateId: TemplateId
  context: LinkedInContext
  actorUserId: string
}): Promise<EnrollResult> {
  const db = createAdminClient()

  /*
   * ⚠️ THE STOP CHECK COMES FIRST, THROUGH THE ONE PREDICATE. `contactIsStopped`
   * fails closed, reads both suppression tables, and honours the LinkedIn scope
   * exactly — a person who said "stop emailing me" has not said "stop
   * connecting". Asking any other way is how a stop gets honoured on one
   * channel and not the other.
   */
  const stop = await contactIsStopped({
    workspaceId: input.workspaceId,
    channel: 'linkedin',
    contactId: input.contactId,
  })
  if (stop.stopped) {
    return {
      ok: false,
      reason: 'stopped',
      message:
        stop.via === 'contact'
          ? 'This contact is marked do-not-contact.'
          : 'This contact cannot be approached right now.',
    }
  }

  const { data: contact } = await db
    .from('crm_contacts')
    .select('id, full_name, linkedin_url, version')
    // Service role bypasses RLS — scoping by workspace is mandatory.
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!contact) {
    return { ok: false, reason: 'failed', message: 'That contact is not in this workspace.' }
  }

  /*
   * ⚠️ A PROFILE REFERENCE IS REQUIRED, AND IT IS AN ALLOWLIST. §4.13: "Opening
   * a reference never performs a LinkedIn action." The URL came out of uploaded
   * HTML, so `profileReference` permits only read-only profile paths rather
   * than trying to blocklist the ones that do things.
   */
  const reference = profileReference(contact.linkedin_url)
  if (!reference) {
    return {
      ok: false,
      reason: 'no_profile',
      message: 'This contact has no usable LinkedIn profile link.',
    }
  }

  // The sender must be linked to THIS workspace, or anyone could spend
  // somebody else's account's budget.
  const { data: link } = await db
    .from('linkedin_sender_links')
    .select('sender_id')
    .eq('workspace_id', input.workspaceId)
    .eq('sender_id', input.senderId)
    .maybeSingle()

  if (!link) {
    return {
      ok: false,
      reason: 'sender_unavailable',
      message: 'That account is not linked to this workspace.',
    }
  }

  /*
   * ⚠️ RENDERED BEFORE ANYTHING IS WRITTEN. §4.9: "If neither context nor role
   * is supported, require a manual rewrite or skip; do not fabricate
   * familiarity." An enrollment whose first message cannot be written is not an
   * enrollment — creating it and discovering that later leaves a row nobody can
   * act on.
   */
  const rendered = renderLinkedInMessage(input.templateId, input.context)
  if (rendered.kind !== 'rendered') {
    return {
      ok: false,
      reason: 'needs_manual_rewrite',
      message:
        rendered.kind === 'manual_rewrite'
          ? `Not enough verified detail to write this yet — missing ${rendered.missing.join(', ')}.`
          : 'This contact cannot be approached with this template yet.',
    }
  }

  /*
   * ⚠️ `READY`, AND THE TRANSITION IS CHECKED RATHER THAN ASSUMED. `DRAFT` is
   * the column default; `canTransition` is the state machine that says which
   * moves exist, and calling it here means the rule lives in one place instead
   * of being re-implemented by every writer.
   */
  const target: EnrollmentState = 'READY'
  if (!canTransition('DRAFT', target)) {
    return { ok: false, reason: 'failed', message: 'That sequence cannot start.' }
  }

  const { data: enrollment, error: enrollError } = await db
    .from('linkedin_enrollments')
    .insert({
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      sender_id: input.senderId,
      state: target,
    })
    .select('id')
    .single()

  if (enrollError || !enrollment) {
    /*
     * ⚠️ THE UNIQUE INDEX IS THE CONTROL, NOT A PRIOR LOOKUP. Two people
     * enrolling the same contact at once both pass a check-then-insert; only
     * the database can refuse the second, and 0125's partial index does.
     */
    const duplicate = enrollError?.code === '23505'
    if (!duplicate) console.error('linkedin enrollment failed', { error: enrollError })
    return {
      ok: false,
      reason: duplicate ? 'already_enrolled' : 'failed',
      message: duplicate
        ? 'This contact is already in a LinkedIn sequence.'
        : 'That sequence could not be started.',
    }
  }

  const kind: TaskKind = 'REVIEW_PROFILE'
  const { data: task, error: taskError } = await db
    .from('linkedin_tasks')
    .insert({
      workspace_id: input.workspaceId,
      enrollment_id: enrollment.id,
      contact_id: input.contactId,
      sender_id: input.senderId,
      kind,
      state: 'PENDING',
      // ⚠️ The version the content was approved AT. See the banner.
      approved_at_contact_version: contact.version,
      /*
       * ⚠️ THE BODY IS CARRIED EVEN ON A REVIEW CARD. The operator is about to
       * look at a profile in order to decide whether the message we drafted
       * still fits; hiding it until the next step would ask them to judge
       * without the thing being judged.
       */
      body: rendered.text,
      logical_action_id: logicalActionId({
        workspaceId: input.workspaceId,
        enrollmentId: enrollment.id,
        node: FIRST_NODE,
        occurrence: 1,
      }),
    })
    .select('id')
    .single()

  if (taskError || !task) {
    console.error('linkedin first task failed', { enrollmentId: enrollment.id, error: taskError })
    return { ok: false, reason: 'failed', message: 'That sequence could not be started.' }
  }

  return { ok: true, enrollmentId: enrollment.id, taskId: task.id }
}

/**
 * Ends an enrollment.
 *
 * ⚠️ A TERMINAL STATE ALWAYS CARRIES A REASON — 0125 enforces the pair, and
 * `reasonMeansSuccess()` treats only `GOAL_MET` as success. §4.18 wants
 * qualified conversations and held meetings as separate denominators precisely
 * so a wall of "replied" cannot be presented as the thing having worked.
 */
export async function endEnrollment(input: {
  workspaceId: string
  enrollmentId: string
  state: Extract<EnrollmentState, 'COMPLETED' | 'CANCELLED' | 'FAILED'>
  /*
   * ⚠️ TYPED AS THE UNION, NOT `string`. The generated database types caught
   * this: a free-form reason would compile here and fail at the enum on write,
   * which is the worst place to learn about it — after the sequence has been
   * decided to be over.
   */
  reason: TerminalReason
}): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('linkedin_enrollments')
    .update({
      state: input.state,
      terminal_reason: input.reason,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.enrollmentId)
    .select('id')

  if (error) throw new Error(`endEnrollment failed: ${error.message}`)
  return (data ?? []).length > 0
}
