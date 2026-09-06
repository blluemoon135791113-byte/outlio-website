'use client'

import { useActionState, useRef, useState } from 'react'

import { enrolContacts, type ActionState } from '@/app/(product)/email/actions'
import {
  bulkAddToListAction,
  bulkAssignAction,
  bulkDeleteAction,
  bulkTagAction,
  type BulkAssignState,
  type BulkState,
} from '@/lib/crm/contact-actions'

export type Assignee = { id: string; name: string }
export type EnrollableCampaign = { id: string; name: string }
export type Taggable = { id: string; name: string }

/**
 * Selecting contacts and assigning them in one go — R2.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS CLOSES A LOOP R1 DELIBERATELY OPENED.                              ║
 * ║                                                                           ║
 * ║  Imported and extracted leads arrive UNASSIGNED on purpose — handing five ║
 * ║  hundred contacts to whoever clicked the button is wrong most of the      ║
 * ║  time. That is only defensible if distributing them afterwards is easy,   ║
 * ║  and until now nothing could assign more than one contact at a time.      ║
 * ║                                                                           ║
 * ║  ⚠️ THE SELECTION IS THE FORM. Each checkbox is a real                    ║
 * ║  `<input name="contactId">` inside this form, so the submitted set is by  ║
 * ║  definition what is ticked on screen. Mirroring it into React state is    ║
 * ║  how a list ends up submitting ids from the previous page.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function BulkAssign({
  assignees,
  campaigns = [],
  tags = [],
  lists = [],
  canAssign,
  canEdit = false,
  canDelete = false,
  children,
}: {
  assignees: Assignee[]
  /**
   * Campaigns this workspace may enrol into. Empty when the caller lacks
   * `email.campaign.create`, which hides the control rather than disabling it.
   */
  campaigns?: EnrollableCampaign[]
  /** Tags and lists to bulk-apply. Empty when the caller lacks `crm.contact.edit`. */
  tags?: Taggable[]
  lists?: Taggable[]
  /** `crm.contact.assign` — manager and above. */
  canAssign: boolean
  /** `crm.contact.edit` — SETTER and above, which is why it is separate. */
  canEdit?: boolean
  /** `crm.contact.delete` — manager and above. */
  canDelete?: boolean
  /** The table. Its checkboxes must be `<input name="contactId">`. */
  children: React.ReactNode
}) {
  /*
   * ⚠️ SPLIT SO THE HOOKS LIVE ONLY IN THE BRANCH THAT USES THEM. Returning
   * early from a single component would call `useRef` and `useState`
   * conditionally, which React forbids — and `tsc` cannot see it. ESLint's
   * rules-of-hooks caught this exact mistake here.
   *
   * A setter sees the table and nothing else: wrapping it in a form with a
   * permanently disabled bar advertises an action they can never take.
   */
  /*
   * ⚠️ NOT `canAssign` ALONE, AND THAT WAS A REAL GAP. `crm.contact.assign` is
   * manager-and-above; `crm.contact.edit` is SETTER-and-above. Gating the whole
   * bar — checkboxes included — on assign meant a setter got no selection UI at
   * all, so bulk tagging and list-adding would have been unreachable for
   * exactly the role most likely to want them.
   *
   * Each control below still renders on its own permission. This only decides
   * whether there is anything to select FOR.
   */
  const showAssign = canAssign && assignees.length > 0
  const showTag = canEdit && tags.length > 0
  const showList = canEdit && lists.length > 0

  // A bar with checkboxes and no action is furniture.
  if (!showAssign && !showTag && !showList && !canDelete && campaigns.length === 0) {
    return <>{children}</>
  }

  return (
    <BulkAssignForm
      assignees={assignees}
      campaigns={campaigns}
      tags={tags}
      lists={lists}
      showAssign={showAssign}
      showTag={showTag}
      showList={showList}
      canDelete={canDelete}
    >
      {children}
    </BulkAssignForm>
  )
}

