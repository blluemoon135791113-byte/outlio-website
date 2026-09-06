'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { backfillCompaniesAction, type AdminActionState } from '@/lib/admin/actions'

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
      {pending ? 'Linking…' : 'Run backfill'}
    </button>
  )
}

/**
 * Links leads extracted before company identity existed.
 *
 * Presentation only — `backfillCompaniesAction` calls `assertAdmin()` itself.
 * Hiding this control is not access control.
 */
export function CompanyBackfill() {
  const [state, action] = useActionState(backfillCompaniesAction, INITIAL)

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <RunButton />
      {state.status !== 'idle' ? (
        <p
          role="status"
          className={
            state.status === 'error'
              ? 'text-sm text-danger'
              : 'text-sm text-muted'
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}
