import Link from 'next/link'

import { accountsHref, SOURCE_LABELS } from '@/components/crm/accounts/AccountFilters'
import { CompanyPeople, type CompanyPerson } from '@/components/crm/CompanyPeople'
import { RelativeTime } from '@/components/ui/LocalTime'
import type { AccountQuery, AccountSort } from '@/lib/crm/account-filters'
import { tagsIn, type AccountListRow, type AccountTag } from '@/lib/crm/accounts'
import type { TagGroup } from '@/lib/crm/tag-groups'
import { safeSourceUrl } from '@/lib/crm/provenance'

const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

/**
 * The Accounts table — a plain CRM table, no cards (spec §6).
 *
 * ⚠️ AN EMPTY CELL SAYS "NOT AVAILABLE". A blank or a zero would read as a
 * fact we hold; we hold nothing, and rule 4 forbids implying otherwise. In
 * the table it is a dash with the words for screen readers and on hover, so
 * thirteen columns of the same phrase do not drown the values that exist.
 *
 * Checkboxes are `<input name="accountId">` so the surrounding bulk form
 * submits exactly what is ticked on screen (the `BulkAssign` pattern).
 */
export function AccountsTable({
  rows,
  query,
  selectable,
  people,
  groups,
}: {
  rows: AccountListRow[]
  query: AccountQuery
  selectable: boolean
  /** The workspace's active account tag groups — one column each, in order. */
  groups: TagGroup[]
  /** Names for the Leads hover, at most a few per account. */
  people: Map<string, CompanyPerson[]>
}) {
  return (
    <div className="overflow-x-auto rounded-clay border border-line bg-panel">
      <table
        className="w-full border-collapse text-left text-sm"
        // Wider with every group, so a workspace with five groups scrolls rather than squeezes.
        style={{ minWidth: `${1150 + groups.length * 160}px` }}
      >
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {selectable ? (
              <th scope="col" className="w-8 px-3 py-2">
                <span className="sr-only">Select</span>
              </th>
            ) : null}
            <SortHeader query={query} sort="name" label="Company" />
            {groups.map((g) => (
              <th key={g.id} scope="col" className="px-3 py-2 font-medium">
                {g.name}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 font-medium">Assigned To</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <SortHeader query={query} sort="priority" label="Priority" />
            <th scope="col" className="px-3 py-2 font-medium">Leads</th>
            <th scope="col" className="px-3 py-2 font-medium">Location</th>
            <SortHeader query={query} sort="employees" label="Employees" />
            <SortHeader query={query} sort="last_activity" label="Last Activity" />
            <th scope="col" className="px-3 py-2 font-medium">Source</th>
            <th scope="col" className="px-3 py-2 font-medium">LinkedIn</th>
            <th scope="col" className="px-3 py-2 font-medium">Sales Nav</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line align-top last:border-0">
              {selectable ? (
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    name="accountId"
                    value={row.id}
                    aria-label={`Select ${row.name ?? 'account'}`}
                    className="h-4 w-4"
                  />
                </td>
              ) : null}
              <td className="px-3 py-2.5">
                <Link href={`/crm/companies/${row.id}`} className="font-medium text-ink hover:underline">
                  {row.name ?? 'Unnamed account'}
                </Link>
                {row.domain ? <p className="text-xs text-muted">{row.domain}</p> : null}
              </td>
              {groups.map((g) => (
                <td key={g.id} className="px-3 py-2.5">
                  <Pills tags={tagsIn(row, g.id)} />
                </td>
              ))}
              <td className="px-3 py-2.5">
                {row.assignees.length > 0 ? (
                  <span className="text-ink">{row.assignees.map((a) => a.name).join(', ')}</span>
                ) : (
                  <span className="text-muted">Unassigned</span>
                )}
              </td>
              <td className="px-3 py-2.5">{row.status ? row.status.name : <NotAvailable />}</td>
              <td className="px-3 py-2.5">{row.priority ? PRIORITY_LABELS[row.priority] : <NotAvailable />}</td>
              <td className="px-3 py-2.5">
                <CompanyPeople
                  companyId={row.id}
                  companyName={row.name ?? 'this account'}
                  count={row.leadCount}
                  preview={people.get(row.id) ?? []}
                />
              </td>
              <td className="px-3 py-2.5">{row.location ?? <NotAvailable />}</td>
              <td className="px-3 py-2.5 tabular-nums">
                {row.employeeCount !== null
                  ? row.employeeCount.toLocaleString()
                  : (row.employeeCountRange ?? <NotAvailable />)}
              </td>
              <td className="px-3 py-2.5 text-muted">
                {row.lastActivityAt ? <RelativeTime iso={row.lastActivityAt} /> : <NotAvailable />}
              </td>
              <td className="px-3 py-2.5 text-muted">{SOURCE_LABELS[row.source] ?? row.source}</td>
              <td className="px-3 py-2.5">
                <ExternalLink url={row.linkedInUrl} label="Company page" />
              </td>
              <td className="px-3 py-2.5">
                <ExternalLink url={row.salesNavigatorUrl} label="Sales Navigator" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortHeader({ query, sort, label }: { query: AccountQuery; sort: AccountSort; label: string }) {
  const current = query.sort === sort
  // First click on a column sorts ascending, except dates and size, where the
  // useful end is the top: most recent activity, biggest company.
  const firstDesc = sort === 'last_activity' || sort === 'employees' || sort === 'priority'
  const desc = current ? !query.desc : firstDesc
  return (
    <th
      scope="col"
      className="px-3 py-2 font-medium"
      aria-sort={current ? (query.desc ? 'descending' : 'ascending') : undefined}
    >
      <Link href={accountsHref(query, { sort, desc })} className="inline-flex items-center gap-1 hover:text-ink">
        {label}
        {current ? <span aria-hidden="true">{query.desc ? '↓' : '↑'}</span> : null}
      </Link>
    </th>
  )
}

export function Pills({ tags }: { tags: AccountTag[] }) {
  if (tags.length === 0) return <NotAvailable />
  return (
    <ul className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <li
          key={tag.id}
          title={[
            tag.title,
            tag.isActive ? null : 'disabled',
            tag.primary ? 'primary' : null,
            tag.source === 'rule' || tag.source === 'ai' ? 'suggested' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          className={[
            'rounded-full border px-2 py-0.5 text-xs',
            // The primary value is the account's main one: bold, not a different colour.
            tag.primary ? 'border-border-strong font-semibold text-ink' : 'border-line text-ink',
            // A suggestion (Phase D) is dashed until a person confirms it.
            tag.source === 'rule' || tag.source === 'ai' ? 'border-dashed' : '',
            tag.isActive ? '' : 'opacity-60',
          ].join(' ')}
        >
          {tag.label}
          {tag.source === 'rule' || tag.source === 'ai' ? <span className="sr-only"> (suggested)</span> : null}
        </li>
      ))}
    </ul>
  )
}

export function NotAvailable() {
  return (
    <span className="text-muted" title="Not Available">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not Available</span>
    </span>
  )
}

/** A visible, clickable URL — never a guessed one; `safeSourceUrl` refuses non-http(s). */
export function ExternalLink({ url, label }: { url: string | null; label: string }) {
  if (!url) return <NotAvailable />
  // A URL typed without its scheme ("linkedin.com/company/acme") is still a link.
  const href = safeSourceUrl(url) ?? safeSourceUrl(`https://${url}`)
  if (!href) return <span className="break-all text-xs text-ink">{url}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={url}
      className="text-xs text-ink underline decoration-border decoration-dotted underline-offset-2 hover:text-accent hover:decoration-accent"
    >
      {label}
    </a>
  )
}
