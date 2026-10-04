import Link from 'next/link'

import { AutoApplyFilters } from '@/components/crm/AutoApplyFilters'
import { AddTagChip, AddTagGroup } from '@/components/crm/accounts/InlineTagAdd'
import {
  ACCOUNT_PRIORITIES,
  ACCOUNT_SOURCES,
  ACCOUNTS_PATH,
  accountQueryToParams,
  accountsHref,
  activeFilterCount,
  withTag,
  type AccountQuery,
} from '@/lib/crm/account-filters'
import type { AccountFacets, AccountVocabulary, Person } from '@/lib/crm/accounts'

export { ACCOUNTS_PATH, accountsHref }

export const SOURCE_LABELS: Record<string, string> = {
  lead_engine: 'Lead search',
  csv_import: 'Spreadsheet import',
  manual: 'Added by hand',
  api: 'API',
  flow: 'Workflow',
  extension: 'Browser extension',
}

const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

const CHIP =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150'
const CHIP_OFF = 'border-line bg-panel text-ink hover:border-border-strong'
const CHIP_ON = 'border-accent bg-accent-soft text-accent'

/**
 * The Accounts filter bar.
 *
 * ⚠️ LINKS AND A GET FORM, NO CLIENT STATE — the same choice as
 * `ContactFilters`, for the same reasons: the URL is the view, so it survives
 * a reload, can be bookmarked and shared, and the back button works.
 *
 * Chip counts come from `crm_account_facets` (0150): each ICP chip counts the
 * accounts matching every OTHER active filter, so picking "Hospital" does not
 * zero out "TPA" — it tells you what you would get if you switched.
 */
export function AccountFilters({
  query,
  vocab,
  facets,
  members,
  viewAll,
  canManageTags = false,
}: {
  query: AccountQuery
  vocab: AccountVocabulary
  facets: AccountFacets
  members: Person[]
  viewAll: boolean
  /**
   * `config.manage`: each row gets "+ Add tag" and "Manage", and a "+ New tag
   * group" follows the rows. The rows are the workspace's own vocabulary.
   */
  canManageTags?: boolean
}) {
  const groups = vocab.groups.filter((g) => g.isActive)
  const statuses = vocab.statuses.filter((s) => s.isActive)
  const active = activeChips(query, vocab, members)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {viewAll ? (
          <nav aria-label="Whose accounts" className="flex gap-1">
            {(
              [
                { scope: 'mine', label: 'My Accounts' },
                { scope: 'all', label: 'All Accounts' },
              ] as const
            ).map((option) => {
              const current = (query.scope ?? 'all') === option.scope
              return (
                <Link
                  key={option.scope}
                  href={accountsHref(query, { scope: option.scope })}
                  aria-current={current ? 'page' : undefined}
                  className={
                    current
                      ? 'rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-semibold text-ink'
                      : 'rounded-[var(--radius-md)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink'
                  }
                >
                  {option.label}
                </Link>
              )
            })}
          </nav>
        ) : (
          <p className="text-xs font-semibold text-ink">My Accounts</p>
        )}

        <form method="get" action={ACCOUNTS_PATH} role="search" className="min-w-56 flex-1">
          <HiddenQuery query={query} omit={['q', 'page']} />
          <label className="sr-only" htmlFor="account-search">Search accounts</label>
          <input
            id="account-search"
            type="search"
            name="q"
            defaultValue={query.q ?? ''}
            placeholder="Search name, website, location or summary"
            className="w-full rounded-[var(--radius-md)] border border-line bg-surface px-3 py-1.5 text-sm text-ink"
          />
        </form>
      </div>

      {groups.length === 0 ? (
        <div className="text-xs text-muted">
          No tag groups yet.{' '}
          {canManageTags ? (
            <Link href="/dashboard/settings/tags" className="font-semibold underline underline-offset-2 hover:text-ink">
              Create your groups in Settings → Tags
            </Link>
          ) : (
            'An admin can create them in Settings → Tags.'
          )}{' '}
          — for example Industry, Product or Region.
          {canManageTags ? (
            <span className="ml-2 inline-block align-middle">
              <AddTagGroup />
            </span>
          ) : null}
        </div>
      ) : (
        groups.map((group) => {
          const counts = facets.get(group.id)
          const active = query.tags[group.slug]
          return (
            <ChipRow
              key={group.id}
              label={group.name}
              allHref={accountsHref(query, { tags: withTag(query.tags, group.slug, undefined) })}
              allCount={counts?.total ?? 0}
              allActive={!active}
              chips={group.values
                .filter((v) => v.isActive)
                .map((v) => ({
                  key: v.id,
                  label: v.name,
                  title: v.description ?? v.name,
                  count: counts?.byValue.get(v.id) ?? 0,
                  active: active === v.slug,
                  href: accountsHref(query, {
                    tags: withTag(query.tags, group.slug, active === v.slug ? undefined : v.slug),
                  }),
                }))}
              empty="No tags in this group yet."
              manage={canManageTags ? { groupId: group.id, groupName: group.name } : undefined}
            />
          )
        })
      )}

      {/* Every row above is a group this workspace defined; add another. */}
      {canManageTags && groups.length > 0 ? <AddTagGroup /> : null}

      <form
        method="get"
        action={ACCOUNTS_PATH}
        className="flex flex-wrap items-end gap-3 rounded-clay border border-line bg-surface p-3"
      >
        <HiddenQuery query={query} omit={['assignee', 'status', 'priority', 'source', 'page']} />

        <FilterSelect name="assignee" label="Assigned to" value={query.assignee}>
          <option value="">Anyone</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect name="status" label="Status" value={query.status}>
          <option value="">Any</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.slug}>
              {s.name}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect name="priority" label="Priority" value={query.priority}>
          <option value="">Any</option>
          {ACCOUNT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect name="source" label="Source" value={query.source}>
          <option value="">Any</option>
          {ACCOUNT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s] ?? s}
            </option>
          ))}
        </FilterSelect>

        <AutoApplyFilters action={ACCOUNTS_PATH}>
          <button
            type="submit"
            className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted"
          >
            Apply
          </button>
        </AutoApplyFilters>
      </form>

      {active.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          <span className="text-xs text-muted">Active:</span>
          {active.map((chip) => (
            <Link
              key={chip.key}
              href={accountsHref(query, chip.clear)}
              className={`${CHIP} ${CHIP_ON}`}
              aria-label={`Remove filter ${chip.label}`}
            >
              {chip.label}
              <span aria-hidden="true">×</span>
            </Link>
          ))}
          {activeFilterCount(query) > 1 ? (
            <Link
              href={accountsHref(query, {
                tags: {},
                assignee: undefined,
                status: undefined,
                priority: undefined,
                source: undefined,
                q: undefined,
              })}
              className="text-xs font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ChipRow({
  label,
  allHref,
  allCount,
  allActive,
  chips,
  empty,
  manage,
}: {
  label: string
  allHref: string
  allCount: number
  allActive: boolean
  chips: { key: string; label: string; title: string; count: number; active: boolean; href: string }[]
  empty: string
  /** For `config.manage`: add a tag here, and a link to edit the group. */
  manage?: { groupId: string; groupName: string }
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
        {manage ? (
          <Link
            href={`/dashboard/settings/tags#group-${manage.groupId}`}
            className="text-[11px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Manage
          </Link>
        ) : null}
      </div>
      {chips.length === 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted">{empty}</p>
          {manage ? <AddTagChip groupId={manage.groupId} groupName={manage.groupName} /> : null}
        </div>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          <li>
            <Link
              href={allHref}
              aria-current={allActive ? 'true' : undefined}
              className={`${CHIP} ${allActive ? CHIP_ON : CHIP_OFF}`}
            >
              All <Count n={allCount} />
            </Link>
          </li>
          {chips.map((chip) => (
            <li key={chip.key}>
              <Link
                href={chip.href}
                title={chip.title}
                aria-current={chip.active ? 'true' : undefined}
                className={`${CHIP} ${chip.active ? CHIP_ON : CHIP_OFF}`}
              >
                {chip.label} <Count n={chip.count} />
              </Link>
            </li>
          ))}
          {manage ? (
            <li>
              <AddTagChip groupId={manage.groupId} groupName={manage.groupName} />
            </li>
          ) : null}
        </ul>
      )}
    </div>
  )
}

