'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { runWorkersNow, type AdminActionState } from '@/lib/admin/worker-actions'

const INITIAL: AdminActionState = { status: 'idle' }

function RunButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium text-ink transition-[background-color,border-color,transform] duration-150 ease-out hover:border-border-strong active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Running…' : 'Run workers now'}
    </button>
  )
}

/**
 * Runs the background pass the cron runs, on demand.
 *
 * Presentation only — `runWorkersNow` calls `assertAdmin()` itself, which also
 * requires an AAL2 session. Hiding this control is not access control.
 */
export function RunWorkers() {
  const [state, action] = useActionState(runWorkersNow, INITIAL)

  return (
    <form action={action} className="space-y-2">
      <RunButton />
      {state.status !== 'idle' ? (
        <p
          role="status"
          className={
            state.status === 'error'
              ? 'text-sm text-danger'
              : /*
                 A per-job summary, wrapped rather than truncated: "send_email:
                 1 sent" and "sync_replies: failed — …" are the two things
                 somebody presses this to find out.
                */
                'whitespace-pre-wrap text-sm leading-relaxed text-muted'
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
