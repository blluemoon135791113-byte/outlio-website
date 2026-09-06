'use client'

import { useActionState, useState } from 'react'

import {
  updateSendingSettings,
  type SendingSettingsState,
} from '@/app/(product)/email/actions'

export type AccountSchedule = {
  id: string
  displayName: string
  timezone: string
  sendWindowStart: string
  sendWindowEnd: string
  sendDays: number[]
  dailySendLimit: number | null
  minDelaySeconds: number
  rampEnabled: boolean
}

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]

/**
 * A mailbox's sending schedule and ramp — R13.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ENFORCED SINCE M5, EDITABLE BY NOBODY UNTIL NOW.                        ║
 * ║                                                                           ║
 * ║  Every field here is read on each enqueue: a message outside the window   ║
 * ║  is refused, the ramp caps the daily allowance. All of it sat at its      ║
 * ║  default because nothing in the product could change it — so a customer   ║
 * ║  in Karachi sent on London hours.                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function SendingSettings({ account }: { account: AccountSchedule }) {
  const [state, action, pending] = useActionState<SendingSettingsState, FormData>(
    updateSendingSettings,
    null,
  )
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
      >
        Sending settings
      </button>
    )
  }

  return (
    <form action={action} className="clay mt-2 space-y-4 p-4">
      <input type="hidden" name="accountId" value={account.id} />

      <div>
        <h4 className="text-sm font-semibold text-ink">When {account.displayName} sends</h4>
        <p className="mt-0.5 text-xs text-muted">
          Mail is only sent inside this window. Anything raised outside it waits.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-ink">Timezone</span>
          <input
            name="timezone"
            defaultValue={account.timezone}
            required
            spellCheck={false}
            placeholder="Europe/London"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          {/*
            An IANA name, not an offset — an offset is wrong twice a year, and
            the wrongness lands exactly when a campaign is mid-flight.
          */}
          <span className="mt-1 block text-xs text-muted">
            An IANA name, so daylight saving is handled for you.
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">From</span>
          <input
            name="sendWindowStart"
            type="time"
            defaultValue={account.sendWindowStart.slice(0, 5)}
            required
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Until</span>
          <input
            name="sendWindowEnd"
            type="time"
            defaultValue={account.sendWindowEnd.slice(0, 5)}
            required
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink [color-scheme:light]"
          />
        </label>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-ink">Days</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {DAYS.map((day) => (
            <label key={day.value} className="flex items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                name="sendDays"
                value={day.value}
                defaultChecked={account.sendDays.includes(day.value)}
                className="h-4 w-4"
              />
              {day.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink">Daily limit</span>
          <input
            name="dailySendLimit"
            type="number"
            min={0}
            defaultValue={account.dailySendLimit ?? ''}
            placeholder="No limit of your own"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          {/*
            ⚠️ BLANK IS NOT ZERO. Blank means "no cap beyond the ramp"; zero
            would stop the mailbox entirely, which is a thing someone might
            want but never by leaving a field empty.
          */}
          <span className="mt-1 block text-xs text-muted">
            Leave blank for no cap of your own. The ramp still applies.
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink">Gap between sends</span>
          <input
            name="minDelaySeconds"
            type="number"
            min={0}
            defaultValue={account.minDelaySeconds}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
          <span className="mt-1 block text-xs text-muted">
            Seconds. A steady trickle looks less like a machine than a burst.
          </span>
        </label>
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="rampEnabled"
          defaultChecked={account.rampEnabled}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="block text-xs font-medium text-ink">Ramp up gradually</span>
          {/*
            Says what turning it OFF means, because that is the risky
            direction and the one someone clicks without thinking.
          */}
          <span className="block text-xs text-muted">
            Starts low and increases daily. Turning this off sends at full volume
            immediately, which is how a new domain gets filtered.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>

        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${state?.ok ? 'text-success' : 'text-danger'}`}
        >
          {state ? (state.ok ? state.message : state.error) : ''}
        </p>
      </div>
    </form>
  )
}
