'use client'

import { startTransition, useActionState, useRef, useState, type FormEvent, type ReactNode } from 'react'

import {
  createTagGroupAction,
  createTagValueAction,
  deleteTagGroupAction,
  deleteTagValueAction,
  moveTagGroupAction,
  moveTagValueAction,
  updateTagGroupAction,
  updateTagValueAction,
  type TagSettingsState,
} from '@/lib/crm/tag-group-actions'
import type { TagEntity, TagGroup, TagValue } from '@/lib/crm/tag-groups'

const INPUT = 'rounded-[var(--radius-md)] border border-line bg-surface px-2.5 py-1.5 text-sm text-ink'
const PRIMARY =
  'rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60'
const QUIET =
  'rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:opacity-40'
const DANGER =
  'rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:bg-danger-soft hover:text-danger disabled:opacity-40'

/**
 * One small form around one action, without React 19's post-action reset
 * (a refused rename keeps what was typed) — except where `resetOnSuccess`
 * asks for it, as "Add" forms do once the thing exists.
 */
function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  showStatus = true,
}: {
  action: (previous: TagSettingsState, form: FormData) => Promise<TagSettingsState>
  children: (pending: boolean) => ReactNode
  className?: string
  resetOnSuccess?: boolean
  showStatus?: boolean
}) {
  const ref = useRef<HTMLFormElement>(null)
  const [state, dispatch, pending] = useActionState<TagSettingsState, FormData>(async (previous, form) => {
    const result = await action(previous, form)
    if (result?.ok && resetOnSuccess) ref.current?.reset()
    return result
  }, null)

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter)
    startTransition(() => dispatch(data))
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className={className}>
      {children(pending)}
      {showStatus && state ? (
        <p role="status" aria-live="polite" className={state.ok ? 'text-xs text-muted' : 'text-xs text-danger'}>
          {state.message}
        </p>
      ) : null}
    </form>
  )
}

export function TagSettings({ accountGroups, leadGroups }: { accountGroups: TagGroup[]; leadGroups: TagGroup[] }) {
  return (
    <div className="space-y-8">
      <EntitySection
        entity="company"
        title="Account tags"
        description="Each group becomes a chip row on the Accounts list and a field on every account — for example Industry, Product or Region."
        groups={accountGroups}
      />
      <EntitySection
        entity="contact"
        title="Lead tags"
        description="Groups for leads — for example Seniority or Persona. They become chip rows on the Leads list."
        groups={leadGroups}
      />
    </div>
  )
}

function EntitySection({
  entity,
  title,
  description,
  groups,
}: {
  entity: TagEntity
  title: string
  description: string
  groups: TagGroup[]
}) {
  return (
    <section aria-labelledby={`tags-${entity}`} className="space-y-3">
      <div>
        <h2 id={`tags-${entity}`} className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>

      {groups.length === 0 ? (
        <div className="clay p-6 text-center">
          <p className="text-sm text-ink">No groups yet.</p>
          <p className="mt-1 text-xs text-muted">Add the first one below. Nothing is preset — your workspace decides.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group, index) => (
            <li key={group.id}>
              <GroupCard group={group} isFirst={index === 0} isLast={index === groups.length - 1} />
            </li>
          ))}
        </ul>
      )}

      <ActionForm action={createTagGroupAction} resetOnSuccess className="clay flex flex-wrap items-end gap-3 p-4">
        {(pending) => (
          <>
            <input type="hidden" name="entity" value={entity} />
            <label className="text-xs font-medium text-ink">
              New group
              <input name="name" required maxLength={60} placeholder={entity === 'company' ? 'e.g. Industry' : 'e.g. Seniority'} className={`mt-1 block w-56 ${INPUT}`} />
            </label>
            {entity === 'company' ? (
              <label className="flex items-center gap-2 pb-2 text-xs text-ink" title="One value per account can be marked as its main one, like a primary industry.">
                <input type="checkbox" name="hasPrimary" className="h-3.5 w-3.5" />
                One value can be primary
              </label>
            ) : null}
            <button type="submit" disabled={pending} className={PRIMARY}>
              {pending ? 'Adding…' : 'Add group'}
            </button>
          </>
        )}
      </ActionForm>
    </section>
  )
}

