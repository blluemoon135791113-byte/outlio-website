import type { Metadata } from 'next'
import Link from 'next/link'

import { AccountBulkBar } from '@/components/crm/accounts/AccountBulkBar'
import { AccountFilters, accountsHref } from '@/components/crm/accounts/AccountFilters'
import { AccountsTable } from '@/components/crm/accounts/AccountsTable'
import { NewAccountButton } from '@/components/crm/accounts/NewAccount'
import type { CompanyPerson } from '@/components/crm/CompanyPeople'
import { accountAccessIfPermitted } from '@/lib/crm/account-access'
import { openStageChoices } from '@/lib/crm/account-deals'
import { activeFilterCount, parseAccountQuery, type AccountQuery } from '@/lib/crm/account-filters'
import { accountFacets, activeGroups, listAccounts, loadAccountVocabulary } from '@/lib/crm/accounts'
import { listAssignableMembers } from '@/lib/crm/contacts-list'
import { emptyReason } from '@/lib/crm/empty-reason'
import { createAdminClient } from '@/lib/supabase/admin'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Accounts | Outlio',
  robots: { index: false, follow: false },
}

/** Names kept per account for the Leads hover. A display cap; the count is exact. */
const PEOPLE_PREVIEW = 8

/**
 * Accounts — the account workspace's list (spec §6.1).
 *
 * The route stays `/crm/companies` (approved 2026-10-01): every existing link
 * keeps working, and `/accounts` redirects here.
 *
 * ⚠️ VISIBILITY IS NOT APPLIED ON THIS PAGE, AND THAT IS DELIBERATE. It lives
 * inside `crm_list_accounts` / `crm_account_facets` (0150), which take the
 * viewer's `view_all` as an argument and restrict to their own assignments
 * whenever it is false — whatever the URL asks for. This page cannot forget it.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await accountAccessIfPermitted()
  // The CRM layout explains a missing module or role; this only stops the work.
  if (!access) return null

  const query = parseAccountQuery(await searchParams)
  const workspaceId = access.ctx.workspace.id

  const [vocab, members] = await Promise.all([
    loadAccountVocabulary(workspaceId),
    listAssignableMembers(workspaceId),
  ])
  const [listing, facets] = await Promise.all([
    listAccounts(access, query, vocab, members),
    accountFacets(access, query, vocab),
  ])

  const contactScope = dataScope(access.ctx.role) === 'assigned' ? access.ctx.userId : null
  const { preview: people, counts } = await peoplePreview(
    workspaceId,
    listing.rows.map((r) => r.id),
    contactScope,
  )
  /*
   * ⚠️ FOR A VIEWER LIMITED TO THEIR OWN CONTACTS, THE LEADS COUNT IS THEIRS
   * TOO. The account's total would let the hover say "12 more" about people
   * they cannot open — and a count disagreeing with the names beside it reads
   * as a broken page.
   */
  const rows = contactScope
    ? listing.rows.map((row) => ({ ...row, leadCount: counts.get(row.id) ?? 0 }))
    : listing.rows

  const canCreate = access.can('accounts.create')
  const canAssign = access.can('accounts.assign')
  const lastPage = Math.max(1, Math.ceil(listing.total / listing.pageSize))
  const canCreateDeals = can({ role: access.ctx.role, modules: access.ctx.modules }, 'crm.opportunity.create')
  const dealStages = canCreateDeals ? await openStageChoices(workspaceId) : []
  const selectable =
    canAssign || access.can('accounts.edit') || access.can('accounts.edit_tags') || dealStages.length > 0
  const groups = activeGroups(vocab)

  const memberChoices = [...members]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({ id: m.userId, label: m.name }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Accounts</h2>
          <p className="mt-0.5 text-sm text-muted">
            {access.viewAll
              ? 'Every company your team sells to, sorted by your own tags.'
              : 'The accounts assigned to you.'}
          </p>
        </div>
        {canCreate ? (
          <NewAccountButton
            groups={groups.map((g) => ({
              id: g.id,
              name: g.name,
              hasPrimary: g.hasPrimary,
              values: g.values
                .filter((v) => v.isActive)
                .map((v) => ({ id: v.id, label: v.name, title: v.description ?? undefined })),
            }))}
            statuses={vocab.statuses.filter((s) => s.isActive).map((s) => ({ id: s.id, label: s.name }))}
            assignees={canAssign ? memberChoices : []}
          />
        ) : null}
      </div>

      <AccountFilters
        query={query}
        vocab={vocab}
        facets={facets}
        members={members}
        viewAll={access.viewAll}
        canManageTags={access.can('config.manage')}
      />

      {listing.rows.length === 0 ? (
        <EmptyAccounts query={query} total={listing.total} viewAll={access.viewAll} canCreate={canCreate} />
      ) : (
        <AccountBulkBar
          assignees={canAssign ? memberChoices : []}
          statuses={vocab.statuses.filter((s) => s.isActive).map((s) => ({ id: s.id, label: s.name }))}
          tags={groups.flatMap((g) =>
            g.values.filter((v) => v.isActive).map((v) => ({ id: v.id, label: `${g.name}: ${v.name}` })),
          )}
          canAssign={canAssign}
          canEditStatus={access.can('accounts.edit')}
          canEditTags={access.can('accounts.edit_tags')}
          deals={dealStages.map((s) => ({ id: s.stageId, label: s.label }))}
        >
          <AccountsTable rows={rows} query={query} selectable={selectable} people={people} groups={groups} />

          <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
            <PageLink query={query} page={query.page - 1} disabled={query.page <= 1} label="Previous" />
            <span className="text-xs text-muted">
              {listing.total.toLocaleString()} account{listing.total === 1 ? '' : 's'} · page {query.page} of {lastPage}
            </span>
            <PageLink query={query} page={query.page + 1} disabled={query.page >= lastPage} label="Next" />
          </nav>
        </AccountBulkBar>
      )}
    </div>
  )
}

