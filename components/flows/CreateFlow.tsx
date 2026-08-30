'use client'

import { useActionState, useState } from 'react'

import { createFlow, type ActionState } from '@/app/(product)/flows/actions'

export function CreateFlow() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createFlow, null)
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90"
      >
        New flow
      </button>
    )
  }

  return (
    <form action={action} className="clay w-full space-y-4 p-6">
      <h3 className="text-sm font-semibold text-ink">New flow</h3>

      <div>
        <label htmlFor="name" className="block text-xs font-semibold text-ink">Name</label>
        <input
          id="name" name="name" required placeholder="New lead — assign and follow up"
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-xs font-semibold text-ink">
          What it does
        </label>
        <input
          id="description" name="description" placeholder="Optional"
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
        />
      </div>

      {state && !state.ok ? (
        <p role="alert" className="rounded-[var(--radius-md)] bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-[var(--radius-md)] bg-success-soft px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit" disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create draft'}
        </button>
        <button
          type="button" onClick={() => setOpen(false)}
          className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
