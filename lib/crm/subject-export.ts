import 'server-only'

/**
 * Everything held about one person — §6.4's "export path per contact".
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE EXPORT THAT EXISTED WAS THE WRONG SHAPE FOR A SUBJECT REQUEST.       ║
 * ║                                                                           ║
 * ║  `lib/crm/contact-export.ts` exports a workspace, optionally narrowed to   ║
 * ║  one owner, as a CSV of nine contact columns. That is a sales export and   ║
 * ║  it is correct for what it is.                                            ║
 * ║                                                                           ║
 * ║  A data subject asking "what do you hold about me" needs the opposite      ║
 * ║  slice: ONE person, EVERY table. Handing them a workspace CSV discloses    ║
 * ║  other people's data and still omits their own notes, tasks and activity.  ║
 * ║                                                                           ║
 * ║  ⚠️ THE INVARIANT: THIS MUST COVER WHAT `crm_erase_contact` DESTROYS.      ║
 * ║  Erasing data that was never disclosable is how a subject access request   ║
 * ║  and an erasure request give two different accounts of the same person.    ║
 * ║  `tests/unit/data-subject-rights.test.ts` asserts the two lists agree,     ║
 * ║  with the exclusions written down and checked in both directions.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Tables `crm_erase_contact` destroys that are NOT in the export, and why.
 *
 * ⚠️ EXPORTED SO THE TEST READS THE REAL LIST, not a copy of it. Both are
 * internal records ABOUT our handling rather than content held about the
 * person, and both are destroyed by erasure anyway:
 *
 * - `crm_notifications` — messages to our staff ("Dana replied"). The subject's
 *   name appears; the record is our workflow, and disclosing our internal
 *   alerting is not what Art. 15 asks for.
 * - `crm_duplicate_candidates` — a similarity score between two of our rows.
 *   It holds ids and a number, no content about the person.
 *
 * A third table is scrubbed rather than deleted: `crm_merge_events.snapshot`
 * keeps non-identifying attribution keys with an `erased_at` tombstone, which
 * is §6.4's "aggregate/attribution rows retain non-identifying keys". There is
 * nothing personal left in it to export after an erasure, and before one the
 * snapshot is a copy of the contact row that IS exported.
 */
export const ERASED_BUT_NOT_EXPORTED = [
  'crm_notifications',
  'crm_duplicate_candidates',
] as const

export type SubjectExport = {
  subject: { contactId: string; workspaceId: string; generatedAt: string }
  contact: Record<string, unknown> | null
  notes: Record<string, unknown>[]
  activities: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  /** Named so a reader knows the absence of a section is deliberate. */
  excluded: readonly string[]
}

/**
 * Collects one subject's data.
 *
 * ⚠️ SCOPED BY `workspace_id` ON EVERY QUERY. These run on the service role,
 * which bypasses RLS, so the `WHERE` clause is the only tenancy wall — and the
 * consequence of a missing one here is disclosing one customer's contact to
 * another, in a document produced specifically to be handed out.
 *
 * ⚠️ SOFT-DELETED ROWS ARE INCLUDED. A note someone deleted is still held, and
 * "we still have it but chose not to show you" is not an answer to Art. 15.
 * Erasure destroys them regardless of `deleted_at`, so the export must see them
 * or the two rights disagree.
 */
export async function collectSubjectExport(
  workspaceId: string,
  contactId: string,
): Promise<SubjectExport> {
  const db = createAdminClient()

  const [contact, notes, activities, tasks] = await Promise.all([
    db
      .from('crm_contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', contactId)
      .maybeSingle()
      .then((r) => r.data ?? null),
    db
      .from('crm_notes')
      .select('id, body, created_at, created_by, deleted_at')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .then((r) => r.data ?? []),
    db
      .from('crm_activities')
      .select('id, activity_type, channel, occurred_at, refs')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: true })
      .then((r) => r.data ?? []),
    db
      .from('crm_tasks')
      .select('id, title, body, status, due_at, completed_at, created_at, deleted_at')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .then((r) => r.data ?? []),
  ])

  return {
    subject: { contactId, workspaceId, generatedAt: new Date().toISOString() },
    contact,
    notes,
    activities,
    tasks,
    excluded: ERASED_BUT_NOT_EXPORTED,
  }
}
