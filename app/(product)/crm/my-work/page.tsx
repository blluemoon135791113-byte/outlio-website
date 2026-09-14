import type { Metadata } from 'next'
import Link from 'next/link'

import { WorkItemActions } from '@/components/crm/WorkItemActions'
import { LocalTime } from '@/components/ui/LocalTime'
import { listAssignableMembers } from '@/lib/crm/contacts-list'
import { listMyWork, REASON_LABEL, snoozeBounds, type WorkReason } from '@/lib/crm/my-work'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'My Work | Outlio',
  robots: { index: false, follow: false },
}

/**
 * My Work — §7's daily entry point.
 *
 * ⚠️ THE ORDER IS THE PRODUCT. `/crm/tasks` already lists tasks seven ways;
 * this screen exists to answer "what next, and why" in one ranked list, so it
 * renders `listMyWork` in the order it was given and sorts nothing.
 */

/*
 * Tone, not decoration: overdue is the only tier that gets the danger colour,
 * because if three of four tiers are red then none of them is.
 */
const REASON_TONE: Record<WorkReason, string> = {
  reply_awaiting: 'bg-accent-soft text-accent',
  overdue: 'bg-surface-muted text-danger',
  due_today: 'bg-surface-muted text-ink',
  deal_without_next_action: 'bg-surface-muted text-muted',
}

export default async function MyWorkPage() {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null

  const policy = { role: ctx.role, modules: ctx.modules }
  const canManage = can(policy, 'crm.task.manage')
  const canReassign = can(policy, 'crm.contact.assign')

  const [items, members] = await Promise.all([
    listMyWork({ workspaceId: ctx.workspace.id, userId: ctx.userId! }),
    // Only fetched for someone who may reassign; nobody else is shown the list.
    canReassign ? listAssignableMembers(ctx.workspace.id) : Promise.resolve([]),
  ])

  // Handing your own task to yourself is not a reassignment.
  const otherMembers = members.filter((m) => m.userId !== ctx.userId)

  /*
   * ⚠️ THE SNOOZE BOUNDS COME FROM THE SERVER. Computing "tomorrow" in the
   * client component would render one date on the server pass and another
   * after hydration whenever the two straddle midnight. The action and the
   * database re-check both bounds regardless.
   */
  const { minSnoozeDate, maxSnoozeDate } = snoozeBounds(new Date())

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">My Work</h2>
        <p className="mt-0.5 text-sm text-muted">
          Replies first, then what is overdue, then today, then deals with nothing booked.
        </p>
      </div>

      {items.length === 0 ? (
        /*
         * ⚠️ AN EMPTY QUEUE IS A RESULT, NOT A FAILURE. Every other empty state
         * in the product explains what is missing and how to add it; here the
         * absence is the good outcome and saying "no items found" would read as
         * something being broken.
         */
        <div className="clay p-8 text-center">
          <p className="text-sm font-medium text-ink">Nothing is waiting on you.</p>
          <p className="mt-1 text-sm text-muted">
            No unanswered replies, nothing overdue or due today, and every open deal you own
            has a next action booked. Snoozed tasks come back on their review date.
          </p>
          <Link
            href="/crm/pipeline"
            className="mt-4 inline-block rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
          >
            Open the pipeline
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="clay p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/*
                  ⚠️ THE LINK AND THE ACTIONS ARE SIBLINGS. The whole row used to
                  be one link; forms inside an anchor are invalid HTML and a
                  click on "Complete" would also navigate away.
                */}
                <Link href={item.href} className="group min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink transition-colors duration-150 group-hover:text-accent">
                    {item.title}
                  </p>
                  {item.context ? (
                    <p className="mt-0.5 truncate text-xs text-muted">{item.context}</p>
                  ) : null}
                </Link>

                <div className="flex shrink-0 items-center gap-2">
                  {/*
                    §7: "Explain every item with its reason and due time." The
                    reason is a label rather than a colour alone — a colour is
                    not a reason, and it is invisible to anyone who cannot see
                    the difference.
                  */}
                  <span
                    className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${REASON_TONE[item.reason]}`}
                  >
                    {REASON_LABEL[item.reason]}
                  </span>
                  {item.at ? <LocalTime iso={item.at} className="text-xs text-muted" /> : null}
                </div>
              </div>

              {item.task && canManage ? (
                <WorkItemActions
                  taskId={item.task.id}
                  version={item.task.version}
                  canReassign={canReassign}
                  members={otherMembers}
                  minSnoozeDate={minSnoozeDate}
                  maxSnoozeDate={maxSnoozeDate}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
