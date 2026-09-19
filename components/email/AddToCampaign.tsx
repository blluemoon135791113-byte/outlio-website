'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { enrolContacts, type ActionState } from '@/app/(product)/email/actions'
import {
  AudiencePicker,
  type AudienceCatalogue,
} from '@/components/crm/AudiencePicker'

/**
 * Adding people to a campaign, from the campaign.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE GAP THIS FILLS WAS A DEAD END WITH A SIGNPOST.                      ║
 * ║                                                                           ║
 * ║  The campaign page listed "Contacts enrolled" as a launch requirement and ║
 * ║  offered no way to meet it. The only enrolment path in the product was a  ║
 * ║  dropdown inside the selection toolbar on the CONTACTS screen — so the    ║
 * ║  page that told you what was missing was not the page that could fix it,  ║
 * ║  and nothing connected the two.                                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IT DOES NOT HIDE ITSELF ON A RUNNING CAMPAIGN. Adding people to something
 * already sending is normal and `bulkEnroll` handles it — the scheduler picks
 * up the new enrolments on the next tick. Only `stopped` and `completed` refuse,
 * and they refuse server-side with a reason.
 */
export function AddToCampaign({
  campaignId,
  catalogue,
  enrolledCount,
}: {
  campaignId: string
  catalogue: AudienceCatalogue
  enrolledCount: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<ActionState, FormData>(
    enrolContacts,
    null,
  )

  /*
   * ⚠️ REFRESH ON SUCCESS, DO NOT CLOSE. Unlike the pipeline form, the useful
   * next action here is often ANOTHER add — a list, then a stage, then the
   * stragglers. Closing would make the common case a three-click reopen, and
   * the recipient counter above updates in place to show it worked.
   */
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  return (
    <section className="clay space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Who this goes to</h3>
          <p className="mt-0.5 text-xs text-muted">
            {enrolledCount === 0
              ? 'Nobody is enrolled yet. This campaign cannot launch until somebody is.'
              : `${enrolledCount.toLocaleString()} ${enrolledCount === 1 ? 'person' : 'people'} enrolled.`}
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
          >
            Add contacts
          </button>
        ) : null}
      </div>

      {open ? (
        <form action={action} className="space-y-3 border-t border-border pt-3">
          <input type="hidden" name="campaignId" value={campaignId} />

          <AudiencePicker catalogue={catalogue} />

          {/*
            ⚠️ THE COLLISION ACKNOWLEDGEMENT IS OFFERED, NOT ASSUMED.
            `bulkEnroll` refuses a contact already live in another campaign
            unless this is set — the guard against one person receiving two
            unrelated sequences at once. Defaulting it ON would quietly remove
            a protection the enroller deliberately made opt-in.
          */}
          <label className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <input
              type="checkbox"
              name="acknowledgeCollisions"
              className="mt-0.5"
            />
            <span>
              Add people who are already in another live campaign. Off by default, so
              nobody receives two sequences at once by accident.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
            >
              {pending ? 'Adding…' : 'Add to campaign'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
            >
              Done
            </button>
            <Link
              href="/crm/contacts"
              className="text-xs font-medium text-muted underline underline-offset-2 transition-colors duration-150 hover:text-ink"
            >
              Or pick people one by one
            </Link>
          </div>

          {/*
            ⚠️ `summarize` NAMES EVERY SKIP and this must render all of it.
            "28 enrolled" out of 40 chosen, with the other 12 unexplained, is
            the number a customer builds a forecast on.
          */}
          {state ? (
            <p
              role="status"
              aria-live="polite"
              className={`whitespace-pre-line rounded-[var(--radius-md)] px-3 py-2 text-xs leading-relaxed ${
                state.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
              }`}
            >
              {state.ok ? state.message : state.error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  )
}