function Count({ n }: { n: number }) {
  return <span className="tabular-nums text-muted">{n.toLocaleString()}</span>
}

function FilterSelect({
  name,
  label,
  value,
  children,
}: {
  name: string
  label: string
  value: string | undefined
  children: React.ReactNode
}) {
  return (
    <label className="text-xs font-medium text-muted">
      {label}
      <select
        name={name}
        defaultValue={value ?? ''}
        className="mt-1 block min-w-40 rounded-clay border border-line bg-white px-3 py-1.5 text-sm text-ink"
      >
        {children}
      </select>
    </label>
  )
}

/** Carries the rest of the view through a GET form, which submits only its own inputs. */
function HiddenQuery({ query, omit }: { query: AccountQuery; omit: (keyof AccountQuery | 'dir')[] }) {
  const params = accountQueryToParams(query)
  const skip = new Set<string>(omit.map((k) => (k === 'desc' ? 'dir' : k)))
  return (
    <>
      {[...params.entries()]
        .filter(([key]) => !skip.has(key))
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
    </>
  )
}

function activeChips(
  query: AccountQuery,
  vocab: AccountVocabulary,
  members: Person[],
): { key: string; label: string; clear: Partial<AccountQuery> }[] {
  const out: { key: string; label: string; clear: Partial<AccountQuery> }[] = []
  /*
   * ⚠️ AN UNKNOWN SLUG STILL GETS A CHIP. It filters to nothing (see
   * account-filters.ts), and without a chip the reader would see an empty list
   * with no idea why — and no way to remove the cause.
   */
  for (const [groupSlug, valueSlug] of Object.entries(query.tags)) {
    const group = vocab.groups.find((g) => g.slug === groupSlug)
    const value = group?.values.find((v) => v.slug === valueSlug)
    out.push({
      key: `tag:${groupSlug}`,
      label: group && value ? `${group.name}: ${value.name}` : `${groupSlug}: ${valueSlug} (no longer exists)`,
      clear: { tags: withTag(query.tags, groupSlug, undefined) },
    })
  }
  if (query.assignee) {
    const label =
      query.assignee === 'me'
        ? 'Assigned to me'
        : query.assignee === 'unassigned'
          ? 'Unassigned'
          : `Assigned to ${members.find((m) => m.userId === query.assignee)?.name ?? 'former member'}`
    out.push({ key: 'assignee', label, clear: { assignee: undefined } })
  }
  if (query.status) {
    const name = vocab.statuses.find((s) => s.slug === query.status)?.name
    out.push({ key: 'status', label: name ?? `${query.status} (no longer exists)`, clear: { status: undefined } })
  }
  if (query.priority) out.push({ key: 'priority', label: `${PRIORITY_LABELS[query.priority]} priority`, clear: { priority: undefined } })
  if (query.source) out.push({ key: 'source', label: SOURCE_LABELS[query.source] ?? query.source, clear: { source: undefined } })
  if (query.q) out.push({ key: 'q', label: `“${query.q}”`, clear: { q: undefined } })
  return out
}
