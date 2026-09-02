'use client'

import { useActionState, useState } from 'react'

import { createFlow, type ActionState } from '@/app/(product)/flows/actions'
import { FLOW_TEMPLATES } from '@/lib/flows/templates'

export function CreateFlow() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createFlow, null)
  const [open, setOpen] = useState(false)
  const [template, setTemplate] = useState('')

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

      {/*
        ⚠️ A BLANK CANVAS IS WHY AUTOMATION GOES UNUSED. "Create flow" used to
        open an empty graph and ask someone to invent a trigger, a condition
        and a branch before they had ever watched one run. Starting from a
        working example is the difference between trying it and closing it.
      */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink">Start from</legend>

        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="template"
            value=""
            checked={template === ''}
            onChange={() => setTemplate('')}
            className="mt-1"
          />
          <span>
            <span className="block text-sm text-ink">Nothing — build it myself</span>
            <span className="block text-xs text-muted">An empty flow you wire up by hand.</span>
          </span>
        </label>

        {FLOW_TEMPLATES.map((option) => (
          <label key={option.key} className="flex items-start gap-2">
            <input
              type="radio"
              name="template"
              value={option.key}
              checked={template === option.key}
              onChange={() => setTemplate(option.key)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm text-ink">{option.name}</span>
              <span className="block text-xs text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/*
        Says plainly that nothing starts running. The fear about templates is
        that picking one to look at it sets it loose on real contacts.
      */}
      <p className="text-xs text-muted">
        Whichever you pick, the flow is created as a draft. Nothing runs until you publish
        it.
      </p>

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
        <p role="status" aria-live="polite" className="rounded-[var(--radius-md)] bg-success-soft px-3 py-2 text-sm text-success">
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
