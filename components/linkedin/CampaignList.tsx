'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { createCampaignAction, type CampaignActionState } from '@/app/(product)/linkedin/actions'
import type { CampaignProgress } from '@/lib/linkedin/campaign-progress'

export type CampaignCard = {
  id: string
  name: string
  state: string
  progress: CampaignProgress
  unconfirmedNote: string | null
}

/**
 * LinkedIn campaigns, with the part nobody else will say.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NO PROGRESS BAR, AND NO "x OF y DONE".                               ║
 * ║                                                                           ║
 * ║  Both need a single number, and a single number needs `unconfirmed` to be ║
 * ║  either done or outstanding. It is neither: the action may have happened  ║
 * ║  to a real person, and may not. A bar that renders 60% has quietly picked ║
 * ║  an answer on the reader's behalf and shown them nothing of the choice.   ║
 * ║                                                                           ║
 * ║  So the counts sit side by side and the uncertainty gets a sentence.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function CampaignList({ campaigns }: { campaigns: CampaignCard[] }) {
  const [state, action, pending] = useActionState<CampaignActionState, FormData>(
    createCampaignAction,
    null,
  )

  return (
    <div className="space-y-5">
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">New campaign</h2>
        <p className="mt-1 text-xs text-muted">
          Starts as a draft with nobody enrolled. Creating it performs no LinkedIn actions.
        </p>

        <form action={action} className="mt-3 flex flex-wrap items-end gap-3">
          {/*
            ⚠️ `min-w-[16rem]` ALONE OVERFLOWED, AND IT WAS THE ONLY HORIZONTAL
            OVERFLOW IN THE PRODUCT. A hard 256px floor ignores its container:
            measured at a 280px viewport it pushed the row 9px wide, while every
            other authenticated route measured clean at that width.

            The floor is only wanted when the field sits BESIDE the button. Below
            `sm` they stack, so it takes the full width and shrinks with the
            screen instead of insisting on a size the screen does not have.
          */}
          <label className="w-full flex-1 sm:w-auto sm:min-w-[16rem]">
            <span className="text-xs font-medium text-ink">Name</span>
            <input
              name="name"
              required
              maxLength={200}
              placeholder="Q4 founders — warm intros"
              className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-medium text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Create draft'}
          </button>
        </form>

        {state && !state.ok ? (
          <p role="alert" className="mt-3 text-xs text-danger">
            {state.error}
          </p>
        ) : null}
        {state?.ok ? (
          <p role="status" className="mt-3 text-xs text-muted">
            {state.message}
          </p>
        ) : null}
      </div>

      {campaigns.length === 0 ? (
        <div className="clay p-8 text-center">
          <h3 className="text-sm font-semibold text-ink">No campaigns yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            A campaign groups the people one outreach push is aimed at. You still perform
            every LinkedIn action yourself — Outlio only keeps track of what is waiting and
            what was done.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <li
              key={campaign.id}
              className="rounded-[var(--radius-lg)] border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {/*
                  ⚠️ THE NAME IS THE LINK, rather than a separate "Open" button.
                  It is the thing a reader is already looking at when they decide
                  to go in, and a row whose only affordance is a small button at
                  the end makes the card look read-only.
                */}
                <h3 className="text-sm font-semibold text-ink">
                  <Link
                    href={`/linkedin/campaigns/${campaign.id}`}
                    className="underline decoration-border decoration-dotted underline-offset-2 transition-colors duration-150 hover:text-accent hover:decoration-accent"
                  >
                    {campaign.name}
                  </Link>
                </h3>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {campaign.state.toLowerCase()}
                </span>
              </div>

              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                <Count label="People" value={campaign.progress.enrollments} />
                <Count label="Succeeded" value={campaign.progress.succeeded} />
                <Count label="Ended" value={campaign.progress.ended} />
                <Count label="In flight" value={campaign.progress.inFlight} />
                <Count label="Waiting on you" value={campaign.progress.tasksPending} />
              </dl>

              {/*
                ⚠️ THE SENTENCE, NOT A BADGE. A count rendered beside the others
                would read as a fourth category that adds up with them. It does
                not — an unconfirmed person is ALSO counted in succeeded, ended
                or in-flight, and the overlap is the whole point.
              */}
              {campaign.unconfirmedNote ? (
                <p className="mt-3 text-xs text-warning">{campaign.unconfirmedNote}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm tabular-nums text-ink">{value}</dd>
    </div>
  )
}
