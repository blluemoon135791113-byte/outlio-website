'use client'

import { useActionState } from 'react'

import { launchCampaign, pauseCampaign, type ActionState } from '@/app/(product)/email/actions'

/**
 * Launch and pause.
 *
 * ⚠️ LAUNCHING IS IRREVERSIBLE IN THE ONLY WAY THAT MATTERS: mail that has gone
 * out cannot be recalled. Pausing stops anything further, but the button label
 * says "Launch" rather than "Save" so nobody presses it expecting a draft.
 */
export function CampaignControls({
  campaignId,
  status,
}: {
  campaignId: string
  status: string
}) {
  const [launchState, launch, launching] = useActionState<ActionState, FormData>(
    launchCampaign,
    null,
  )
  const [pauseState, pause, pausing] = useActionState<ActionState, FormData>(pauseCampaign, null)

  const state = launchState ?? pauseState

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {status === 'running' ? (
          <form action={pause}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <button
              type="submit"
              disabled={pausing}
              className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
            >
              {pausing ? 'Pausing…' : 'Pause'}
            </button>
          </form>
        ) : (
          <form action={launch}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <button
              type="submit"
              disabled={launching}
              className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
            >
              {launching ? 'Launching…' : status === 'paused' ? 'Resume' : 'Launch'}
            </button>
          </form>
        )}
      </div>

      {state ? (
        <p
          role={state.ok ? undefined : 'alert'}
          className={`max-w-xs text-xs leading-relaxed ${state.ok ? 'text-success' : 'text-danger'}`}
        >
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </div>
  )
}
