import 'server-only'

/**
 * Reassigning a departing member's records — R3.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  REMOVING A MEMBER USED TO ORPHAN EVERYTHING THEY OWNED.                 ║
 * ║                                                                           ║
 * ║  `removeMemberAction` deleted the membership row and nothing else. Their  ║
 * ║  contacts, companies, deals and tasks kept pointing at a user who was no  ║
 * ║  longer in the workspace — so those records appeared in nobody's "assigned║
 * ║  to me", the owner filter listed a person who was not there, and the work ║
 * ║  simply stopped being done by anyone.                                     ║
 * ║                                                                           ║
 * ║  ⚠️ THIS CHANGES CURRENT OWNERSHIP, AND NOW RECORDS THAT IT DID.          ║
 * ║  Activities freeze `owner_user_id_at_event` when they are written, so     ║
 * ║  past attribution is untouched: the leaderboard still credits the person  ║
 * ║  who did the work. What was missing was the handover itself — contacts    ║
 * ║  and tasks changed hands with no OWNER_ASSIGNED or TASK_REASSIGNED row,   ║
 * ║  and the four updates were separate, so a failure half way left the book  ║
 * ║  split. `crm_handover_member_records` (0129) does it in one transaction.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { announceAssignments } from '@/lib/crm/activities'
import { createAdminClient } from '@/lib/supabase/admin'

export type HandoverResult = {
  contacts: number
  companies: number
  opportunities: number
  tasks: number
}

export function handoverTotal(result: HandoverResult): number {
  return result.contacts + result.companies + result.opportunities + result.tasks
}

/**
 * Moves everything one member owns to another member, or to nobody.
 *
 * `toUserId === null` deliberately unassigns rather than refusing: sometimes
 * there is no obvious successor, and an explicitly unassigned record is
 * findable. A record owned by a non-member is not.
 *
 * ⚠️ THE DESTINATION MUST BE A MEMBER OF THIS WORKSPACE, and the database
 * checks it. The id arrives from a form and the service role bypasses RLS, so
 * without the check a crafted request could hand a workspace's entire book of
 * business to an outsider — who would then own it legitimately.
 */
export type HandoverAssignment = { contactId: string; activityId: string }

export type HandoverOutcome = HandoverResult & {
  /** Contacts that changed hands, each with the OWNER_ASSIGNED row it wrote. */
  assignments: HandoverAssignment[]
}

export async function reassignMemberRecords(
  workspaceId: string,
  fromUserId: string,
  toUserId: string | null,
  actorUserId: string | null = null,
): Promise<HandoverOutcome> {
  const { data, error } = await createAdminClient().rpc('crm_handover_member_records', {
    p_workspace_id: workspaceId,
    p_from_user: fromUserId,
    // NULL means unassign; the generated types cannot say a uuid parameter accepts it.
    p_to_user: (toUserId ?? null) as unknown as string,
    p_actor_id: (actorUserId ?? null) as unknown as string,
  })

  if (error) {
    if (/not in this workspace/i.test(error.message)) {
      throw new Error('reassignMemberRecords: the new owner is not in this workspace')
    }
    if (/departing member/i.test(error.message)) {
      throw new Error('reassignMemberRecords: the new owner is the departing member')
    }
    throw new Error(`reassignMemberRecords failed: ${error.message}`)
  }

  const result = data as HandoverResult & {
    assignments: { contact_id: string; activity_id: string }[]
  }

  return {
    contacts: result.contacts,
    companies: result.companies,
    opportunities: result.opportunities,
    tasks: result.tasks,
    assignments: (result.assignments ?? []).map((a) => ({
      contactId: a.contact_id,
      activityId: a.activity_id,
    })),
  }
}

/**
 * Announces a handover's contact assignments: one `contact_assigned` per
 * OWNER_ASSIGNED row, keyed on it.
 *
 * ⚠️ SEPARATE FROM THE HANDOVER, AND CALLED ONCE THE MEMBERSHIP IS GONE. A
 * handover can move thousands of contacts, and announcing them used to sit
 * between the committed handover and the membership delete: a request that
 * timed out there left the member in place with their book already moved, and
 * a retry found nothing left to move — so the rest were never announced.
 */
export async function announceHandover(
  workspaceId: string,
  fromUserId: string,
  toUserId: string | null,
  assignments: HandoverAssignment[],
): Promise<void> {
  await announceAssignments(
    workspaceId,
    assignments.map((a) => ({
      contactId: a.contactId,
      from: fromUserId,
      to: toUserId,
      activityId: a.activityId,
    })),
  )
}

/** What a member currently owns, for the confirmation before removing them. */
export async function countOwnedRecords(
  workspaceId: string,
  userId: string,
): Promise<HandoverResult> {
  const db = createAdminClient()

  const count = async (
    table: 'crm_contacts' | 'crm_companies' | 'crm_opportunities',
  ): Promise<number> => {
    const { count: n } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('owner_user_id', userId)
    return n ?? 0
  }

  const [contacts, companies, opportunities, { count: tasks }] = await Promise.all([
    count('crm_contacts'),
    count('crm_companies'),
    count('crm_opportunities'),
    db
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('assigned_to_user_id', userId)
      .eq('status', 'open'),
  ])

  return { contacts, companies, opportunities, tasks: tasks ?? 0 }
}
