import Link from 'next/link'

import { contactsHref, type ContactsTableQuery } from '@/components/crm/ContactsTable'
import { CONTACT_SOURCES } from '@/lib/crm/contacts-list'

export type FilterOption = { id: string; name: string }

/**
 * The contact list's filter bar.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A PLAIN `<form method="get">`, NOT CLIENT STATE.                      ║
 * ║                                                                           ║
 * ║  The filters live in the URL, which means they survive a reload, can be   ║
 * ║  bookmarked, shared with a colleague, and are what a saved view stores.   ║
 * ║  Holding them in React state instead would make every one of those a      ║
 * ║  separate feature, and the back button would stop working.                ║
 * ║                                                                           ║
 * ║  It also means this component needs no `'use client'` and ships no        ║
 * ║  JavaScript — the filters work before hydration, and would keep working   ║
 * ║  if hydration failed, which this project has seen happen silently.        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function ContactFilters({
  query,
  tags,
  companies,
  activeCount,
}: {
  query: ContactsTableQuery
  tags: FilterOption[]
  companies: FilterOption[]
  activeCount: number
}) {
  return (
    <form method="get" action="/crm/contacts" className="rounded-clay border border-line bg-surface p-4">
      {/*
        ⚠️ SORT IS CARRIED THROUGH AS A HIDDEN FIELD. A GET form submits only
        its own inputs, so without these the act of filtering would silently
        reset the user's sort — the same class of quiet loss that
        `contactsHref` exists to prevent, arriving by a different route.
      */}
      {query.sort !== 'created' && <input type="hidden" name="sort" value={query.sort} />}
      {query.direction !== 'desc' && <input type="hidden" name="dir" value={query.direction} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium text-ink-subtle">
          Search
          <input
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder="Name or email"
            className="mt-1 w-full rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="text-xs font-medium text-ink-subtle">
          Company
          <select
            name="company"
            defaultValue={query.company}
            className="mt-1 w-full rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">Any</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-subtle">
          Source
          <select
            name="source"
            defaultValue={query.source}
            className="mt-1 w-full rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">Any</option>
            {CONTACT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-ink-subtle">
          Email address
          {/*
            Three options, not a checkbox. "Has none" is a real segment — the
            contacts an enrichment run should target — and a checkbox can only
            express two of the three states.
          */}
          <select
            name="email"
            defaultValue={query.hasEmail}
            className="mt-1 w-full rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink"
          >
            <option value="">Any</option>
            <option value="yes">Has one</option>
            <option value="no">Has none</option>
          </select>
        </label>

        <label className="text-xs font-medium text-ink-subtle">
          Added after
          <input
            type="date"
            name="after"
            defaultValue={query.createdAfter}
            className="mt-1 w-full rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="text-xs font-medium text-ink-subtle">
          Added before
          <input
            type="date"
            name="before"
            defaultValue={query.createdBefore}
            className="mt-1 w-full rounded-clay border border-line bg-white px-3 py-2 text-sm text-ink"
          />
        </label>

        {tags.length > 0 && (
          <fieldset className="sm:col-span-2 lg:col-span-2">
            <legend className="text-xs font-medium text-ink-subtle">
              Tags <span className="text-muted">(all of them)</span>
            </legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <label
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 rounded-clay border border-line bg-white px-2 py-1 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    name="tag"
                    value={tag.id}
                    defaultChecked={query.tagIds.includes(tag.id)}
                  />
                  {tag.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-clay bg-ink px-3 py-2 text-sm font-medium text-white"
        >
          Apply filters
        </button>

        {activeCount > 0 && (
          <>
            {/*
              ⚠️ A LINK, NOT A RESET BUTTON. `type="reset"` restores the form's
              DEFAULT values — which are the filters currently applied — so it
              would appear to do nothing. Clearing means navigating to the
              unfiltered URL.
            */}
            <Link
              href="/crm/contacts"
              className="text-sm text-ink-subtle underline underline-offset-2"
            >
              Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
            </Link>
          </>
        )}
      </div>
    </form>
  )
}

/**
 * How many filters are actually narrowing the list.
 *
 * ⚠️ SORT AND DIRECTION DO NOT COUNT. They change the order, not the
 * membership, so including them would offer to "clear 2 filters" on a list
 * nobody has filtered.
 */
export function activeFilterCount(query: ContactsTableQuery): number {
  return [
    query.search,
    query.owner,
    query.company,
    query.createdAfter,
    query.createdBefore,
    query.hasEmail,
    query.source,
  ].filter(Boolean).length + query.tagIds.length
}
