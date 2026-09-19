'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import {
  createListAction,
  deleteListAction,
  renameListAction,
  type ListActionState,
} from '@/app/(product)/crm/lists/actions'

/**
 * Collapses a revealed form once its action reports success.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOT `useEffect(() => { if (state.ok) setMode('idle') })`.            ║
 * ║                                                                           ║
 * ║  Two reasons, and the second is the one that bites:                       ║
 * ║                                                                           ║
 * ║   1. `react-hooks/set-state-in-effect` rejects it — setting state in an    ║
 * ║      effect renders the open form once before closing it, so the panel     ║
 * ║      visibly flickers.                                                    ║
 * ║                                                                           ║
 * ║   2. A success state from `useActionState` PERSISTS until the next         ║
 * ║      submission. So "close whenever `state.ok`" latches: after one         ║
 * ║      successful rename the form can never be opened again, because the     ║
 * ║      condition is still true the next time the button is pressed. That is  ║
 * ║      a much worse bug than the flicker and it would only show up on the    ║
 * ║      SECOND use.                                                          ║
 * ║                                                                           ║
 * ║  So the trigger is the ARRIVAL of a new result, not its value — compared   ║
 * ║  during render, which is React's documented way to adjust state from a     ║
 * ║  changed input without an effect.                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
function useCollapseOnSuccess(result: ListActionState, collapse: () => void) {
  const [seen, setSeen] = useState<ListActionState>(null)

  if (result !== seen) {
    setSeen(result)
    if (result?.ok) collapse()
  }
}

/**
 * Creating, renaming and deleting a list.
 *
 * ⚠️ THE ENTRANCE THE FEATURE NEVER HAD. See the header of
 * `app/(product)/crm/lists/actions.ts`: every other part of lists shipped and
 * worked, and nothing anywhere created one — which hid the "Add to list…"
 * picker on the contacts screen too, because it is gated on there being at
 * least one list.
 *
 * ⚠️ RENDERED FOR SOMEONE WHO HOLDS `crm.contact.edit`, decided by the page.
 * That is presentation, not authorization — each action re-asserts the
 * permission server-side, because a hidden button is not a gate.
 */
export function NewListButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<ListActionState, FormData>(
    createListAction,
    null,
  )

  /*
   * ⚠️ CLOSE AND REFRESH, the lesson from `PipelineSetup`: an action that
   * writes a row and leaves the screen exactly as it was is indistinguishable
   * from one that failed, and people press it again until they have seven.
   */
  useCollapseOnSuccess(state, () => setOpen(false))

  // `revalidatePath` alone leaves this Client Component's parent rendering the
  // cached list — the same reason `PipelineManager` refreshes after a rename.
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
      >
        New list
      </button>
    )
  }

  return (
    <form action={action} className="clay w-full max-w-md space-y-3 p-4">
      <label className="block">
        <span className="text-xs font-medium text-ink">List name</span>
        <input
          name="name"
          required
          maxLength={120}
          autoFocus
          placeholder="Warm leads"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink">
          Description <span className="text-muted">(optional)</span>
        </span>
        <input
          name="description"
          maxLength={280}
          placeholder="What this list is for"
          className="mt-1 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create list'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
        >
          Cancel
        </button>
        <Feedback state={state} />
      </div>
    </form>
  )
}

/** Rename and delete, revealed per list rather than shown on every card. */
export function ListActions({ listId, name }: { listId: string; name: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'rename' | 'confirm-delete'>('idle')

  const [renameState, rename, renaming] = useActionState<ListActionState, FormData>(
    renameListAction,
    null,
  )
  const [deleteState, remove, removing] = useActionState<ListActionState, FormData>(
    deleteListAction,
    null,
  )

  useCollapseOnSuccess(renameState, () => setMode('idle'))
  useCollapseOnSuccess(deleteState, () => setMode('idle'))

  useEffect(() => {
    if (renameState?.ok || deleteState?.ok) router.refresh()
  }, [renameState, deleteState, router])

  if (mode === 'rename') {
    return (
      <form action={rename} className="mt-3 space-y-2">
        <input type="hidden" name="listId" value={listId} />
        <input
          name="name"
          defaultValue={name}
          required
          maxLength={120}
          aria-label="List name"
          autoFocus
          className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={renaming}
            className="rounded-[var(--radius-md)] border border-border-strong bg-panel px-2.5 py-1 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
          >
            {renaming ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            Cancel
          </button>
        </div>
        <Feedback state={renameState} />
      </form>
    )
  }

  if (mode === 'confirm-delete') {
    return (
      <form action={remove} className="mt-3 space-y-2">
        <input type="hidden" name="listId" value={listId} />
        {/*
          ⚠️ SAYS WHAT SURVIVES, BEFORE THE CLICK. The fear about deleting a
          list is that the people on it go too. They do not — a list is an
          association, not a container — and the copy has to say so here rather
          than in a toast afterwards.
        */}
        <p className="text-sm text-ink">
          Delete <span className="font-semibold">{name}</span>? The contacts on it are
          not deleted and stay in your CRM.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={removing}
            className="rounded-[var(--radius-md)] bg-danger px-2.5 py-1 text-xs font-semibold text-cream transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
          >
            {removing ? 'Deleting…' : 'Delete list'}
          </button>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
          >
            Keep it
          </button>
        </div>
        <Feedback state={deleteState} />
      </form>
    )
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        onClick={() => setMode('rename')}
        className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={() => setMode('confirm-delete')}
        className="text-xs font-medium text-muted transition-colors duration-150 hover:text-danger"
      >
        Delete
      </button>
      <Feedback state={deleteState} />
    </div>
  )
}

/** Announced as well as shown — matches `PipelineSetup` and `PipelineManager`. */
function Feedback({ state }: { state: ListActionState }) {
  if (!state) return null
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}
    >
      {state.ok ? state.message : state.error}
    </p>
  )
}
