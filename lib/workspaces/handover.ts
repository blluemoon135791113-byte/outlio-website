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
 * ║  ⚠️ THIS CHANGES CURRENT OWNERSHIP ONLY. Activities freeze                ║
 * ║  `owner_user_id_at_event` when they are written, so past attribution is   ║
 * ║  untouched: the leaderboard still credits the person who did the work.    ║
 * ║  That frozen column is exactly why a handover can be safe.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
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
 */
export async function reassignMemberRecords(
  workspaceId: string,
  fromUserId: string,
  toUserId: string | null,
): Promise<HandoverResult> {
  const db = createAdminClient()

  /*
   * ⚠️ THE DESTINATION MUST BE A MEMBER OF THIS WORKSPACE. The id arrives from
   * a form and the service role bypasses RLS, so without this check a crafted
   * request could hand a workspace's entire book of business to an outsider —
   * who would then own it legitimately.
   */
  if (toUserId) {
    const { data: member } = await db
      .from('workspace_memberships')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', toUserId)
      .maybeSingle()

    if (!member) {
      throw new Error('reassignMemberRecords: the new owner is not in this workspace')
    }
  }

  // Counted per table so the person doing it is told what actually moved,
  // rather than "done" — the difference between 4 records and 4,000 matters.
  const move = async (
    table: 'crm_contacts' | 'crm_companies' | 'crm_opportunities',
  ): Promise<number> => {
    const { data, error } = await db
      .from(table)
      .update({ owner_user_id: toUserId })
      // Scoped by workspace in code — the service role bypasses RLS.
      .eq('workspace_id', workspaceId)
      .eq('owner_user_id', fromUserId)
      .select('id')

    if (error) throw new Error(`reassignMemberRecords(${table}) failed: ${error.message}`)
    return data?.length ?? 0
  }

  const [contacts, companies, opportunities] = await Promise.all([
    move('crm_contacts'),
    move('crm_companies'),
    move('crm_opportunities'),
  ])

  /*
   * ⚠️ ONLY OPEN TASKS. A completed task records who completed it; moving that
   * would rewrite history and credit the wrong person for finished work.
   */
  const { data: taskRows, error: taskError } = await db
    .from('crm_tasks')
    .update({ assigned_to_user_id: toUserId })
    .eq('workspace_id', workspaceId)
    .eq('assigned_to_user_id', fromUserId)
    .eq('status', 'open')
    .select('id')

  if (taskError) {
    throw new Error(`reassignMemberRecords(crm_tasks) failed: ${taskError.message}`)
  }

  return {
    contacts,
    companies,
    opportunities,
    tasks: taskRows?.length ?? 0,
  }
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
