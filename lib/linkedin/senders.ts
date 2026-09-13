import 'server-only'

/**
 * Linking a LinkedIn account, and reading its budget.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ONLY WAY INTO `linkedin_senders`, WHICH HAS NO RLS SELECT POLICY.    ║
 * ║                                                                           ║
 * ║  §4.10 needs one budget per real person shared across every workspace      ║
 * ║  that person belongs to, and no workspace able to see another's activity.  ║
 * ║  So the table is service-role only and the budget crosses the boundary as  ║
 * ║  a single integer from `linkedin_sender_used`, which checks membership     ║
 * ║  before it counts anything.                                               ║
 * ║                                                                           ║
 * ║  Anything that reaches past this module — a component querying the table   ║
 * ║  directly, a route joining it — is reaching past the membership check      ║
 * ║  that makes the design safe.                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { canonicalLinkedInUrl } from '@/lib/intelligence/identity'
import {
  KIND_FOR_TASK,
  remainingBudget,
  type ActionKind,
  type BudgetResult,
} from '@/lib/linkedin/budget'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type SenderStatus = Database['public']['Enums']['linkedin_sender_status']

export type LinkSenderResult =
  | { ok: true; senderId: string; created: boolean }
  /**
   * ⚠️ ONE FAILURE CODE FOR TWO DIFFERENT CAUSES, DELIBERATELY.
   *
   * The profile may be claimed by another Outlio user — which is account
   * sharing, prohibited by LinkedIn's User Agreement and by §4.10 — or the
   * insert may have failed. Distinguishing them in the response would confirm
   * that a given LinkedIn profile is on Outlio, which is a disclosure about
   * somebody who never signed up. Support resolves the genuine case by hand.
   */
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'invalid_profile_url' }

/**
 * Links a LinkedIn account to a workspace, creating the sender if needed.
 *
 * ⚠️ THE SAME PERSON LINKING INTO A SECOND WORKSPACE IS NOT A CONFLICT. It is
 * the case §4.10 asks for — one human, two customers, one budget — and it adds
 * a LINK row against the existing sender. A DIFFERENT user claiming the same
 * profile is account sharing and is refused.
 */
export async function linkSender(input: {
  workspaceId: string
  /** The Outlio user asserting this is their own account. */
  ownerUserId: string
  profileUrl: string
  displayLabel: string
}): Promise<LinkSenderResult> {
  const identityKey = canonicalLinkedInUrl(input.profileUrl)
  if (!identityKey) return { ok: false, reason: 'invalid_profile_url' }

  const db = createAdminClient()

  const { data: existing, error: lookupError } = await db
    .from('linkedin_senders')
    .select('id, owner_user_id')
    .eq('identity_key', identityKey)
    .maybeSingle()

  /*
   * ⚠️ THE ERROR WAS IGNORED HERE, AND IT COST REAL TIME. A failed lookup left
   * `existing` null, so the code fell through to an insert that also failed,
   * and the operator got "contact support" while support had nothing to look
   * at. I hit exactly that on a staging project missing this table and spent
   * several minutes unable to tell an infrastructure fault from an account
   * conflict — which is precisely what the customer-facing message is designed
   * NOT to distinguish.
   *
   * The message to the client stays deliberately vague; the LOG is where the
   * difference goes. Never the identity key: it names a real person's profile.
   */
  if (lookupError) {
    console.error('[linkedin] sender lookup failed', {
      workspaceId: input.workspaceId,
      message: lookupError.message,
    })
    return { ok: false, reason: 'unavailable' }
  }

  let senderId: string
  let created = false

  if (existing) {
    /*
     * ⚠️ OWNERSHIP IS NOT TRANSFERABLE BY LINKING. If this profile belongs to
     * another Outlio user, someone is trying to operate an account that is not
     * theirs — the thing §4.6 says only the real owner may do.
     */
    if (existing.owner_user_id !== input.ownerUserId) {
      return { ok: false, reason: 'unavailable' }
    }
    senderId = existing.id
  } else {
    const { data: inserted, error } = await db
      .from('linkedin_senders')
      .insert({
        identity_key: identityKey,
        owner_user_id: input.ownerUserId,
        display_label: input.displayLabel,
        // Stage 0 releases nothing until an owner reviews it. §4.10.
        stage: 0,
        status: 'unknown',
      })
      .select('id')
      .single()

    /*
     * A unique violation here is the race version of the branch above — two
     * requests creating the same sender at once. Anything else is a fault, and
     * the two are worth telling apart in the log even though the caller is told
     * the same thing either way.
     */
    if (error || !inserted) {
      console.error('[linkedin] sender insert failed', {
        workspaceId: input.workspaceId,
        // `23505` is a unique violation: somebody else holds this identity.
        code: error?.code ?? 'none',
        message: error?.message ?? 'no row returned',
      })
      return { ok: false, reason: 'unavailable' }
    }
    senderId = inserted.id
    created = true
  }

  const { error: linkError } = await db
    .from('linkedin_sender_links')
    .upsert(
      {
        workspace_id: input.workspaceId,
        sender_id: senderId,
        linked_by_user_id: input.ownerUserId,
      },
      // Re-linking an already-linked sender is a no-op, not an error.
      { onConflict: 'workspace_id,sender_id', ignoreDuplicates: true },
    )

  if (linkError) {
    console.error('[linkedin] sender link failed', {
      workspaceId: input.workspaceId,
      message: linkError.message,
    })
    return { ok: false, reason: 'unavailable' }
  }
  return { ok: true, senderId, created }
}

