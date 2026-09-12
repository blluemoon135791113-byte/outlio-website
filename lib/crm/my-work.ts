import 'server-only'

/**
 * My Work — the daily entry point, §7.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  SEVEN FILTER TABS ARE NOT A PRIORITISED QUEUE.                           ║
 * ║                                                                           ║
 * ║  `/crm/tasks` offers Open, Today, Overdue, Upcoming, Mine, Team and       ║
 * ║  Completed — seven mutually-exclusive views that each answer "show me a   ║
 * ║  subset". None of them answers the question somebody actually opens the   ║
 * ║  CRM with, which is "what should I do next, and why".                     ║
 * ║                                                                           ║
 * ║  §7 fixes the order and it is not negotiable:                             ║
 * ║                                                                           ║
 * ║    1. actionable replies awaiting response                                ║
 * ║    2. overdue commitments                                                 ║
 * ║    3. today's activities                                                  ║
 * ║    4. deals without a next action                                         ║
 * ║                                                                           ║
 * ║  A real person waiting on an answer outranks a task somebody set for      ║
 * ║  themselves. That is the whole point of the ordering, and it is why the   ║
 * ║  reply tier reads the inbox rather than the task table.                   ║
 * ║                                                                           ║
 * ║  ⚠️ EVERY ITEM CARRIES ITS REASON. §7: "Explain every item with its        ║
 * ║  reason and due time." A ranked list with no reasons is a magic ordering  ║
 * ║  nobody trusts and everybody works around.                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ TIER 4 IS THE ONE THAT NEEDED A SCHEMA CHANGE, and §7 says exactly why:
 * "The Next action indicator finds the earliest permitted open activity linked
 * to THAT DEAL. An unrelated contact activity must not make every deal look
 * covered." Until 0124 a task could name a person but never a deal, so the only
 * available join was through the contact — which is precisely the wrong answer
 * the spec calls out. Coverage here is `crm_tasks.opportunity_id` and nothing
 * else.
 *
 * ⚠️ A SNOOZED TASK (0126) IS OUT OF THE QUEUE BUT STILL COVERS ITS DEAL. The
 * snooze is a review date for the person, not a cancellation: the work is still
 * booked, so the deal has a next action. Hiding the deal's coverage too would
 * invite a duplicate task for work that already exists.
 */
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Why this item is in front of you.
 *
 * ⚠️ THE ORDER OF THIS ARRAY IS THE RANKING. It is declared once, here, so the
 * tiers cannot drift apart from the order they are rendered in.
 */
export const WORK_REASONS = [
  'reply_awaiting',
  'overdue',
  'due_today',
  'deal_without_next_action',
] as const

export type WorkReason = (typeof WORK_REASONS)[number]

export const REASON_LABEL: Record<WorkReason, string> = {
  reply_awaiting: 'Replied — waiting on you',
  overdue: 'Overdue',
  due_today: 'Due today',
  deal_without_next_action: 'No next action',
}

export type WorkItem = {
  /** Stable within a render; `${reason}:${recordId}`. */
  key: string
  reason: WorkReason
  title: string
  /** The person or company it concerns, when there is one. */
  context: string | null
  /**
   * When it is due, or when the reply landed. Null only for deals, which are
   * not due at a time — they are simply uncovered.
   */
  at: string | null
  href: string
  /**
   * The task this row is, when it is one — what the row's actions need.
   *
   * ⚠️ `version` IS PASSED BACK EXACTLY AS READ. It is 0126's optimistic-lock
   * token: an action taken from a screen loaded before somebody reassigned or
   * snoozed the task is refused rather than overwriting their change.
   */
  task: { id: string; version: number } | null
}

/**
 * ⚠️ ENFORCED HERE, NOT PASSED IN. The brief forbids unbounded scans in a
 * request path, and a `limit` a route could forward from a query string is not
 * a limit. A queue longer than this is not a queue anyway.
 */
const PER_TIER = 25

