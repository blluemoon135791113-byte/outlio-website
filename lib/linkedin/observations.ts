import 'server-only'

/**
 * Recording what was later seen to happen — Phase 19.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §7.5: "an inbound message is only a reply if WE ACTUALLY CONTACTED THEM, ║
 * ║  or the same false-reply bug returns on a new channel."                   ║
 * ║                                                                           ║
 * ║  `email_events` still holds 254 false `replied` rows — a whole mailbox    ║
 * ║  recorded as prospect replies against two messages ever sent. A naive     ║
 * ║  reply rate computes 254/2 and renders 12,700%.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE EMAIL RULE CANNOT BE COPIED ACROSS, AND UNDERSTANDING WHY IS THE
 * PHASE. `hasEverMailed` asks whether an `email_messages` row exists — a record
 * written because the product itself sent something. It is an OBSERVED FACT.
 *
 * LinkedIn has no such row. Outlio never opens linkedin.com (rule 1), so the
 * nearest thing is a task an operator MARKED as sent. That is a CLAIM, and one
 * of its legal values is "I cannot say".
 *
 * ⚠️ SO `OUTCOME_UNKNOWN` COUNTS AS CONTACT, AND THAT IS NOT LENIENCY. §4.17
 * already treats an unknown outcome as possibly delivered — it keeps its quota
 * reservation "because the thing we cannot rule out is that a stranger already
 * received it". Refusing a reply on the same evidence would have the product
 * assert, for attribution, the opposite of what it assumes for safety. The
 * doubt is recorded on the row instead, so a metric can exclude it without the
 * recording path having to guess.
 *
 * ⚠️ WHAT IS REFUSED IS THE CASE THAT PRODUCED THE 12,700%: a reply from
 * somebody nothing was ever sent to. No task, or only tasks that were SKIPPED
 * or FAILED, means nothing could have reached them — and a reply to nothing is
 * not a reply.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { Observation } from '@/lib/linkedin/outcomes'
import type { Database } from '@/types/database'

type TaskOutcomeValue = Database['public']['Enums']['linkedin_task_outcome']

/**
 * Outcomes that mean something may have reached this person.
 *
 * ⚠️ `SKIPPED` AND `FAILED` ARE ABSENT ON PURPOSE. Skipped is a decision not to
 * act; failed is somebody having looked and found it did not happen. Neither
 * can be replied to. Including them would readmit exactly the shape Phase 9
 * fixed — a reply attributed to outreach that never left.
 */
const MAY_HAVE_REACHED: readonly TaskOutcomeValue[] = [
  'REQUEST_MARKED_SENT',
  'MESSAGE_MARKED_SENT',
  'OUTCOME_UNKNOWN',
]

/** Outcomes where we cannot say it arrived — recorded, never used to refuse. */
const UNCONFIRMED: readonly TaskOutcomeValue[] = ['OUTCOME_UNKNOWN']

export type ContactEvidence =
  | { contacted: true; taskId: string; unconfirmed: boolean }
  | { contacted: false }

/**
 * Did this workspace ever send this person anything on LinkedIn?
 *
 * ⚠️ IT RETURNS THE EVIDENCE, NOT A BOOLEAN. The row that made a reply
 * acceptable is stored with it, so a future change to this rule can be applied
 * to history instead of silently disagreeing with it.
 *
 * ⚠️ AND IT PREFERS A CONFIRMED TASK. When somebody has both a confirmed send
 * and an unknown one, the reply is attributed to the confirmed one — otherwise
 * a single uncertain step would mark every later reply as doubtful and the
 * `unconfirmed` flag would stop meaning anything.
 */
export async function contactEvidence(
  workspaceId: string,
  contactId: string,
): Promise<ContactEvidence> {
  const { data, error } = await createAdminClient()
    .from('linkedin_tasks')
    .select('id, outcome')
    // Scoped by workspace in code — the service role bypasses RLS.
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .in('outcome', [...MAY_HAVE_REACHED])
    .order('id', { ascending: true })

  /*
   * ⚠️ AN ERROR IS NOT "NEVER CONTACTED". Returning `contacted: false` on a
   * database hiccup would refuse a genuine reply and, worse, keep outreach
   * running at somebody who had already answered. The caller treats this as a
   * failure to decide rather than a decision.
   */
  if (error) throw new Error(`contactEvidence failed: ${error.message}`)

  const rows = data ?? []
  if (rows.length === 0) return { contacted: false }

  const confirmed = rows.find(
    (row) => row.outcome !== null && !UNCONFIRMED.includes(row.outcome),
  )
  if (confirmed) return { contacted: true, taskId: confirmed.id, unconfirmed: false }

  return { contacted: true, taskId: rows[0]!.id, unconfirmed: true }
}

export type RecordObservationInput = {
  workspaceId: string
  contactId: string
  kind: Observation
  note?: string | null
  enrollmentId?: string | null
  recordedBy: string
}

export type RecordObservationResult =
  | { ok: true; observationId: string; unconfirmed: boolean }
  | { ok: false; reason: 'never_contacted' | 'failed'; message: string }

/**
 * Records an observation, refusing one that could not have happened.
 *
 * ⚠️ THE REFUSAL MESSAGE NAMES THE RULE, because the operator is looking at a
 * real person they believe replied. "Not allowed" invites them to find another
 * way to record it; saying Outlio has no record of contacting this person
 * invites them to check, which is the useful response — they may have messaged
 * from LinkedIn directly without a task, and that is worth knowing.
 */
export async function recordObservation(
  input: RecordObservationInput,
): Promise<RecordObservationResult> {
  let evidence: ContactEvidence
  try {
    evidence = await contactEvidence(input.workspaceId, input.contactId)
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      message: 'Outlio could not check this contact’s outreach history, so nothing was recorded.',
    }
  }

  if (!evidence.contacted) {
    return {
      ok: false,
      reason: 'never_contacted',
      message:
        'Outlio has no record of sending this person anything on LinkedIn, so it cannot record a reply from them. ' +
        'If you messaged them outside Outlio, add the outreach first.',
    }
  }

  const { data, error } = await createAdminClient()
    .from('linkedin_observations')
    .insert({
      workspace_id: input.workspaceId,
      contact_id: input.contactId,
      enrollment_id: input.enrollmentId ?? null,
      kind: input.kind,
      note: input.note?.trim() || null,
      evidence_task_id: evidence.taskId,
      evidence_was_unconfirmed: evidence.unconfirmed,
      recorded_by: input.recordedBy,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, reason: 'failed', message: 'Could not record that observation.' }
  }

  return { ok: true, observationId: data.id, unconfirmed: evidence.unconfirmed }
}
