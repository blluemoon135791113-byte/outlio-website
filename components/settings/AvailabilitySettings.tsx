'use client'

import { useActionState } from 'react'

import { setMyAwayAction, type AvailabilityActionState } from '@/app/(product)/dashboard/settings/availability-actions'
import { LocalTime } from '@/components/ui/LocalTime'

const INPUT =
  'w-auto rounded-[var(--radius-md)] border border-border bg-panel px-2.5 py-1.5 text-sm text-ink focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30'
const OUTLINE_BUTTON =
  'shrink-0 rounded-[var(--radius-md)] border border-border-strong bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60'
const TEXT_BUTTON =
  'rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:underline disabled:opacity-60'

/**
 * Your own availability for routed leads, in the workspace you are signed in to.
 *
 * ⚠️ NO USER ID IN THIS FORM. The action always changes the caller's own row;
 * a hidden field here would only invite someone to edit it.
 */
export function AvailabilitySettings({
  workspaceName,
  awayUntil,
  minAwayDate,
}: {
  workspaceName: string
  /** Only ever a future date — a passed one arrives as `null`. */
  awayUntil: string | null
  minAwayDate: string
}) {
  const [state, action, pending] = useActionState<AvailabilityActionState, FormData>(setMyAwayAction, null)

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">Availability for new leads</p>
        <p className="text-xs text-muted">
          {awayUntil ? (
            <>
              {'You are away in '}
              {workspaceName}
              {' until '}
              <LocalTime iso={awayUntil} dateOnly />
              {'. Routing gives you no new leads until then.'}
            </>
          ) : (
            <>
              {'You are available in '}
              {workspaceName}
              {'. Set a return date to stop receiving routed leads while you are away. Leads you already own stay yours.'}
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="my-away-until">Away until</label>
        <input id="my-away-until" name="awayUntil" type="date" min={minAwayDate} className={INPUT} />
        <button type="submit" disabled={pending} className={OUTLINE_BUTTON}>
          {pending ? 'Saving…' : awayUntil ? 'Change return date' : 'Mark me away'}
        </button>
        {awayUntil ? (
          <button
            type="submit"
            disabled={pending}
            className={TEXT_BUTTON}
            // Clears the date: an empty `awayUntil` means available again.
            onClick={(event) => {
              const input = event.currentTarget.form?.elements.namedItem('awayUntil') as HTMLInputElement | null
              if (input) input.value = ''
            }}
          >
            I&rsquo;m back
          </button>
        ) : null}
      </div>

      {state ? (
        <p role="status" aria-live="polite" className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </form>
  )
}
