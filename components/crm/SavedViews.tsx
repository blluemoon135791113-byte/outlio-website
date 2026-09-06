'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import {
  deleteViewAction,
  saveViewAction,
  type SavedViewState,
} from '@/app/(product)/crm/saved-view-actions'
import { contactsHref, type ContactsTableQuery } from '@/components/crm/ContactsTable'
import type { SavedView, ViewDefinition } from '@/lib/crm/saved-views'

/**
 * Private saved views — the interface Phase 2 left unbuilt.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS FEATURE HAD STORAGE, SERVER ACTIONS AND UNIT TESTS AND NO WAY TO ║
 * ║  REACH IT. That is the defect class this project keeps finding — code     ║
 * ║  that is correct, tested, and never called — and Phase 2 created a fresh  ║
 * ║  instance of it while closing three others.                              ║
 * ║                                                                           ║
 * ║  ⚠️ THE FORM FIELD NAMES ARE NOT THE URL PARAMETER NAMES, and that is the ║
 * ║  trap here. The URL says `q`, `after`, `before`, `email`; the action      ║
 * ║  reads `search`, `createdAfter`, `createdBefore`, `hasEmail`. Sending the ║
 * ║  URL's names would save a view that silently drops those filters — it     ║
 * ║  would appear to work, and restore a wider list than the one saved.      ║
 * ║                                                                           ║
 * ║  `saved-view-fields.test.ts` asserts the two vocabularies stay aligned.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * A stored definition as a table query, so views and links share one builder.
 *
 * ⚠️ VIA `contactsHref`, NEVER A HAND-BUILT URL. That function is the single
 * place filters are serialised, and its own comment records what happened when
 * pagination built its own: the filter vanished and the list silently widened.
 */
function definitionToQuery(definition: ViewDefinition): ContactsTableQuery {
  return {
    search: definition.search ?? '',
    // Back to the sentinel the list understands. Without this the view saves
    // correctly and RESTORES nothing — the round trip is what matters.
    owner: definition.unassignedOnly ? 'unassigned' : (definition.ownerUserId ?? ''),
    sort: definition.sort ?? 'created',
    direction: definition.direction ?? 'desc',
    tagIds: definition.tagIds ?? [],
    company: definition.companyId ?? '',
    createdAfter: definition.createdAfter ?? '',
    createdBefore: definition.createdBefore ?? '',
    // Three states: '' is "no filter", not false.
    hasEmail: definition.hasEmail === undefined ? '' : definition.hasEmail ? 'yes' : 'no',
    source: definition.source ?? '',
  }
}

export function SavedViews({
  views,
  query,
  activeCount,
}: {
  views: SavedView[]
  query: ContactsTableQuery
  activeCount: number
}) {
  const [saveState, save, saving] = useActionState<SavedViewState, FormData>(saveViewAction, {
    ok: null,
  })
  const [deleteState, remove] = useActionState<SavedViewState, FormData>(deleteViewAction, {
    ok: null,
  })

  return (
    <section className="rounded-clay border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold tracking-[-0.01em] text-ink">Saved views</h3>

      {views.length === 0 ? (
        <p className="mt-1 text-sm text-ink-subtle">
          Filter the list, then save it here to come back to it.
        </p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {views.map((view) => (
            <li key={view.id} className="inline-flex items-center gap-1">
              <Link
                href={contactsHref(definitionToQuery(view.definition))}
                className="rounded-clay border border-line bg-white px-2.5 py-1 text-sm text-ink hover:border-ink"
              >
                {view.name}
              </Link>
              {/*
                ⚠️ A FORM, NOT A LINK. Deleting is a state change; a GET link
                would let a prefetch or a crawler delete somebody's view.
              */}
              <form action={remove}>
                <input type="hidden" name="viewId" value={view.id} />
                <button
                  type="submit"
                  aria-label={`Delete the view ${view.name}`}
                  className="rounded-clay px-1.5 py-1 text-xs text-muted hover:text-danger"
                >
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {activeCount > 0 && (
        <form action={save} className="mt-4 flex flex-wrap items-end gap-2">
          {/*
            ⚠️ THE ACTION'S FIELD NAMES, NOT THE URL'S. See the block at the top
            of this file: `q` vs `search`, `after` vs `createdAfter`, `email` vs
            `hasEmail`. Sending the wrong ones saves a view that quietly loses
            filters and restores a wider list than the one on screen.
          */}
          <input type="hidden" name="search" value={query.search} />
          {/*
            ⚠️ "unassigned" IS A SENTINEL IN `owner`, NOT A USER ID, and the
            action reads it as a separate `unassigned` field. Posting it as
            `owner` would be worse than useless: `parseDefinition` validates
            `ownerUserId` as a uuid, so it would be DROPPED SILENTLY and the
            view would restore the whole workspace instead of the unassigned
            subset. Caught by `saved-view-fields.test.ts` on its first run.
          */}
          {query.owner === 'unassigned' ? (
            <input type="hidden" name="unassigned" value="on" />
          ) : (
            <input type="hidden" name="owner" value={query.owner} />
          )}
          <input type="hidden" name="company" value={query.company} />
          <input type="hidden" name="createdAfter" value={query.createdAfter} />
          <input type="hidden" name="createdBefore" value={query.createdBefore} />
          <input type="hidden" name="hasEmail" value={query.hasEmail} />
          <input type="hidden" name="source" value={query.source} />
          <input type="hidden" name="sort" value={query.sort} />
          <input type="hidden" name="dir" value={query.direction} />
          {/* Repeated key, matching how the URL carries them. */}
          {query.tagIds.map((tagId) => (
            <input key={tagId} type="hidden" name="tagId" value={tagId} />
          ))}

          <label className="text-xs font-medium text-ink-subtle">
            Save these {activeCount} filter{activeCount === 1 ? '' : 's'} as
            <input
              type="text"
              name="name"
              required
              maxLength={80}
              placeholder="London decision makers"
              className="mt-1 block w-56 rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </label>

          <button
            type="submit"
            disabled={saving}
            className="rounded-clay bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save view'}
          </button>

          <p aria-live="polite" className="text-sm">
            {saveState.ok === true ? (
              <span className="text-success">{saveState.message}</span>
            ) : saveState.ok === false ? (
              <span className="text-danger">{saveState.error}</span>
            ) : null}
          </p>
        </form>
      )}

      {deleteState.ok === false && (
        <p aria-live="polite" className="mt-2 text-sm text-danger">
          {deleteState.error}
        </p>
      )}
    </section>
  )
}