function BulkAssignForm({
  assignees,
  campaigns,
  tags,
  lists,
  showAssign,
  showTag,
  showList,
  canDelete,
  children,
}: {
  assignees: Assignee[]
  campaigns: EnrollableCampaign[]
  tags: Taggable[]
  lists: Taggable[]
  showAssign: boolean
  showTag: boolean
  showList: boolean
  canDelete: boolean
  children: React.ReactNode
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, action, pending] = useActionState<BulkAssignState, FormData>(
    bulkAssignAction,
    null,
  )
  /*
   * ⚠️ A SECOND ACTION ON THE SAME FORM, VIA `formAction`. The checkboxes belong
   * to this form; a separate <form> for enrolment would submit an empty
   * selection, and nesting forms is invalid HTML. React 19 lets a button
   * redirect the same submission elsewhere, so both actions see exactly what is
   * ticked on screen.
   */
  const [enrolState, enrolAction, enrolling] = useActionState<ActionState, FormData>(
    enrolContacts,
    null,
  )
  /*
   * ⚠️ THREE MORE ACTIONS ON THE SAME FORM, for the reason given above: the
   * checkboxes belong to this form, so every action has to submit through it.
   * `bulkTagAction`, `bulkAddToListAction` and `bulkDeleteAction` were all
   * written and gated and called from nowhere.
   */
  const [tagState, tagAction, tagging] = useActionState<BulkState, FormData>(
    bulkTagAction,
    { ok: null },
  )
  const [listState, listAction, listing] = useActionState<BulkState, FormData>(
    bulkAddToListAction,
    { ok: null },
  )
  const [deleteState, deleteAction, deleting] = useActionState<BulkState, FormData>(
    bulkDeleteAction,
    { ok: null },
  )

  const [selected, setSelected] = useState(0)
  const [owner, setOwner] = useState('')
  const [campaign, setCampaign] = useState('')
  const [tag, setTag] = useState('')
  const [list, setList] = useState('')
  /*
   * ⚠️ RESET WHENEVER THE SELECTION CHANGES. A confirmation left armed from a
   * previous selection is a click away from deleting a different set of
   * contacts than the one it was opened for.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  /*
   * Counted from the DOM, not mirrored in state. The number shown can then
   * never disagree with what is actually ticked — including after a "select
   * all" or a server re-render.
   */
  const recount = () => {
    setConfirmingDelete(false)
    setSelected(
      formRef.current?.querySelectorAll<HTMLInputElement>(
        'input[name="contactId"]:checked',
      ).length ?? 0,
    )
  }

  const toggleAll = (checked: boolean) => {
    formRef.current
      ?.querySelectorAll<HTMLInputElement>('input[name="contactId"]')
      .forEach((box) => {
        box.checked = checked
      })
    recount()
  }

  return (
    <form ref={formRef} action={action} onChange={recount} className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            onChange={(event) => toggleAll(event.target.checked)}
            className="h-4 w-4"
          />
          {/*
            ⚠️ SAYS "ON THIS PAGE", because that is what it does. A control
            labelled "select all" that silently means "the 25 you can see"
            is how someone assigns a quarter of an import and believes they
            assigned all of it.
          */}
          Select all on this page
        </label>

        <span className="text-xs text-muted">
          {selected === 0 ? 'Nothing selected' : `${selected} selected`}
        </span>
      </div>

      {children}

      {showAssign ? (
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <label className="flex items-center gap-2">
          <span className="sr-only">Assign selected contacts to</span>
          <select
            name="ownerUserId"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            className="rounded-[var(--radius-md)] border border-line bg-surface px-3 py-1.5 text-xs text-ink [color-scheme:light]"
          >
            <option value="">Assign to…</option>
            {assignees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
            {/*
              ⚠️ UNASSIGNING IS AN OPTION, NOT AN OMISSION. Taking a contact
              off someone who has left is a normal act, and an explicitly
              unassigned contact is findable — see the R3 handover.
            */}
            <option value="none">Nobody (unassign)</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={pending || !owner || selected === 0}
          className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Assigning…' : `Assign ${selected || ''}`.trim()}
        </button>

        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${state?.ok ? 'text-success' : 'text-danger'}`}
        >
          {state ? (state.ok ? state.message : state.error) : ''}
        </p>
      </div>
      ) : null}

      {/*
        ⚠️ THE STEP THAT DID NOT EXIST. `enrolContacts` was written, permission
        -gated and never called from anywhere — so a user could connect a
        mailbox, author a sequence and press Launch on a campaign containing
        nobody, with nothing saying so.
      */}
      {campaigns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <label className="flex items-center gap-2">
            <span className="sr-only">Add selected contacts to a campaign</span>
            <select
              name="campaignId"
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
              className="rounded-[var(--radius-md)] border border-line bg-surface px-3 py-1.5 text-xs text-ink [color-scheme:light]"
            >
              <option value="">Add to campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            formAction={enrolAction}
            disabled={enrolling || !campaign || selected === 0}
            className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
          >
            {enrolling ? 'Adding…' : `Add ${selected || ''}`.trim()}
          </button>

          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${enrolState?.ok ? 'text-success' : 'text-danger'}`}
          >
            {enrolState ? (enrolState.ok ? enrolState.message : enrolState.error) : ''}
          </p>
        </div>
      ) : null}

      {showTag || showList ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          {showTag ? (
            <>
              <label className="flex items-center gap-2">
                <span className="sr-only">Tag selected contacts</span>
                <select
                  name="tagId"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                  className="rounded-[var(--radius-md)] border border-line bg-surface px-3 py-1.5 text-xs text-ink [color-scheme:light]"
                >
                  <option value="">Add tag…</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                formAction={tagAction}
                disabled={tagging || !tag || selected === 0}
                className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
              >
                {tagging ? 'Tagging…' : `Tag ${selected || ''}`.trim()}
              </button>
            </>
          ) : null}

          {showList ? (
            <>
              <label className="flex items-center gap-2">
                <span className="sr-only">Add selected contacts to a list</span>
                <select
                  name="listId"
                  value={list}
                  onChange={(event) => setList(event.target.value)}
                  className="rounded-[var(--radius-md)] border border-line bg-surface px-3 py-1.5 text-xs text-ink [color-scheme:light]"
                >
                  <option value="">Add to list…</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                formAction={listAction}
                disabled={listing || !list || selected === 0}
                className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60"
              >
                {listing ? 'Adding…' : `Add ${selected || ''}`.trim()}
              </button>
            </>
          ) : null}

          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${
              tagState.ok || listState.ok ? 'text-success' : 'text-danger'
            }`}
          >
            {message(tagState) || message(listState)}
          </p>
        </div>
      ) : null}

      {/*
        ⚠️ ITS OWN ROW, AND CONFIRMED. Sitting inline with "Tag" and "Add to
        list" it is one misclick from deleting a selection someone meant to
        label. CLAUDE.md requires a confirmation on a destructive action, and
        the copy says what actually happens — this is a soft delete, the rows
        keep their history and the timeline survives.
      */}
      {canDelete ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
          {confirmingDelete ? (
            <>
              <span className="text-xs text-ink">
                Delete {selected} contact{selected === 1 ? '' : 's'}? They stop
                appearing in the CRM. Their history is kept.
              </span>
              <button
                type="submit"
                formAction={deleteAction}
                disabled={deleting || selected === 0}
                className="rounded-[var(--radius-md)] bg-danger px-3 py-1.5 text-xs font-semibold text-cream transition-opacity duration-150 hover:opacity-90 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : `Delete ${selected || ''}`.trim()}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
              >
                Keep them
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={selected === 0}
              className="rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-semibold text-danger transition-colors duration-150 hover:underline disabled:opacity-60 disabled:no-underline"
            >
              Delete selected
            </button>
          )}

          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${deleteState.ok ? 'text-success' : 'text-danger'}`}
          >
            {message(deleteState)}
          </p>
        </div>
      ) : null}
    </form>
  )
}

/** `BulkState` carries `{ ok: null }` for "nothing has happened yet". */
function message(state: BulkState): string {
  if (state.ok === null) return ''
  return state.ok ? state.message : state.error
}
