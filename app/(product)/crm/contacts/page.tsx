import type { Metadata } from 'next'
import Link from 'next/link'

import { BulkAssign } from '@/components/crm/BulkAssign'
import { ContactFilters, activeFilterCount } from '@/components/crm/ContactFilters'
import { SavedViews } from '@/components/crm/SavedViews'
import { ContactSearch } from '@/components/crm/ContactSearch'
import {
  ContactsTable,
  contactsHref,
  type ContactsTableQuery,
} from '@/components/crm/ContactsTable'
import { NewContactButton } from '@/components/crm/NewContact'
import { isContactSort, isContactSource, listContacts } from '@/lib/crm/contacts-list'
import { listSavedViews } from '@/lib/crm/saved-views'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
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
    // `tag` may repeat; Next gives an array when it does.
    tag?: string | string[]
    company?: string
    after?: string
    before?: string
    email?: string
    source?: string
  }>
}) {
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null
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

  /*
   * ⚠️ EVERY ONE OF THESE IS VALIDATED BEFORE IT REACHES A QUERY, for the same
   * reason `sort` is: a URL is user input. Ids are checked for uuid shape,
   * `source` against the database enum, and dates by `Date.parse` — an
   * unparseable date silently becomes "no filter" rather than a 500.
   */
  const isUuid = (value: string | undefined): string =>
    value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ? value
      : ''

  const isDate = (value: string | undefined): string =>
    value && !Number.isNaN(Date.parse(value)) ? value : ''

  const tagIds = (Array.isArray(params.tag) ? params.tag : params.tag ? [params.tag] : [])
    .map((t: string) => isUuid(t))
    .filter(Boolean)
    // Bounded: an unbounded tag list becomes an unbounded `.in()` clause.
    .slice(0, 20)

  const company = isUuid(params.company)
  const createdAfter = isDate(params.after)
  const createdBefore = isDate(params.before)
  const source = isContactSource(params.source) ? params.source : ''
  /*
   * ⚠️ THREE STATES, NOT TWO. `yes` / `no` / absent. Coercing to a boolean
   * would make "absent" mean `false`, and "contacts with no email" would become
   * the default view — which reads as a broken database rather than a filter.
   */
  const hasEmailParam = params.email === 'yes' ? 'yes' : params.email === 'no' ? 'no' : ''
  const scopedToSelf = dataScope(ctx.role) === 'assigned'
  /*
   * A setter cannot reassign, so they get no checkboxes — a control that
   * always refuses is worse than no control.
   */
  const canAssign = can({ role: ctx.role, modules: ctx.modules }, 'crm.contact.assign')

  /*
   * ⚠️ CAPPED, AND SCOPED. Both lists feed <select> elements; an uncapped one
   * would render 30,000 <option> nodes at the volume this list is built for.
   * The cap is a display limit, not a security boundary — the workspace filter
   * is what stops another tenant's tags appearing.
   */
  // Private to this user (DECISION-09), so it is read per request rather than
  // cached across the workspace.
  const savedViews = await listSavedViews(ctx.scope)

  const db0 = createAdminClient()
  const [{ data: tagRows }, { data: companyRows }] = await Promise.all([
    db0
      .from('crm_tags')
      .select('id, name')
      .eq('workspace_id', ctx.workspace.id)
      .order('name')
      .limit(50),
    db0
      .from('crm_companies')
      .select('id, name')
      .eq('workspace_id', ctx.workspace.id)
      .is('deleted_at', null)
      .order('name')
      .limit(200),
  ])

  /*
   * ⚠️ GATED ON THE PERMISSION THE ACTION ENFORCES, not on a different one.
   * `enrolContacts` calls `assertWorkspacePermission('email.campaign.create')`,
   * so offering the control to anyone else renders a button that always fails.
   *
   * ⚠️ AND ONLY CAMPAIGNS THAT CAN ACTUALLY RECEIVE PEOPLE. Enrolling into a
   * `completed` or `stopped` campaign puts contacts somewhere nothing will ever
   * send from, which looks identical to success.
   */
  const canEnrol =
    can({ role: ctx.role, modules: ctx.modules }, 'email.campaign.create') &&
    ctx.modules.has('email')

  const campaigns = canEnrol
    ? await (async () => {
        const { data } = await createAdminClient()
          .from('email_campaigns')
          .select('id, name')
          .eq('workspace_id', ctx.workspace.id)
          .in('status', ['draft', 'scheduled', 'running', 'paused'])
          .order('created_at', { ascending: false })
          .limit(50)
        return (data ?? []).map((c) => ({ id: c.id, name: c.name }))
      })()
    : []

  /*
   * ⚠️ SEPARATE FROM `canAssign`, AND THAT IS THE POINT. `crm.contact.edit` is
   * setter-and-above while assign and delete are manager-and-above, so a setter
   * gets the selection bar with tagging and list-adding and nothing else.
   */
  const canEditContacts = can({ role: ctx.role, modules: ctx.modules }, 'crm.contact.edit')
  const canDeleteContacts = can({ role: ctx.role, modules: ctx.modules }, 'crm.contact.delete')

  const [tags, lists] = canEditContacts
    ? await Promise.all([
        (async () => {
          // Scoped in code: the service role bypasses RLS.
          const { data } = await createAdminClient()
            .from('crm_tags')
            .select('id, name')
            .eq('workspace_id', ctx.workspace.id)
            .order('name')
            .limit(200)
          return data ?? []
        })(),
        (async () => {
          const { data } = await createAdminClient()
            .from('crm_lists')
            .select('id, name')
            .eq('workspace_id', ctx.workspace.id)
            .is('deleted_at', null)
            .order('name')
            .limit(200)
          return data ?? []
        })(),
      ])
    : [[], []]

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

  const result = await listContacts(ctx.scope, {
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
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    companyId: company || undefined,
    createdAfter: createdAfter || undefined,
    createdBefore: createdBefore || undefined,
    // '' means "no filter"; only an explicit yes/no becomes a boolean.
    hasEmail: hasEmailParam === '' ? undefined : hasEmailParam === 'yes',
    source: source || undefined,
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
    tagIds,
    company,
    createdAfter,
    createdBefore,
    hasEmail: hasEmailParam,
    source,
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

          {/*
            ⚠️ PLAIN LINKS, NOT BUTTONS WITH `onClick`. A download is a
            navigation to a resource: an anchor gets Cmd-click, middle-click
            and "Save link as" for free, works with JavaScript disabled, and
            needs no client component. `download` asks the browser to save
            rather than navigate.

            Shown to everyone who can read contacts, because the route scopes
            what comes back by role — a setter's file contains their own
            contacts. Hiding it would not be the control; the route is.
          */}
          <ContactExportLinks />

          {can({ role: ctx.role, modules: ctx.modules }, 'crm.contact.create') ? (
            <NewContactButton />
          ) : null}
        </div>
      </div>

      <SavedViews query={query} views={savedViews} activeCount={activeFilterCount(query)} />

      <ContactFilters
        query={query}
        tags={(tagRows ?? []).map((t) => ({ id: t.id, name: t.name }))}
        // A company row can have a null display name; the filter still needs a
        // label, and an empty option is unclickable.
        companies={(companyRows ?? []).map((c) => ({ id: c.id, name: c.name ?? 'Unnamed company' }))}
        activeCount={activeFilterCount(query)}
      />

      {result.rows.length === 0 ? (
        /*
         * ⚠️ "NO CONTACTS YET" WAS A CLAIM ABOUT THE WORKSPACE, MADE FROM A
         * FILTERED QUERY.
         *
         * This branched on `search` alone, but the query has ten dimensions
         * that change membership — owner, tags, company, created range,
         * has-email, source. A workspace holding five thousand contacts,
         * filtered by one tag to zero, was told it had no contacts. That is the
         * same shape as the credit balance that rendered `?? 0`: the most
         * discouraging available reading of missing data, and untrue.
         *
         * `activeFilterCount` already knows the answer and already excludes
         * sort and direction, because those change the order and not the
         * membership.
         */
        <EmptyContacts search={search} filterCount={activeFilterCount(query)} />
      ) : (
        <BulkAssign
          assignees={assignees}
          campaigns={campaigns}
          tags={tags}
          lists={lists}
          canAssign={canAssign}
          canEdit={canEditContacts}
          canDelete={canDeleteContacts}
        >
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

/**
 * The two downloads.
 *
 * ⚠️ NAMED FOR WHAT THEY ARE FOR, not for their format. "Export CSV" twice
 * would make the difference invisible at exactly the moment it matters — one
 * of these files is safe to upload to a mailing tool and the other is not,
 * because only one excludes people who have unsubscribed.
 */
/**
 * The three genuinely different reasons this list is empty.
 *
 * ⚠️ THEY NEED DIFFERENT SENTENCES BECAUSE THEY NEED DIFFERENT ACTIONS. Telling
 * somebody to "try part of a name" when they filtered by tag sends them to fix
 * the wrong thing, and telling a workspace with five thousand contacts that it
 * has none is simply false.
 *
 * ⚠️ EACH ONE OFFERS THE WAY OUT. The previous version described how contacts
 * arrive and gave nothing to click — a dead end on the screen setters spend
 * their day in.
 */
function EmptyContacts({ search, filterCount }: { search: string; filterCount: number }) {
  // `search` is itself one of the counted filters, so anything beyond it is a
  // narrowing the search box cannot explain.
  const otherFilters = filterCount - (search ? 1 : 0)

  const { title, body, action } = search
    ? {
        title: `Nothing matched “${search}”`,
        body:
          otherFilters > 0
            ? 'Other filters are narrowing this too. Try part of a name or an email address, or clear the filters.'
            : 'Try part of a name or an email address.',
        action: { href: '/crm/contacts', label: 'Clear search and filters' },
      }
    : otherFilters > 0
      ? {
          title: 'No contacts match these filters',
          /*
           * Deliberately says nothing about how many contacts exist. The count
           * on this page is already filtered, so quoting it would be quoting
           * zero back at them.
           */
          body: `${otherFilters} filter${otherFilters === 1 ? ' is' : 's are'} applied. Clearing them shows the full list.`,
          action: { href: '/crm/contacts', label: 'Clear filters' },
        }
      : {
          title: 'No contacts yet',
          body: 'Contacts arrive from a lead search or a CSV import. Either one brings them in here.',
          action: { href: '/crm/import', label: 'Import a CSV' },
        }

  return (
    <div className="clay p-10 text-center">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Link
          href={action.href}
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-3.5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted"
        >
          {action.label}
        </Link>
        {search || otherFilters > 0 ? null : (
          <Link
            href="/dashboard/extract/new"
            className="product-gradient inline-flex h-9 items-center rounded-[var(--radius-md)] px-3.5 text-sm font-semibold text-white transition-[filter] duration-150 hover:brightness-95"
          >
            Find leads
          </Link>
        )}
      </div>
    </div>
  )
}

function ContactExportLinks() {
  const className =
    'rounded-[var(--radius-md)] border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:border-border-strong hover:text-ink'

  return (
    <span className="flex items-center gap-1.5">
      <a href="/crm/contacts/export?kind=crm" download className={className}>
        Export CSV
      </a>
      <a
        href="/crm/contacts/export?kind=marketing"
        download
        className={className}
        title="Contacts with an email address, excluding anyone who unsubscribed or bounced."
      >
        Email list
      </a>
    </span>
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
