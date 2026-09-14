import type { Metadata } from 'next'
import Link from 'next/link'

import { LocalTime } from '@/components/ui/LocalTime'
import { listMyWork, REASON_LABEL, type WorkReason } from '@/lib/crm/my-work'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'

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

  const items = await listMyWork({
    workspaceId: ctx.workspace.id,
    userId: ctx.userId!,
  })

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
            has a next action booked.
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
            <li key={item.key}>
              <Link
                href={item.href}
                className="clay flex flex-wrap items-center justify-between gap-3 p-4 transition-colors duration-150 hover:border-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                  {item.context ? (
                    <p className="mt-0.5 truncate text-xs text-muted">{item.context}</p>
                  ) : null}
                </div>

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
                  {item.at ? (
                    <LocalTime iso={item.at} className="text-xs text-muted" />
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