/**
 * The last instant of "today".
 *
 * ⚠️ COMPUTED IN THE SERVER'S TIMEZONE, WHICH IS THE SAME THING /crm/tasks
 * ALREADY DOES, and that is the only reason it is done this way. §7 asks for
 * absolute instants in UTC rendered against a relevant IANA zone, but NO USER
 * OR WORKSPACE TIMEZONE EXISTS TO READ — `timezone` lives on `crm_contacts`,
 * `email_accounts` and `email_campaigns`, all of which describe who is being
 * contacted rather than who is looking.
 *
 * So the honest choice was between one wrong-in-a-known-way definition of
 * "today" and two different ones. Two would be worse: the same task would sit
 * under "Due today" on one screen and not the other, and nobody would be able
 * to tell which screen was lying. Rendering uses `LocalTime`, so the TIMES are
 * shown correctly — it is only the bucket boundary that is server-side.
 */
function endOfDay(now: Date): string {
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
  return end.toISOString()
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The date-input bounds for a snooze: tomorrow through 364 days out, as
 * `YYYY-MM-DD` in UTC.
 *
 * ⚠️ TAKES `now` RATHER THAN READING THE CLOCK. The page passes the render's
 * instant in, which keeps `Date.now()` out of render — React's purity lint
 * refuses it there — and lets a test pin the answer.
 *
 * ⚠️ 364, NOT 365. The action reads the chosen day as its START, and 0126
 * refuses anything later than now + 365 days, so the last selectable day has
 * to clear that bound with room for a timezone offset. Offering a day the
 * server will then refuse is the kind of form that teaches people to distrust
 * the form.
 */
export function snoozeBounds(now: Date): { minSnoozeDate: string; maxSnoozeDate: string } {
  const at = now.getTime()
  return {
    minSnoozeDate: new Date(at + DAY_MS).toISOString().slice(0, 10),
    maxSnoozeDate: new Date(at + 364 * DAY_MS).toISOString().slice(0, 10),
  }
}

export async function listMyWork(input: {
  workspaceId: string
  userId: string
  now?: Date
}): Promise<WorkItem[]> {
  const db = createAdminClient()
  const now = input.now ?? new Date()
  const end = endOfDay(now)
  const nowIso = now.toISOString()

  /*
   * ⚠️ NO ROLE CHECK HERE, AND THAT IS NOT AN OVERSIGHT. The inbox needs
   * `seesAllThreads` because it decides whose mail you may READ. This queue
   * asks a narrower question — what is assigned to ME — so every tier filters
   * on the viewer's own id and a manager's queue is their own work, not the
   * team's. Reading someone else's thread still goes through the inbox, which
   * still checks.
   *
   * The consequence worth stating: an UNASSIGNED inbound reply appears in
   * nobody's My Work. That is deliberate — inventing an owner for it here
   * would put the same thread in several people's queues at once.
   */
  const repliesQuery = db
    .from('email_threads')
    .select('id, subject, last_message_at, contact_id')
    .eq('workspace_id', input.workspaceId)
    .eq('status', 'open')
    .eq('last_direction', 'inbound')
    .eq('assigned_to', input.userId)
    .order('last_message_at', { ascending: true })
    .limit(PER_TIER)

  /*
   * Overdue and today are the same table split at `now`, and both exclude
   * undated tasks: a task with no due date is not overdue and is not due today
   * — it is undated, which is a different thing and belongs in neither tier.
   *
   * ⚠️ AND BOTH EXCLUDE A TASK SNOOZED PAST `now`. The value is quoted inside
   * the `or` because a timestamp carries `:` and `.`, which the filter grammar
   * would otherwise have to guess about.
   */
  const taskSelect = 'id, title, due_at, contact_id, opportunity_id, version'
  const openTasks = () =>
    db
      .from('crm_tasks')
      .select(taskSelect)
      .eq('workspace_id', input.workspaceId)
      .eq('assigned_to_user_id', input.userId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .not('due_at', 'is', null)
      .or(`snoozed_until.is.null,snoozed_until.lte."${nowIso}"`)

  const overdueQuery = openTasks()
    .lt('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(PER_TIER)

  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ "TODAY" STARTS AT `now`, NOT AT MIDNIGHT — AND THAT IS A REAL      ║
   * ║  DIFFERENCE FROM `/crm/tasks?view=today`, ON PURPOSE.                 ║
   * ║                                                                       ║
   * ║  There, Today and Overdue are separate TABS, so a task due at 08:00   ║
   * ║  read at noon can sit in both and nobody is confused — you only ever  ║
   * ║  look at one tab.                                                     ║
   * ║                                                                       ║
   * ║  Here they are consecutive TIERS OF ONE LIST, so the same overlap     ║
   * ║  prints the same task twice, four rows apart, under two different     ║
   * ║  reasons. A queue that lists one job twice is a queue people stop     ║
   * ║  believing. The tiers must partition, so overdue is everything before ║
   * ║  `now` and today is the rest of today.                                ║
   * ║                                                                       ║
   * ║  Found by a test that expected two items and got three.               ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  const todayQuery = openTasks()
    .gte('due_at', nowIso)
    .lte('due_at', end)
    .order('due_at', { ascending: true })
    .limit(PER_TIER)

  const dealsQuery = db
    .from('crm_opportunities')
    .select('id, title')
    .eq('workspace_id', input.workspaceId)
    .eq('owner_user_id', input.userId)
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('updated_at', { ascending: true })
    .limit(PER_TIER)

  const [replies, overdue, today, deals] = await Promise.all([
    repliesQuery,
    overdueQuery,
    todayQuery,
    dealsQuery,
  ])

  const myDeals = deals.data ?? []

  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ COVERAGE IS A WORKSPACE QUESTION, NOT A PERSONAL ONE.              ║
   * ║                                                                       ║
   * ║  The DEALS are mine — I own them. But a deal is covered the moment    ║
   * ║  ANYONE has an open task on it. Scoping this lookup to my own tasks   ║
   * ║  would report a colleague's deal as needing a next action when they   ║
   * ║  had already booked one, and the fix for that false alarm is to       ║
   * ║  create a duplicate task. A queue that manufactures work is worse     ║
   * ║  than no queue.                                                       ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   *
   * Bounded by the deals already fetched, so this stays a small `in (…)`
   * rather than a scan of every task in the workspace. Deliberately NOT
   * filtered on `snoozed_until` — see the header.
   */
  const covered = new Set<string>()
  if (myDeals.length > 0) {
    const { data: coveringTasks } = await db
      .from('crm_tasks')
      .select('opportunity_id')
      .eq('workspace_id', input.workspaceId)
      .eq('status', 'open')
      .is('deleted_at', null)
      .in(
        'opportunity_id',
        myDeals.map((d) => d.id),
      )
    for (const t of coveringTasks ?? []) {
      if (t.opportunity_id) covered.add(t.opportunity_id)
    }
  }

  const items: WorkItem[] = [
    ...(replies.data ?? []).map((t) => ({
      key: `reply_awaiting:${t.id}`,
      reason: 'reply_awaiting' as const,
      title: t.subject?.trim() || 'No subject',
      context: null,
      at: t.last_message_at,
      href: `/email/inbox?thread=${t.id}`,
      task: null,
    })),
    ...(overdue.data ?? []).map((t) => ({
      key: `overdue:${t.id}`,
      reason: 'overdue' as const,
      title: t.title,
      context: null,
      at: t.due_at,
      href: '/crm/tasks?view=overdue',
      task: { id: t.id, version: t.version },
    })),
    ...(today.data ?? []).map((t) => ({
      key: `due_today:${t.id}`,
      reason: 'due_today' as const,
      title: t.title,
      context: null,
      at: t.due_at,
      href: '/crm/tasks?view=today',
      task: { id: t.id, version: t.version },
    })),
    ...myDeals
      .filter((d) => !covered.has(d.id))
      .map((d) => ({
        key: `deal_without_next_action:${d.id}`,
        reason: 'deal_without_next_action' as const,
        title: d.title,
        context: null,
        at: null,
        href: '/crm/pipeline',
        task: null,
      })),
  ]

  /*
   * ⚠️ TIER FIRST, THEN TIME — never time alone. An overdue task from this
   * morning must not outrank a reply from last week: the whole ordering exists
   * because a person waiting on an answer is more urgent than a reminder
   * somebody set for themselves. Sorting the flattened list by `at` would undo
   * the spec's ranking and look like a sensible tidy-up while doing it.
   */
  return items.sort((a, b) => {
    const tier = WORK_REASONS.indexOf(a.reason) - WORK_REASONS.indexOf(b.reason)
    if (tier !== 0) return tier
    if (a.at === null || b.at === null) return 0
    return a.at < b.at ? -1 : a.at > b.at ? 1 : 0
  })
}
