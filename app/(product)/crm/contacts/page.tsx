import type { Metadata } from 'next'
import Link from 'next/link'

import { BulkAssign } from '@/components/crm/BulkAssign'
import { ContactSearch } from '@/components/crm/ContactSearch'
import {
  ContactsTable,
  contactsHref,
  type ContactsTableQuery,
} from '@/components/crm/ContactsTable'
import { NewContactButton } from '@/components/crm/NewContact'
import { isContactSort, listContacts } from '@/lib/crm/contacts-list'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Contacts | Outlio',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 25

/**
 * The contact list.
 *
 * ⚠️ SERVER-FILTERED AND PAGED (A6). Search runs in Postgres against trigram
 * indexes, never by loading rows and filtering in the browser, and the page
 * size is capped in `listContacts` regardless of what the URL asks for.
 *
 * ⚠️ A SETTER SEES ONLY THEIR OWN. RLS grants a member the whole workspace, so
 * `dataScope` applied to the QUERY is what narrows them.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    page?: string
    owner?: string
    sort?: string
    dir?: string
  }>
}) {
  const ctx = await requireWorkspace()
  const params = await searchParams

  const search = params.q?.trim() ?? ''
  /*
   * ⚠️ "unassigned" IS A VALUE, NOT AN ABSENT ONE. Nobody and everyone are
   * different filters; overloading the empty string would make the single most
   * useful view straight after an import — "who has nobody working them" —
   * unexpressible.
   */
  const ownerFilter = params.owner ?? ''
  const page = Math.max(Number.parseInt(params.page ?? '1', 10) || 1, 1)
  /*
   * ⚠️ VALIDATED, NOT PASSED THROUGH. `sort` reaches a database `.order()`;
   * `isContactSort` is what stops a hand-edited URL naming a column — and the
   * fallback is the previous default, so a nonsense value degrades to the
   * ordinary list rather than to an error page.
   */
  const sort = isContactSort(params.sort) ? params.sort : 'created'
  const direction = params.dir === 'asc' ? 'asc' : 'desc'
  const scopedToSelf = dataScope(ctx.role) === 'assigned'
  /*
   * A setter cannot reassign, so they get no checkboxes — a control that
   * always refuses is worse than no control.
   */
  const canAssign = can({ role: ctx.role, modules: ctx.modules }, 'crm.contact.assign')

  const assignees = canAssign
    ? await (async () => {
        const db = createAdminClient()
        const { data: members } = await db
          .from('workspace_memberships')
          .select('user_id')
          .eq('workspace_id', ctx.workspace.id)

        const ids = (members ?? []).map((m) => m.user_id)
        if (ids.length === 0) return []

        const { data: profiles } = await db
          .from('profiles')
          .select('id, full_name, email')
          .in('id', ids)

        return (profiles ?? []).map((p) => ({
          id: p.id,
          name: p.full_name ?? p.email ?? 'Unnamed member',
        }))
      })()
    : []

  const result = await listContacts(ctx.workspace.id, {
    search,
    ownerUserId: scopedToSelf
      ? ctx.userId
      : ownerFilter && ownerFilter !== 'unassigned'
        ? ownerFilter
        : null,
    unassignedOnly: !scopedToSelf && ownerFilter === 'unassigned',
    page,
    pageSize: PAGE_SIZE,
    sort,
    direction,
  })

  const lastPage = Math.max(Math.ceil(result.total / result.pageSize), 1)

  /*
   * ⚠️ ONE OBJECT, CARRIED BY EVERY LINK ON THE PAGE. Pagination used to
   * rebuild its own URL from `q` and `page` alone, so paging away from a
   * filtered or sorted list silently discarded both — page 2 of "Unassigned"
   * returned the whole workspace under a heading that still said Unassigned.
   */
  const query: ContactsTableQuery = {
    search,
    owner: scopedToSelf ? '' : ownerFilter,
    sort,
    direction,
  }

  /*
   * ⚠️ THE COUNT IS ESTIMATED ABOVE A THRESHOLD (see `listContacts`), and the
   * response does not say which side of it we landed on. So anything large
   * enough to plausibly be an estimate is shown as "about N" rather than as a
   * precise-looking figure we cannot stand behind. Erring this way understates
   * our precision on a mid-sized workspace, which is the safe direction: it
   * never claims accuracy it does not have.
   */
  const formatTotal = (total: number) =>
    total >= 1000 ? `about ${total.toLocaleString()}` : String(total)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Contacts</h2>
          <p className="mt-0.5 text-xs text-muted">
            {formatTotal(result.total)} {result.total === 1 ? 'contact' : 'contacts'}
            {scopedToSelf ? ' assigned to you' : ''}
            {search ? ` matching “${search}”` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ContactSearch initialValue={search} />
          {/* ⚠️ THERE WAS NO WAY TO ADD A CONTACT BY HAND anywhere in the
              product until R2 — only the extension and, since R1, imports. */}
          {/*
            ⚠️ THE FILTER IS A LINK SET, NOT A SELECT. The URL carries the
            state, so a filtered list can be bookmarked, shared with a
            colleague, and reached with the back button — which a select
            posting to client state cannot.
          */}
          {!scopedToSelf ? (
            <nav aria-label="Owner filter" className="flex gap-1">
              {[
                { value: '', label: 'All' },
                { value: 'unassigned', label: 'Unassigned' },
                { value: ctx.userId!, label: 'Mine' },
              ].map((option) => (
                <Link
                  key={option.value || 'all'}
                  /*
                   * Keeps the search term and the sort. Changing WHO you are
                   * looking at is not a request to stop looking for "sam" or
                   * to go back to newest-first.
                   */
                  href={contactsHref(query, { owner: option.value })}
                  aria-current={ownerFilter === option.value ? 'page' : undefined}
                  /*
                    ⚠️ NO `bg-accent` HERE, DELIBERATELY. `globals.css` has
                    `.hubble-shell nav a[aria-current='page']`, which sets a
                    charcoal-tint background on ANY current link inside a nav
                    in the product shell — and its specificity beats a utility
                    class. Cream text on that tint is cream on cream: the
                    SELECTED option rendered as the least readable of the
                    three, which is exactly backwards.
                    The shell supplies the background; this supplies the
                    contrast, and the result matches the tab idiom already used
                    everywhere else rather than inventing a second one.
                  */
                  className={
                    ownerFilter === option.value
                      ? 'rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-semibold text-ink'
                      : 'rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink'
                  }
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {can({ role: ctx.role, modules: ctx.modules }, 'crm.contact.create') ? (
            <NewContactButton />
          ) : null}
        </div>
      </div>

      {result.rows.length === 0 ? (
        <div className="clay p-10 text-center">
          <h3 className="text-base font-semibold text-ink">
            {search ? 'Nothing matched' : 'No contacts yet'}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            {search
              ? 'Try part of a name or an email address.'
              : 'Contacts arrive from a lead search or a CSV import, and appear here once they do.'}
          </p>
        </div>
      ) : (
        <BulkAssign assignees={assignees} canAssign={canAssign}>
          <ContactsTable
            rows={result.rows}
            query={query}
            canAssign={canAssign}
            showOwner={!scopedToSelf}
          />

          {lastPage > 1 ? (
            <nav
              aria-label="Pagination"
              className="flex items-center justify-between text-sm"
            >
              <PageLink
                query={query}
                page={page - 1}
                disabled={page <= 1}
                label="Previous"
              />
              <span className="text-xs text-muted">
                Page {page} of {lastPage}
              </span>
              <PageLink
                query={query}
                page={page + 1}
                disabled={page >= lastPage}
                label="Next"
              />
            </nav>
          ) : null}
        </BulkAssign>
      )}
    </div>
  )
}

function PageLink({
  query,
  page,
  disabled,
  label,
}: {
  query: ContactsTableQuery
  page: number
  disabled: boolean
  label: string
}) {
  const className =
    'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold transition-colors duration-150'

  if (disabled) {
    // Rendered but inert, so the control does not jump around between pages.
    return <span className={`${className} cursor-not-allowed text-muted opacity-50`}>{label}</span>
  }

  /*
   * ⚠️ BUILT FROM THE WHOLE QUERY, NOT FROM `q` ALONE.
   *
   * This function used to construct its own URL from the search term and the
   * page number. Everything else the reader had chosen — the owner filter, and
   * now the sort — was silently dropped on the way to page 2: "Unassigned"
   * became the entire workspace while the heading above still said Unassigned,
   * and there was nothing on screen to suggest the list had changed meaning.
   *
   * `contactsHref` is now the only place a contacts URL is assembled, so a
   * filter added later is carried by pagination for free instead of being
   * forgotten by one control that nobody thought to update.
   */
  return (
    <Link href={contactsHref(query, { page })} className={`${className} text-muted hover:text-ink`}>
      {label}
    </Link>
  )
}
