import Link from 'next/link'

import { Monogram } from '@/components/ui/Monogram'
import { RelativeTime } from '@/components/ui/LocalTime'
import type { ContactListRow, ContactSort } from '@/lib/crm/contacts-list'

/**
 * The contact list.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A LIST IS READ BY SCANNING ONE COLUMN, NOT BY READING ROWS.             ║
 * ║                                                                           ║
 * ║  The previous table rendered five columns of the same grey 14px text at   ║
 * ║  the same weight, so finding "which of these has nobody working them" or  ║
 * ║  "who have we not touched in a month" meant reading every cell. Every     ║
 * ║  change below is in service of one column answering one question at a     ║
 * ║  glance: identity is anchored by a monogram, absent values are shown as   ║
 * ║  a STATE rather than an em dash, and recency is stated instead of         ║
 * ║  requiring date arithmetic.                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export type ContactsTableQuery = {
  search: string
  owner: string
  sort: ContactSort
  direction: 'asc' | 'desc'
}

/**
 * Every link out of this table carries the WHOLE query.
 *
 * ⚠️ THE BUG THIS EXISTS TO PREVENT WAS REAL. Pagination used to rebuild the
 * URL from `q` and `page` alone, so filtering to "Unassigned" and pressing Next
 * silently dropped the filter and returned the full workspace under a heading
 * that still said Unassigned. One builder, used by every control, is the only
 * way that stays fixed.
 */
export function contactsHref(
  query: ContactsTableQuery,
  overrides: Partial<ContactsTableQuery & { page: number }> = {},
): string {
  const merged = { ...query, ...overrides }
  const params = new URLSearchParams()

  if (merged.search) params.set('q', merged.search)
  if (merged.owner) params.set('owner', merged.owner)
  // Omitted when it is the default, so the common URL stays short and shareable.
  if (merged.sort !== 'created') params.set('sort', merged.sort)
  if (merged.direction !== 'desc') params.set('dir', merged.direction)
  if (overrides.page && overrides.page > 1) params.set('page', String(overrides.page))

  const search = params.toString()
  return search ? `/crm/contacts?${search}` : '/crm/contacts'
}

/**
 * A column header that sorts.
 *
 * ⚠️ `aria-sort` GOES ON THE `<th>`, NOT THE BUTTON, and only the sorted column
 * carries it. It is what tells a screen-reader user the table is ordered and
 * by what — the arrow glyph alone tells them nothing.
 */
function SortableHeader({
  label,
  column,
  query,
}: {
  label: string
  column: ContactSort
  query: ContactsTableQuery
}) {
  const active = query.sort === column
  const nextDirection = active && query.direction === 'desc' ? 'asc' : 'desc'

  return (
    <th
      scope="col"
      aria-sort={active ? (query.direction === 'asc' ? 'ascending' : 'descending') : undefined}
      className="px-4 py-3 font-semibold"
    >
      <Link
        // Sorting returns to page 1: staying on page 7 of a re-ordered list
        // lands on rows that have nothing to do with what was being read.
        href={contactsHref(query, { sort: column, direction: nextDirection })}
        className="inline-flex items-center gap-1 transition-colors duration-150 hover:text-ink"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-accent' : 'text-transparent'}>
          {active && query.direction === 'asc' ? '↑' : '↓'}
        </span>
      </Link>
    </th>
  )
}

