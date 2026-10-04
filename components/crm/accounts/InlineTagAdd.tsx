'use client'

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

import {
  createTagGroupAction,
  createTagValueAction,
  type TagSettingsState,
} from '@/lib/crm/tag-group-actions'

const CHIP =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150'
const INPUT = 'w-44 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink'

/**
 * Adding to the workspace's OWN vocabulary from where it is used. Every chip
 * row on the Accounts list is a tag group this workspace defined; nothing in
 * it is fixed. Only shown to people with `config.manage` — the action checks
 * that again.
 *
 * ⚠️ onSubmit, not `action={…}`: React 19 resets the form after the action,
 * and a refused name ("already used here") must stay typed.
 */
function InlineAdd({
  label,
  placeholder,
  action: serverAction,
  hidden,
  dashed = true,
}: {
  label: string
  placeholder: string
  action: (state: TagSettingsState, form: FormData) => Promise<TagSettingsState>
  hidden: Record<string, string>
  dashed?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState<TagSettingsState, FormData>(serverAction, null)
  const input = useRef<HTMLInputElement>(null)
  const submitted = useRef<TagSettingsState>(null)

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // A success from THIS form closes it and re-reads the page (chips and counts).
  useEffect(() => {
    if (state?.ok && state !== submitted.current) {
      submitted.current = state
      setOpen(false)
      router.refresh()
    }
  }, [state, router])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    startTransition(() => action(data))
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${CHIP} ${dashed ? 'border-dashed' : ''} border-border-strong bg-panel text-muted hover:text-ink`}
      >
        {label}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="inline-flex flex-wrap items-center gap-1.5" noValidate>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="sr-only" htmlFor={`inline-add-${hidden.groupId ?? hidden.entity}`}>
        {placeholder}
      </label>
      <input
        ref={input}
        id={`inline-add-${hidden.groupId ?? hidden.entity}`}
        name="name"
        required
        maxLength={60}
        placeholder={placeholder}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        className={INPUT}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
      >
        {pending ? 'Adding…' : 'Add'}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-1.5 py-1 text-xs text-muted hover:text-ink">
        Cancel
      </button>
      {state && !state.ok ? (
        <span role="status" aria-live="polite" className="text-xs text-danger">
          {state.message}
        </span>
      ) : null}
    </form>
  )
}

export function AddTagChip({ groupId, groupName }: { groupId: string; groupName: string }) {
  return (
    <InlineAdd
      label="+ Add tag"
      placeholder={`New ${groupName} tag`}
      action={createTagValueAction}
      hidden={{ groupId, description: '', aliases: '' }}
    />
  )
}

export function AddTagGroup() {
  return (
    <InlineAdd
      label="+ New tag group"
      placeholder="Group name, e.g. Region"
      action={createTagGroupAction}
      hidden={{ entity: 'company' }}
      dashed={false}
    />
  )
}
