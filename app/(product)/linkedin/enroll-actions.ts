'use server'

/**
 * Starting a LinkedIn sequence for one contact.
 *
 * ⚠️ ENROLLING IS NOT CONTACTING. This writes an enrollment row and a PENDING
 * card. Nothing reaches LinkedIn here or anywhere — CLAUDE.md rule 1.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  audienceFromFormData,
  AudienceNotFoundError,
  AUDIENCE_LIMIT,
  resolveAudience,
} from '@/lib/crm/audience'
import { buildLinkedInContext, type RecordSource } from '@/lib/linkedin/context'
import { enrollContact, type EnrollRefusal } from '@/lib/linkedin/enroll'
import { createAdminClient } from '@/lib/supabase/admin'
import { isObservation } from '@/lib/linkedin/outcomes'
import { recordObservation } from '@/lib/linkedin/observations'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

export type EnrollActionState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

const uuid = z.string().uuid()

export async function enrollContactAction(
  _previous: EnrollActionState,
  formData: FormData,
): Promise<EnrollActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch {
    return { ok: false, error: 'You do not have access to this workspace.' }
  }

  if (!ctx.modules.has('linkedin')) {
    return { ok: false, error: 'The LinkedIn channel is not enabled on your plan.' }
  }

  const contactId = uuid.safeParse(formData.get('contactId'))
  const senderId = uuid.safeParse(formData.get('senderId'))
  if (!contactId.success) return { ok: false, error: 'Could not tell which contact you meant.' }
  if (!senderId.success) return { ok: false, error: 'Choose which account to send from.' }

  const topic = String(formData.get('topic') ?? '').trim()
  const manualBody = String(formData.get('manualBody') ?? '').trim() || null

  if (!topic) {
    // §4.9 marks `topic` required at publication — it is the customer's own
    // plain-language problem statement, and nothing can stand in for it.
    return { ok: false, error: 'Say what this is about, in your own words.' }
  }

  const db = createAdminClient()

  /*
   * ⚠️ THE FACTS ARE READ HERE AND NAMED EXPLICITLY. `buildLinkedInContext`
   * takes a narrow shape rather than the contact row, so a column added to
   * `crm_contacts` later cannot silently start feeding a message.
   */
  const { data: contact } = await db
    .from('crm_contacts')
    .select('source, first_name, full_name, job_title, headline')
    // Service role bypasses RLS — scoping by workspace is mandatory.
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', contactId.data)
    .is('deleted_at', null)
    .maybeSingle()

  if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }

  const context = buildLinkedInContext({
    contact: {
      source: contact.source as RecordSource,
      firstName: contact.first_name,
      fullName: contact.full_name,
      jobTitle: contact.job_title,
      headline: contact.headline,
    },
    campaign: { topic },
  })

  const result = await enrollContact({
    workspaceId: ctx.workspace.id,
    contactId: contactId.data,
    senderId: senderId.data,
    templateId: 'T01',
    context,
    manualBody,
    actorUserId: ctx.userId,
  })

  if (!result.ok) return { ok: false, error: result.message }

  revalidatePath(`/crm/contacts/${contactId.data}`)
  revalidatePath('/linkedin')
  return { ok: true, message: 'Added. The first task is in your LinkedIn inbox.' }
}

/* -------------------------------------------------------------------------- */

export type BulkEnrollState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/**
 * Starting a LinkedIn sequence for a whole audience.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  LINKEDIN HAD NO BULK PATH AT ALL. `enrollContactAction` takes ONE        ║
 * ║  contact and is reachable only from that contact's detail page, so        ║
 * ║  building a sequence of two hundred people meant opening two hundred      ║
 * ║  pages and retyping the same topic on each.                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ STILL ONE ENROLMENT PER CONTACT, DELIBERATELY. `enrollContact` renders the
 * first message before it writes anything and refuses per contact — stopped,
 * no profile, already enrolled, needs a manual rewrite. A bulk INSERT would
 * have to reimplement every one of those checks, and the one it got wrong would
 * put a card in an operator's inbox for somebody who said do-not-contact.
 *
 * ⚠️ AND ENROLLING IS STILL NOT CONTACTING. This writes enrollment rows and
 * PENDING cards. Nothing reaches LinkedIn here or anywhere — CLAUDE.md rule 1.
 */