/**
 * Up to eight names per account for the Leads hover — ONE query for the page,
 * never one per row.
 */
async function peoplePreview(
  workspaceId: string,
  companyIds: string[],
  /** Set for a viewer limited to their own contacts (`dataScope` = assigned). */
  ownerUserId: string | null,
): Promise<{ preview: Map<string, CompanyPerson[]>; counts: Map<string, number> }> {
  const out = new Map<string, CompanyPerson[]>()
  const counts = new Map<string, number>()
  if (companyIds.length === 0) return { preview: out, counts }

  let query = createAdminClient()
    .from('crm_contacts')
    .select('id, full_name, job_title, primary_company_id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .in('primary_company_id', companyIds)
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(ownerUserId ? 2000 : companyIds.length * PEOPLE_PREVIEW * 4)
  if (ownerUserId) query = query.eq('owner_user_id', ownerUserId)

  const { data } = await query

  for (const row of data ?? []) {
    if (!row.primary_company_id) continue
    counts.set(row.primary_company_id, (counts.get(row.primary_company_id) ?? 0) + 1)
    const list = out.get(row.primary_company_id) ?? []
    if (list.length < PEOPLE_PREVIEW) {
      list.push({ id: row.id, name: row.full_name, jobTitle: row.job_title })
      out.set(row.primary_company_id, list)
    }
  }
  return { preview: out, counts }
}

function EmptyAccounts({
  query,
  total,
  viewAll,
  canCreate,
}: {
  query: AccountQuery
  total: number
  viewAll: boolean
  canCreate: boolean
}) {
  const reason = emptyReason({ search: query.q ?? '', filterCount: activeFilterCount(query), page: query.page, total })

  const copy =
    reason === 'past_end'
      ? {
          title: `Nothing on page ${query.page}`,
          body: `${total.toLocaleString()} account${total === 1 ? ' matches' : 's match'} this view, on earlier pages.`,
          href: accountsHref(query, { page: 1 }),
          label: 'Back to the first page',
        }
      : reason === 'no_match_search' || reason === 'no_match_filters'
        ? {
            title: query.q ? `Nothing matched “${query.q}”` : 'No accounts match these filters',
            body: 'Clearing the filters shows the full list.',
            href: accountsHref(query, {
              tags: {},
              assignee: undefined,
              status: undefined,
              priority: undefined,
              source: undefined,
              q: undefined,
            }),
            label: 'Clear filters',
          }
        : viewAll
          ? {
              title: 'No accounts yet',
              body: 'Accounts arrive from lead searches, imports, or by adding one here.',
              href: '/crm/import',
              label: 'Import',
            }
          : {
              title: 'No accounts are assigned to you yet',
              body: 'Your admin assigns accounts. They appear here as soon as one is yours.',
              href: null,
              label: null,
            }

  return (
    <div className="clay p-10 text-center">
      <h3 className="text-base font-semibold text-ink">{copy.title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{copy.body}</p>
      {copy.href ? (
        <div className="mt-5 flex justify-center">
          <Link
            href={copy.href}
            className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-3.5 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted"
          >
            {copy.label}
          </Link>
        </div>
      ) : null}
      {reason === 'none_yet' && canCreate && !viewAll ? (
        <p className="mt-3 text-xs text-muted">You can also add one with “+ Add Account” above.</p>
      ) : null}
    </div>
  )
}

function PageLink({
  query,
  page,
  disabled,
  label,
}: {
  query: AccountQuery
  page: number
  disabled: boolean
  label: string
}) {
  const className = 'rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold transition-colors duration-150'
  if (disabled) return <span className={`${className} cursor-not-allowed text-muted opacity-50`}>{label}</span>
  return (
    <Link href={accountsHref(query, { page })} className={`${className} text-muted hover:text-ink`}>
      {label}
    </Link>
  )
}
