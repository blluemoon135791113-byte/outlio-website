'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState } from 'react'

import { editListAction, type PipelineActionState } from '@/app/(product)/crm/pipeline/actions'

/** Runs `editListAction` and refreshes the board when it succeeds. */
function useListEdit() {
  const router = useRouter()
  const [state, action, pending] = useActionState<PipelineActionState, FormData>(editListAction, null)
  useEffect(() => {
    if (state?.ok) router.refresh()
  }, [state, router])
  return { state, action, pending }
}

const menuButton =
  'block w-full rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-xs text-ink hover:bg-surface-muted disabled:opacity-40'

/** The ⋯ menu on a list header: rename, move left/right, remove. */
export function ListMenu({
  pipelineId,
  stageId,
  name,
  isFirst,
  isLast,
}: {
  pipelineId: string
  stageId: string
  name: string
  isFirst: boolean
  isLast: boolean
}) {
  const { state, action, pending } = useListEdit()
  const [renaming, setRenaming] = useState(false)

  if (renaming && !state?.ok) {
    return (
      <form action={action} className="flex w-full items-center gap-1">
        <input type="hidden" name="op" value="rename" />
        <input type="hidden" name="pipelineId" value={pipelineId} />
        <input type="hidden" name="stageId" value={stageId} />
        <input
          name="name"
          defaultValue={name}
          maxLength={120}
          autoFocus
          aria-label="List name"
          className="field min-w-0 flex-1 px-2 py-1 text-xs text-ink"
        />
        <button type="submit" disabled={pending} className="rounded-[var(--radius-sm)] bg-accent px-2 py-1 text-xs font-semibold text-white">
          Save
        </button>
        <button type="button" onClick={() => setRenaming(false)} className="px-1 text-xs text-muted hover:text-ink">
          Cancel
        </button>
      </form>
    )
  }

  return (
    <details className="relative">
      <summary
        aria-label={`List options for ${name}`}
        className="flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-[var(--radius-sm)] text-muted hover:bg-panel hover:text-ink [&::-webkit-details-marker]:hidden"
      >
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-40 rounded-[var(--radius-md)] border border-border bg-panel p-1 shadow-[var(--shadow-md)]">
        <button type="button" onClick={() => setRenaming(true)} className={menuButton}>
          Rename
        </button>
        <form action={action}>
          <input type="hidden" name="pipelineId" value={pipelineId} />
          <input type="hidden" name="stageId" value={stageId} />
          <button name="op" value="left" disabled={pending || isFirst} className={menuButton}>
            Move left
          </button>
          <button name="op" value="right" disabled={pending || isLast} className={menuButton}>
            Move right
          </button>
          <button name="op" value="remove" disabled={pending} className={`${menuButton} text-danger`}>
            Remove list
          </button>
        </form>
        {state && !state.ok ? <p role="alert" className="px-2.5 py-1 text-xs text-danger">{state.error}</p> : null}
      </div>
    </details>
  )
}

/** The trailing "Add list" column. */
export function AddList({ pipelineId }: { pipelineId: string }) {
  const { state, action, pending } = useListEdit()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-[280px] shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border-strong text-sm font-medium text-muted hover:border-accent/40 hover:text-ink"
      >
        + Add list
      </button>
    )
  }

  return (
    <form
      action={action}
      key={state?.ok ? 'done' : 'editing'}
      className="w-[280px] shrink-0 space-y-2 rounded-[var(--radius-lg)] bg-surface-muted p-2"
    >
      <input type="hidden" name="op" value="add" />
      <input type="hidden" name="pipelineId" value={pipelineId} />
      <input
        name="name"
        required
        maxLength={120}
        autoFocus
        placeholder="List name"
        aria-label="List name"
        className="field w-full px-2.5 py-1.5 text-sm text-ink"
      />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
          {pending ? 'Adding…' : 'Add list'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
          Cancel
        </button>
      </div>
      {state && !state.ok ? <p role="alert" className="text-xs text-danger">{state.error}</p> : null}
    </form>
  )
}