export async function bulkEnrollContactsAction(
  _previous: BulkEnrollState,
  formData: FormData,
): Promise<BulkEnrollState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch {
    return { ok: false, error: 'You do not have access to this workspace.' }
  }

  if (!ctx.modules.has('linkedin')) {
    return { ok: false, error: 'The LinkedIn channel is not enabled on your plan.' }
  }

  const senderId = uuid.safeParse(formData.get('senderId'))
  if (!senderId.success) return { ok: false, error: 'Choose which account to send from.' }

  const topic = String(formData.get('topic') ?? '').trim()
  if (!topic) {
    // §4.9 marks `topic` required at publication — the customer's own
    // plain-language problem statement, and nothing can stand in for it.
    return { ok: false, error: 'Say what this is about, in your own words.' }
  }

  const source = audienceFromFormData(formData)
  if (!source) return { ok: false, error: 'Choose who to add.' }

  let audience
  try {
    audience = await resolveAudience(ctx.workspace.id, source, {
      ownerUserId: dataScope(ctx.role) === 'assigned' ? ctx.userId : null,
    })
  } catch (error) {
    if (error instanceof AudienceNotFoundError) return { ok: false, error: error.message }
    return { ok: false, error: 'Could not work out who that is.' }
  }

  if (audience.contactIds.length === 0) {
    return { ok: false, error: 'Nobody matched that — it has no contacts in it.' }
  }

  const db = createAdminClient()

  /*
   * ⚠️ ONE READ FOR THE WHOLE AUDIENCE, then one enrolment each. The per-
   * contact `enrollContact` re-reads the contact itself, which is a round trip
   * we cannot remove without duplicating its refusal logic — but the CONTEXT
   * fields are read here in a single query rather than N.
   *
   * ⚠️ THE FIELDS ARE NAMED EXPLICITLY, matching the single-contact action: a
   * column added to `crm_contacts` later must not silently start feeding a
   * message.
   */
  const { data: contacts } = await db
    .from('crm_contacts')
    .select('id, source, first_name, full_name, job_title, headline')
    .eq('workspace_id', ctx.workspace.id)
    .in('id', audience.contactIds)
    .is('deleted_at', null)

  const byId = new Map((contacts ?? []).map((row) => [row.id, row]))

  let enrolled = 0
  const refusals = new Map<EnrollRefusal, number>()

  for (const contactId of audience.contactIds) {
    const contact = byId.get(contactId)
    if (!contact) {
      refusals.set('failed', (refusals.get('failed') ?? 0) + 1)
      continue
    }

    const context = buildLinkedInContext({
      contact: {
        source: contact.source as RecordSource,
        firstName: contact.first_name,
        fullName: contact.full_name,
        jobTitle: contact.job_title,
        headline: contact.headline,
      },
      campaign: { topic },
    })

    const result = await enrollContact({
      workspaceId: ctx.workspace.id,
      contactId,
      senderId: senderId.data,
      templateId: 'T01',
      context,
      /*
       * ⚠️ NO SHARED MANUAL NOTE, AND THAT IS THE POINT. §4.9's remedy for thin
       * evidence is the operator's own words about THIS person; one sentence
       * pasted onto two hundred strangers is the fabricated familiarity the
       * rule exists to prevent. Contacts without enough grounding are refused
       * with `needs_manual_rewrite` and counted below, to be done one by one.
       */
      manualBody: null,
      actorUserId: ctx.userId,
    })

    if (result.ok) enrolled += 1
    else refusals.set(result.reason, (refusals.get(result.reason) ?? 0) + 1)
  }

  revalidatePath('/linkedin')
  revalidatePath('/linkedin/campaigns')

  return { ok: true, message: summarizeEnrollment(enrolled, refusals, audience.truncated) }
}