export function ContactsTable({
  rows,
  query,
  canAssign,
  showOwner,
}: {
  rows: ContactListRow[]
  query: ContactsTableQuery
  canAssign: boolean
  showOwner: boolean
}) {
  return (
    <div className="clay overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
            {canAssign ? (
              <th scope="col" className="w-10 px-4 py-3">
                <span className="sr-only">Select</span>
              </th>
            ) : null}
            <SortableHeader label="Name" column="name" query={query} />
            <th scope="col" className="px-4 py-3 font-semibold">
              Company
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Email
            </th>
            {showOwner ? (
              <th scope="col" className="px-4 py-3 font-semibold">
                Owner
              </th>
            ) : null}
            <th scope="col" className="px-4 py-3 font-semibold">
              Last activity
            </th>
            <SortableHeader label="Added" column="created" query={query} />
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const name = row.fullName ?? 'Unnamed contact'

            return (
              <tr
                key={row.id}
                className="border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-muted"
              >
                {canAssign ? (
                  <td className="px-4 py-2.5 align-middle">
                    <input
                      type="checkbox"
                      name="contactId"
                      value={row.id}
                      aria-label={`Select ${name}`}
                      className="h-4 w-4"
                    />
                  </td>
                ) : null}

                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Monogram name={row.fullName} />
                    <span className="min-w-0">
                      {/*
                        The link stays on the name rather than becoming a
                        whole-row click target: a row that is one big link
                        cannot also hold a checkbox and a mailto without
                        nesting interactive elements, which is invalid HTML and
                        unusable by keyboard.
                      */}
                      <Link
                        href={`/crm/contacts/${row.id}`}
                        className="block truncate font-semibold text-ink transition-colors duration-150 hover:text-accent"
                      >
                        {name}
                      </Link>
                      {row.jobTitle ? (
                        <span className="block truncate text-xs text-muted">
                          {row.jobTitle}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </td>

                <td className="px-4 py-2.5">
                  {row.companyName ? (
                    <span className="flex items-center gap-2">
                      <Monogram name={row.companyName} size="sm" square />
                      {/* `min-w-0` or `truncate` does nothing: a flex child's
                          default min-width is auto, so it refuses to shrink
                          below its content and the row widens instead. */}
                      <span className="min-w-0 truncate text-ink">{row.companyName}</span>
                    </span>
                  ) : (
                    <Missing>No company</Missing>
                  )}
                </td>

                <td className="px-4 py-2.5">
                  {row.primaryEmail ? (
                    /*
                     * ⚠️ ACTIONABLE, NOT DECORATIVE. An address rendered as
                     * grey text is something to select and copy by hand; the
                     * whole reason it is on the row is that someone wants to
                     * write to this person.
                     */
                    <a
                      href={`mailto:${row.primaryEmail}`}
                      // `block`, because `text-overflow` has no effect on an
                      // inline box — the address simply overflowed the cell.
                      className="block truncate text-muted transition-colors duration-150 hover:text-accent"
                    >
                      {row.primaryEmail}
                    </a>
                  ) : (
                    <Missing>No email</Missing>
                  )}
                </td>

                {showOwner ? (
                  <td className="px-4 py-2.5">
                    {row.ownerName ? (
                      <span className="flex items-center gap-2">
                        <Monogram name={row.ownerName} size="sm" />
                        <span className="min-w-0 truncate text-muted">{row.ownerName}</span>
                      </span>
                    ) : (
                      /*
                       * ⚠️ A STATE, NOT AN ABSENCE. "Unassigned" is the single
                       * most actionable thing this table can say after an
                       * import, and rendering it as the same grey em dash used
                       * for a missing email hid it completely.
                       */
                      <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                        Unassigned
                      </span>
                    )}
                  </td>
                ) : null}

                <td className="px-4 py-2.5 text-muted">
                  {row.lastActivityAt ? (
                    <RelativeTime iso={row.lastActivityAt} />
                  ) : (
                    <Missing>Never</Missing>
                  )}
                </td>

                <td className="px-4 py-2.5 text-muted">
                  <RelativeTime iso={row.createdAt} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A value we do not have.
 *
 * ⚠️ NAMED, NOT DASHED. `docs/UNSUPPORTED_FIELDS.md` requires a missing value to
 * be visibly missing rather than fabricated — and an em dash satisfies that
 * letter while telling the reader nothing about WHICH thing is absent. It also
 * makes every empty cell in every column look identical, so a column of missing
 * emails and a column of unassigned owners read as the same non-answer.
 */
function Missing({ children }: { children: React.ReactNode }) {
  // `nowrap` because "No email" broke across two lines in a narrow column,
  // which made an absent value the tallest thing in the row.
  return <span className="whitespace-nowrap text-xs italic text-muted/70">{children}</span>
}