export type SenderBudget = BudgetResult & {
  usedToday: number
  usedThisWeek: number
}

/**
 * How much of a kind's budget remains, counting every workspace.
 *
 * ⚠️ TWO WINDOWS, BOTH FROM THE DATABASE, BECAUSE NEITHER CAN BE DERIVED FROM
 * THE OTHER. A daily count is not a weekly count divided by seven, and the
 * ladder sets the weekly cap deliberately below seven daily ones.
 *
 * ⚠️ `1 day` IS A ROLLING 24 HOURS, NOT THE SENDER'S CALENDAR DAY. That is the
 * conservative of the two: it never permits more than the calendar reading
 * would, and it closes the 23:50-then-00:10 burst that a calendar day allows.
 * Honouring `budget_timezone` exactly needs the count grouped in that zone,
 * which is a function change rather than a caller change — recorded rather than
 * quietly approximated.
 */
export async function senderBudget(
  senderId: string,
  kind: ActionKind,
  options: { stage: number; externalReservePerDay: number; customerDailyCap: number | null },
): Promise<SenderBudget> {
  const db = createAdminClient()

  const [day, week] = await Promise.all([
    db.rpc('linkedin_sender_used', { p_sender_id: senderId, p_kind: kind, p_window: '1 day' }),
    db.rpc('linkedin_sender_used', { p_sender_id: senderId, p_kind: kind, p_window: '7 days' }),
  ])

  /*
   * ⚠️ A FAILED COUNT IS TREATED AS A FULL BUDGET, NOT AN EMPTY ONE. `?? 0`
   * would read a database error as "nothing sent yet" and release a full day's
   * work against an account we know nothing about. The same fail-closed
   * asymmetry as `contactIsStopped`: the cost of being wrong is a restriction
   * on somebody's real account.
   */
  const usedToday = day.error ? Number.MAX_SAFE_INTEGER : (day.data ?? 0)
  const usedThisWeek = week.error ? Number.MAX_SAFE_INTEGER : (week.data ?? 0)

  return {
    ...remainingBudget({
      stage: options.stage,
      kind,
      usedToday,
      usedThisWeek,
      externalReservePerDay: options.externalReservePerDay,
      customerDailyCap: options.customerDailyCap,
    }),
    usedToday,
    usedThisWeek,
  }
}

/** The budget a manual task of this kind would spend. */
export function budgetKindForTask(task: keyof typeof KIND_FOR_TASK): ActionKind {
  return KIND_FOR_TASK[task]
}

/**
 * The senders a workspace may use, with no cross-workspace detail attached.
 *
 * ⚠️ IT RETURNS NO `identity_key`. That is the global join key, and handing it
 * to a client would let two workspaces correlate a sender between them — which
 * is the browseable list §4.10 forbids, assembled one response at a time.
 */
export async function listWorkspaceSenders(workspaceId: string): Promise<
  { senderId: string; displayLabel: string; status: SenderStatus; stage: number }[]
> {
  const db = createAdminClient()

  const { data: links } = await db
    .from('linkedin_sender_links')
    .select('sender_id')
    // Service role bypasses RLS — scoping by workspace here is mandatory.
    .eq('workspace_id', workspaceId)

  const ids = (links ?? []).map((l) => l.sender_id)
  if (ids.length === 0) return []

  const { data: senders } = await db
    .from('linkedin_senders')
    .select('id, display_label, status, stage')
    .in('id', ids)

  return (senders ?? []).map((s) => ({
    senderId: s.id,
    displayLabel: s.display_label,
    status: s.status,
    stage: s.stage,
  }))
}
