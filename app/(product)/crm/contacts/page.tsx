import type { Metadata } from 'next'
import Link from 'next/link'

import { BulkAssign } from '@/components/crm/BulkAssign'
import { ContactSearch } from '@/components/crm/ContactSearch'
import { NewContactButton } from '@/components/crm/NewContact'
import { listContacts } from '@/lib/crm/contacts-list'
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
  searchParams: Promise<{ q?: string; page?: string; owner?: string }>
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
  })

  const lastPage = Math.max(Math.ceil(result.total / result.pageSize), 1)

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
                  href={
                    option.value
                      ? `/crm/contacts?owner=${encodeURIComponent(option.value)}`
                      : '/crm/contacts'
                  }
                  aria-current={ownerFilter === option.value ? 'page' : undefined}
                  className={
                    ownerFilter === option.value
                      ? 'rounded-[var(--radius-md)] bg-accent px-2.5 py-1 text-xs font-semibold text-cream'
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
              : 'Contacts arrive from an extraction or a CSV import, and appear here once they do.'}
          </p>
        </div>
      ) : (
        <BulkAssign assignees={assignees} canAssign={canAssign}>
          <div className="clay overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                  {canAssign ? (
                    <th scope="col" className="w-10 px-4 py-3">
                      <span className="sr-only">Select</span>
                    </th>
                  ) : null}
                  <th scope="col" className="px-4 py-3 font-semibold">Name</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Company</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                  {!scopedToSelf ? (
                    <th scope="col" className="px-4 py-3 font-semibold">Owner</th>
                  ) : null}
                  <th scope="col" className="px-4 py-3 font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-surface-muted"
                  >
                    {canAssign ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          name="contactId"
                          value={row.id}
                          aria-label={`Select ${row.fullName ?? 'contact'}`}
                          className="h-4 w-4"
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <Link
                        href={`/crm/contacts/${row.id}`}
                        className="font-semibold text-ink hover:text-accent"
                      >
                        {row.fullName ?? 'Unnamed contact'}
                      </Link>
                      {row.jobTitle ? (
                        <span className="block text-xs text-muted">{row.jobTitle}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{row.companyName ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{row.primaryEmail ?? '—'}</td>
                    {!scopedToSelf ? (
                      <td className="px-4 py-3 text-muted">{row.ownerName ?? 'Unassigned'}</td>
                    ) : null}
                    <td className="px-4 py-3 text-muted">
                      {row.lastActivityAt ? formatDate(row.lastActivityAt) : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lastPage > 1 ? (
            <nav
              aria-label="Pagination"
              className="flex items-center justify-between text-sm"
            >
              <PageLink
                page={page - 1}
                search={search}
                disabled={page <= 1}
                label="Previous"
              />
              <span className="text-xs text-muted">
                Page {page} of {lastPage}
              </span>
              <PageLink
                page={page + 1}
                search={search}
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
  page,
  search,
  disabled,
  label,
}: {
  page: number
  search: string
  disabled: boolean
  label: string
}) {
  const className =
    'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold transition-colors duration-150'

  if (disabled) {
    // Rendered but inert, so the control does not jump around between pages.
    return <span className={`${className} cursor-not-allowed text-muted opacity-50`}>{label}</span>
  }

  const query = new URLSearchParams()
  if (search) query.set('q', search)
  query.set('page', String(page))

  return (
    <Link href={`/crm/contacts?${query}`} className={`${className} text-muted hover:text-ink`}>
      {label}
    </Link>
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