function GroupCard({ group, isFirst, isLast }: { group: TagGroup; isFirst: boolean; isLast: boolean }) {
  const [renaming, setRenaming] = useState(false)

  return (
    <div id={`group-${group.id}`} className={`clay scroll-mt-24 space-y-3 p-4 ${group.isActive ? '' : 'opacity-75'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <ActionForm action={updateTagGroupAction} className="flex flex-wrap items-center gap-2">
            {(pending) => (
              <>
                <input type="hidden" name="groupId" value={group.id} />
                <label className="sr-only" htmlFor={`group-name-${group.id}`}>Group name</label>
                <input id={`group-name-${group.id}`} name="name" defaultValue={group.name} required maxLength={60} className={INPUT} />
                <button type="submit" disabled={pending} className={PRIMARY}>Save</button>
                <button type="button" onClick={() => setRenaming(false)} className={QUIET}>Done</button>
              </>
            )}
          </ActionForm>
        ) : (
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-ink">{group.name}</h3>
            {!group.isActive ? <span className="text-xs text-muted">Disabled — hidden from lists and pickers</span> : null}
            {group.hasPrimary ? <span className="text-xs text-muted">· one value can be primary</span> : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {!renaming ? (
            <button type="button" onClick={() => setRenaming(true)} className={QUIET}>
              Rename
            </button>
          ) : null}
          <Toggle action={updateTagGroupAction} idName="groupId" id={group.id} field="isActive" on={group.isActive} onLabel="Disable" offLabel="Enable" />
          {group.entity === 'company' ? (
            <Toggle
              action={updateTagGroupAction}
              idName="groupId"
              id={group.id}
              field="hasPrimary"
              on={group.hasPrimary}
              onLabel="No primary"
              offLabel="Allow a primary"
            />
          ) : null}
          <Move action={moveTagGroupAction} idName="groupId" id={group.id} isFirst={isFirst} isLast={isLast} label={group.name} />
          <ActionForm action={deleteTagGroupAction} className="flex items-center gap-1">
            {(pending) => (
              <>
                <input type="hidden" name="groupId" value={group.id} />
                <button
                  type="submit"
                  disabled={pending || group.values.length > 0}
                  title={group.values.length > 0 ? 'Only an empty group can be deleted. Disable it instead.' : undefined}
                  className={DANGER}
                >
                  Delete
                </button>
              </>
            )}
          </ActionForm>
        </div>
      </div>

      {group.values.length === 0 ? (
        <p className="text-xs text-muted">No values yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-md)] border border-line">
          {group.values.map((value, index) => (
            <li key={value.id}>
              <ValueRow value={value} entity={group.entity} isFirst={index === 0} isLast={index === group.values.length - 1} />
            </li>
          ))}
        </ul>
      )}

      <ActionForm action={createTagValueAction} resetOnSuccess className="flex flex-wrap items-end gap-2">
        {(pending) => (
          <>
            <input type="hidden" name="groupId" value={group.id} />
            <label className="text-xs font-medium text-ink">
              Add a value
              <input name="name" required maxLength={60} className={`mt-1 block w-48 ${INPUT}`} />
            </label>
            <label className="text-xs font-medium text-ink">
              Full name or note <span className="font-normal text-muted">(optional)</span>
              <input name="description" maxLength={200} className={`mt-1 block w-64 ${INPUT}`} />
            </label>
            <label className="text-xs font-medium text-ink" title="Other spellings an import should recognise, separated by commas.">
              Also matches <span className="font-normal text-muted">(optional)</span>
              <input name="aliases" placeholder="e.g. Software, SaaS platform" className={`mt-1 block w-56 ${INPUT}`} />
            </label>
            <button type="submit" disabled={pending} className={PRIMARY}>
              {pending ? 'Adding…' : 'Add'}
            </button>
          </>
        )}
      </ActionForm>
    </div>
  )
}

function ValueRow({ value, entity, isFirst, isLast }: { value: TagValue; entity: TagEntity; isFirst: boolean; isLast: boolean }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <ActionForm action={updateTagValueAction} className="flex flex-wrap items-end gap-2 p-2">
        {(pending) => (
          <>
            <input type="hidden" name="valueId" value={value.id} />
            <label className="text-xs text-ink">
              Name
              <input name="name" defaultValue={value.name} required maxLength={60} className={`mt-1 block w-44 ${INPUT}`} />
            </label>
            <label className="text-xs text-ink">
              Full name or note
              <input name="description" defaultValue={value.description ?? ''} maxLength={200} className={`mt-1 block w-60 ${INPUT}`} />
            </label>
            <label className="text-xs text-ink">
              Also matches
              <input name="aliases" defaultValue={value.aliases.join(', ')} className={`mt-1 block w-52 ${INPUT}`} />
            </label>
            <button type="submit" disabled={pending} className={PRIMARY}>Save</button>
            <button type="button" onClick={() => setEditing(false)} className={QUIET}>Done</button>
          </>
        )}
      </ActionForm>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className={`text-sm ${value.isActive ? 'text-ink' : 'text-muted line-through'}`}>{value.name}</p>
        {value.description || value.aliases.length > 0 ? (
          <p className="truncate text-xs text-muted">
            {value.description}
            {value.description && value.aliases.length > 0 ? ' · ' : ''}
            {value.aliases.length > 0 ? `also matches ${value.aliases.join(', ')}` : ''}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setEditing(true)} className={QUIET}>
          Edit
        </button>
        <Toggle action={updateTagValueAction} idName="valueId" id={value.id} field="isActive" on={value.isActive} onLabel="Disable" offLabel="Enable" />
        <Move action={moveTagValueAction} idName="valueId" id={value.id} isFirst={isFirst} isLast={isLast} label={value.name} />
        <ActionForm action={deleteTagValueAction} className="flex items-center gap-1">
          {(pending) => (
            <>
              <input type="hidden" name="valueId" value={value.id} />
              <button
                type="submit"
                disabled={pending}
                title={`Only a value no ${entity === 'company' ? 'account' : 'lead'} carries can be deleted.`}
                className={DANGER}
              >
                Delete
              </button>
            </>
          )}
        </ActionForm>
      </div>
    </div>
  )
}

function Toggle({
  action,
  idName,
  id,
  field,
  on,
  onLabel,
  offLabel,
}: {
  action: (previous: TagSettingsState, form: FormData) => Promise<TagSettingsState>
  idName: string
  id: string
  field: string
  on: boolean
  onLabel: string
  offLabel: string
}) {
  return (
    <ActionForm action={action} className="flex items-center gap-1">
      {(pending) => (
        <>
          <input type="hidden" name={idName} value={id} />
          <input type="hidden" name={field} value={on ? 'false' : 'true'} />
          <button type="submit" disabled={pending} className={QUIET}>
            {on ? onLabel : offLabel}
          </button>
        </>
      )}
    </ActionForm>
  )
}

function Move({
  action,
  idName,
  id,
  isFirst,
  isLast,
  label,
}: {
  action: (previous: TagSettingsState, form: FormData) => Promise<TagSettingsState>
  idName: string
  id: string
  isFirst: boolean
  isLast: boolean
  label: string
}) {
  return (
    <ActionForm action={action} showStatus={false} className="flex items-center">
      {(pending) => (
        <>
          <input type="hidden" name={idName} value={id} />
          <button type="submit" name="direction" value="up" disabled={pending || isFirst} aria-label={`Move ${label} up`} className={QUIET}>
            ↑
          </button>
          <button type="submit" name="direction" value="down" disabled={pending || isLast} aria-label={`Move ${label} down`} className={QUIET}>
            ↓
          </button>
        </>
      )}
    </ActionForm>
  )
}