/**
 * ⚠️ NAMES EVERY REFUSAL. "40 added" out of 200 chosen, with the other 160
 * unexplained, is the number somebody plans a week of outreach around — and
 * `needs_manual_rewrite` in particular is not a failure but a WORKLIST, so
 * hiding it loses the actual next action.
 */
function summarizeEnrollment(
  enrolled: number,
  refusals: Map<EnrollRefusal, number>,
  truncated: boolean,
): string {
  const parts = [`${enrolled} added to the sequence.`]

  const explain: Record<EnrollRefusal, (n: number) => string> = {
    needs_manual_rewrite: (n) =>
      `${n} need a connection note written by hand — there was not enough verified detail to ground one. Open them individually to write it.`,
    already_enrolled: (n) => `${n} were already in a sequence.`,
    no_profile: (n) => `${n} have no usable LinkedIn profile link.`,
    stopped: (n) => `${n} are marked do-not-contact.`,
    sender_unavailable: (n) => `${n} could not use that account.`,
    failed: (n) => `${n} could not be added.`,
  }

  for (const [reason, count] of refusals) {
    if (count > 0) parts.push(explain[reason](count))
  }

  if (truncated) {
    parts.push(
      `Only the first ${AUDIENCE_LIMIT.toLocaleString()} were taken — add the rest in a second pass.`,
    )
  }

  return parts.join('\n')
}

/* -------------------------------------------------------------------------- */

export type ObservationState =
  | { ok: true; message: string; unconfirmed: boolean }
  | { ok: false; error: string }
  | null

/**
 * Records what the operator later saw happen to this person.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ SEPARATE FROM THE TASK RESULT FORM, AND IT MUST STAY SEPARATE.        ║
 * ║                                                                           ║
 * ║  `outcomes.ts`: "A result form offers the first and can never offer the   ║
 * ║  second, because an observation is not the outcome of doing anything."    ║
 * ║  `TaskOutcome` is what the operator DID; an Observation is what they      ║
 * ║  later SAW. Collapsing them lets "mark request sent" mark acceptance —    ║
 * ║  and acceptance gates the first DM, so the collapse sends a message into  ║
 * ║  a connection that was never made.                                       ║
 * ║                                                                           ║
 * ║  It lives on the CONTACT, not the task, because that is what it is about: ║
 * ║  a reply can arrive weeks after an enrolment ended.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function recordObservationAction(
  _previous: ObservationState,
  formData: FormData,
): Promise<ObservationState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch {
    return { ok: false, error: 'You do not have permission to record this.' }
  }

  if (!ctx.modules.has('linkedin')) {
    return { ok: false, error: 'LinkedIn is not included in your plan.' }
  }

  const contactId = String(formData.get('contactId') ?? '')
  const kind = String(formData.get('kind') ?? '')
  const note = String(formData.get('note') ?? '')

  /*
   * ⚠️ VALIDATED AGAINST THE VOCABULARY, NOT TRUSTED FROM THE FORM. A server
   * action is a public HTTP endpoint, so `kind` is a claim — and the one value
   * that must never arrive here is a `TaskOutcome`. The enum refuses it in the
   * database too; this refuses it before the round trip.
   */
  if (!isObservation(kind)) {
    return { ok: false, error: 'That is not something Outlio can record.' }
  }

  const result = await recordObservation({
    workspaceId: ctx.workspace.id,
    contactId,
    kind,
    note: note || null,
    recordedBy: ctx.userId,
  })

  if (!result.ok) return { ok: false, error: result.message }

  revalidatePath(`/crm/contacts/${contactId}`)

  return {
    ok: true,
    unconfirmed: result.unconfirmed,
    message: result.unconfirmed
      ? 'Recorded. The outreach it follows was marked unknown, so this is kept but flagged.'
      : 'Recorded.',
  }
}
