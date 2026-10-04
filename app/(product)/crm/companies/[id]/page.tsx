import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  AccountFieldsEditor,
  AssigneeEditor,
  DeleteAccount,
  NoteForm,
  TagGroupEditor,
  StatusSelect,
} from '@/components/crm/accounts/AccountEditors'
import { SOURCE_LABELS } from '@/components/crm/accounts/AccountFilters'
import { ExternalLink, NotAvailable, Pills } from '@/components/crm/accounts/AccountsTable'
import { LeadRoleCell, RefreshRoles } from '@/components/crm/accounts/LeadRoles'
import { NewAccountDealButton } from '@/components/crm/accounts/AccountDeal'
import { NewContactButton } from '@/components/crm/NewContact'
import { SocialLinkList } from '@/components/crm/SocialLinks'
import { MoreDetails } from '@/components/crm/MoreDetails'
import { ValueProvenance } from '@/components/crm/ValueProvenance'
import { RelativeTime } from '@/components/ui/LocalTime'
import { accountAccessIfPermitted } from '@/lib/crm/account-access'
import {
  getAccount,
  getAccountSettings,
  listAccountNotes,
  listAccountSources,
  listAccountTimeline,
  loadAccountVocabulary,
  openDealStages,
  tagsIn,
} from '@/lib/crm/accounts'
import { openStageChoices } from '@/lib/crm/account-deals'
import { listContactLinks } from '@/lib/crm/contact-links'
import { getContactRoles, loadLeadRoles } from '@/lib/crm/lead-role-service'
import { companyDetails, companyWebsite, linkedInSlug } from '@/lib/crm/company-details'
import { listAssignableMembers } from '@/lib/crm/contacts-list'
import { companyCitations, safeSourceUrl, type Provenance } from '@/lib/crm/provenance'
import { isAppError } from '@/lib/errors/catalog'
import { formatMoney } from '@/lib/format/money'
import { createAdminClient } from '@/lib/supabase/admin'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Account | Outlio',
  robots: { index: false, follow: false },
}

const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

const ACTIVITY_LABELS: Record<string, string> = {
  ACCOUNT_ASSIGNED: 'Assigned',
  ACCOUNT_UNASSIGNED: 'Unassigned',
  ACCOUNT_STATUS_CHANGED: 'Status changed',
  ACCOUNT_TAGS_CHANGED: 'Tags changed',
  NOTE_ADDED: 'Note added',
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: 'Added by hand',
  html_upload: 'Uploaded page',
  extension: 'Browser extension',
  spreadsheet_row: 'Spreadsheet row',
  url: 'URL',
}

/** A stored URL as a link — with or without the scheme it was typed with. */
function linkFor(url: string | null): string | null {
  if (!url) return null
  return safeSourceUrl(url) ?? safeSourceUrl(`https://${url}`)
}

/**
 * One account (spec §6.2): Overview · People · Research & notes · Activity.
 *
 * ⚠️ AN ACCOUNT IS NOT A CONTACT, and each half keeps its own rule. Whether
 * this page opens at all is the ACCOUNT rule (assigned, or view_all), enforced
 * by `getAccount`, which answers NOT FOUND — never forbidden — so an id typed
 * into the address bar confirms nothing. The people on it follow the CONTACT
 * rule (`dataScope`), unchanged.
 */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await accountAccessIfPermitted()
  if (!access) return null
  const { id } = await params
  const ctx = access.ctx
  const workspaceId = ctx.workspace.id

  const [vocab, members, settings] = await Promise.all([
    loadAccountVocabulary(workspaceId),
    listAssignableMembers(workspaceId),
    getAccountSettings(workspaceId),
  ])

  let account
  try {
    account = await getAccount(access, id, vocab)
  } catch (error) {
    if (isAppError(error) && error.code === 'ERR_NOT_FOUND') notFound()
    throw error
  }

  const contactScope = dataScope(ctx.role) === 'assigned' ? 'assigned' : 'all'
  const db = createAdminClient()

  /*
   * ⚠️ PEOPLE AND DEALS FOLLOW THE CONTACT RULE, IN THE QUERY. Filtering after
   * a LIMIT dropped a setter's own contacts on any account with more than 100
   * people — they sorted past the cut and silently vanished. And deals, like
   * the board (lib/crm/board-actions.ts), are narrowed to the setter's own.
   */
  let peopleQuery = db
    .from('crm_contacts')
    .select('id, full_name, job_title, owner_user_id, linkedin_url, sales_navigator_url')
    .eq('workspace_id', workspaceId)
    .eq('primary_company_id', id)
    .is('deleted_at', null)
    .order('full_name')
    .limit(100)
  let dealsQuery = db
    .from('crm_opportunities')
    .select('id, title, value_amount, currency, status, pipeline_id, stage_id')
    .eq('workspace_id', workspaceId)
    .eq('company_id', id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (contactScope === 'assigned') {
    peopleQuery = peopleQuery.eq('owner_user_id', ctx.userId)
    dealsQuery = dealsQuery.eq('owner_user_id', ctx.userId)
  }

  const [{ data: contacts }, { data: opportunities }, timeline, notes, sources, citations, details] =
    await Promise.all([
      peopleQuery,
      dealsQuery,
      listAccountTimeline(access, id, { limit: 50, contactScope }),
      listAccountNotes(access, id),
      listAccountSources(access, id),
      companyCitations(ctx.scope, {
        sourceCompanyId: account.sourceCompanyId,
        source: account.source,
        values: {
          industry: account.industry,
          employee_count: account.employeeCount,
          headquarters: account.location,
        },
      }),
      companyDetails(ctx.scope, account.sourceCompanyId),
    ])

  const people = contacts ?? []
  const peopleIds = people.map((p) => p.id)
  const [leadRoles, stages] = await Promise.all([
    loadLeadRoles(workspaceId),
    openDealStages(workspaceId, peopleIds, { ownerUserId: contactScope === 'assigned' ? ctx.userId : null }),
  ])
  const [rolesByContact, linksByContact] = await Promise.all([
    getContactRoles(workspaceId, peopleIds, leadRoles),
    listContactLinks(workspaceId, peopleIds),
  ])
  const roleChoices = leadRoles.filter((r) => r.isActive).map((r) => ({ id: r.id, name: r.name }))
  const workspacePolicy = { role: ctx.role, modules: ctx.modules }
  const canEditLeads = can(workspacePolicy, 'crm.contact.edit')
  const canAddLead = can(workspacePolicy, 'crm.contact.create')
  const canImportLeads = can(workspacePolicy, 'crm.import')
  const canCreateDeal = can(workspacePolicy, 'crm.opportunity.create')
  const signals = latestSignals(sources)
  const deals = opportunities ?? []
  const [stageNames, dealStages] = await Promise.all([
    dealStageNames(workspaceId, deals.map((d) => d.stage_id)),
    canCreateDeal ? openStageChoices(workspaceId) : Promise.resolve([]),
  ])
  const nameOf = new Map(members.map((m) => [m.userId, m.name]))
  const personName = (userId: string | null) => (userId ? (nameOf.get(userId) ?? 'Former member') : null)

  const canEdit = access.can('accounts.edit')
  const canTags = access.can('accounts.edit_tags')
  const canAssign = access.can('accounts.assign')

  /*
   * ⚠️ A DISABLED VALUE ALREADY ON THE ACCOUNT STAYS IN THE EDITOR'S LIST.
   * Offering only active values would drop it from the form, and the next
   * save would silently remove a tag nobody chose to remove.
   */
  const carried = new Set(account.tags.map((t) => t.id))
  /*
   * Every active group, plus any DISABLED group this account still has values
   * in — hiding it would hide data the account carries.
   */
  const overviewGroups = vocab.groups.filter((g) => g.isActive || g.values.some((v) => carried.has(v.id)))
  const statusChoices = vocab.statuses
    .filter((s) => s.isActive || s.id === account.status?.id)
    .map((s) => ({ id: s.id, label: s.name }))

  const facts: {
    label: string
    value: string | null
    display?: string
    href?: string | null
    provenance?: Provenance
  }[] = [
    { label: 'Website', value: account.domain, href: companyWebsite(account.domain) },
    {
      label: 'LinkedIn',
      value: account.linkedInUrl,
      display: linkedInSlug(account.linkedInUrl) ?? undefined,
      href: linkFor(account.linkedInUrl),
    },
    // A visible URL, as the spec asks — not "click here".
    { label: 'Sales Navigator', value: account.salesNavigatorUrl, href: linkFor(account.salesNavigatorUrl) },
    { label: 'Location', value: account.location, provenance: citations.headquarters },
    {
      label: 'Employees',
      value: account.employeeCount !== null ? account.employeeCount.toLocaleString() : account.employeeCountRange,
      provenance: account.employeeCount !== null ? citations.employee_count : undefined,
    },
    { label: 'Industry', value: account.industry, provenance: citations.industry },
    { label: 'Priority', value: account.priority ? (PRIORITY_LABELS[account.priority] ?? account.priority) : null },
    { label: 'Source', value: SOURCE_LABELS[account.source] ?? account.source },
    { label: 'Added by', value: personName(account.createdBy) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/crm/companies" className="text-xs text-muted hover:text-ink">
            ← Accounts
          </Link>
          <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
            {account.name ?? 'Unnamed account'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <StatusSelect companyId={account.id} statuses={statusChoices} current={account.status?.id ?? null} />
          ) : (
            <span className="text-sm text-ink">{account.status?.name ?? 'Not Available'}</span>
          )}
          {access.can('accounts.delete') ? (
            <DeleteAccount companyId={account.id} name={account.name ?? 'this account'} />
          ) : null}
        </div>
      </div>

      {/* ---------------- Overview ---------------- */}
      <section aria-labelledby="overview" className="clay space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 id="overview" className="text-sm font-semibold text-ink">
            Overview
          </h3>
          {canEdit ? (
            <AccountFieldsEditor
              companyId={account.id}
              fields={{
                name: account.name,
                websiteUrl: account.domain,
                linkedInUrl: account.linkedInUrl,
                salesNavigatorUrl: account.salesNavigatorUrl,
                location: account.location,
                employeeCount: account.employeeCount,
                employeeCountRange: account.employeeCountRange,
                summary: account.summary,
                priority: account.priority,
              }}
            />
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {overviewGroups.map((group) => {
            const own = tagsIn(account, group.id)
            return (
              <div key={group.id}>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted">
                    {group.name}
                    {group.isActive ? '' : ' (disabled group)'}
                  </p>
                  {canTags && group.isActive ? (
                    <TagGroupEditor
                      companyId={account.id}
                      group={{ id: group.id, name: group.name, hasPrimary: group.hasPrimary }}
                      choices={group.values
                        .filter((v) => v.isActive || carried.has(v.id))
                        .map((v) => ({
                          id: v.id,
                          label: v.isActive ? v.name : `${v.name} (disabled)`,
                          title: v.description ?? undefined,
                        }))}
                      primaryId={own.find((t) => t.primary)?.id ?? null}
                      selectedIds={own.filter((t) => !t.primary).map((t) => t.id)}
                    />
                  ) : null}
                </div>
                {/* The full name or note on the detail page; the table shows the short one. */}
                <div className="mt-1">
                  <Pills tags={own.map((t) => ({ ...t, label: t.title !== t.label ? `${t.label} — ${t.title}` : t.label }))} />
                </div>
              </div>
            )
          })}

          {overviewGroups.length === 0 ? (
            <div>
              <p className="text-xs text-muted">Tags</p>
              <p className="mt-1 text-sm text-muted">
                No tag groups yet.
                {access.can('config.manage') ? (
                  <>
                    {' '}
                    <Link href="/dashboard/settings/tags" className="underline underline-offset-2 hover:text-ink">
                      Create them in Settings → Tags
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
          ) : null}

          <div>
            <p className="text-xs text-muted">Assigned to</p>
            <div className="mt-1">
              {canAssign ? (
                <AssigneeEditor
                  companyId={account.id}
                  assigned={account.assignees.map((a) => ({ id: a.userId, label: a.name }))}
                  members={members.map((m) => ({ id: m.userId, label: m.name }))}
                  allowMultiple={settings.allowMultipleAssignees}
                />
              ) : account.assignees.length > 0 ? (
                <p className="text-sm text-ink">{account.assignees.map((a) => a.name).join(', ')}</p>
              ) : (
                <p className="text-sm text-muted">Unassigned</p>
              )}
            </div>
          </div>
        </div>

        <dl className="grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-xs text-muted">{fact.label}</dt>
              {/* "Not Available", never a blank or a zero (rule 4). */}
              <dd className={fact.value ? 'text-sm text-ink' : 'text-sm text-muted'}>
                {fact.value === null ? (
                  'Not Available'
                ) : fact.href ? (
                  <a
                    href={fact.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all underline decoration-border decoration-dotted underline-offset-2 transition-colors duration-150 hover:text-accent hover:decoration-accent"
                    title={fact.value}
                  >
                    {fact.display ?? fact.value}
                  </a>
                ) : (
                  <span className="break-words">{fact.value}</span>
                )}
              </dd>
              {fact.value && fact.provenance ? (
                <dd className="mt-0.5">
                  <ValueProvenance provenance={fact.provenance} />
                </dd>
              ) : null}
            </div>
          ))}
        </dl>

        <div className="border-t border-line pt-4">
          <p className="text-xs text-muted">Summary</p>
          {account.summary ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">{account.summary}</p>
          ) : (
            <p className="mt-1 text-sm text-muted">Not Available</p>
          )}
        </div>

        {signals ? (
          <div className="border-t border-line pt-4">
            <p className="text-xs text-muted">
              Sales Navigator signals · seen <RelativeTime iso={signals.seenAt} />
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {signals.keys.map((key) => (
                <li key={key} className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {signalLabel(key)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <MoreDetails details={details} />

      {/* ---------------- People ---------------- */}
      <section aria-labelledby="people" className="clay space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="people" className="text-sm font-semibold text-ink">
            People {people.length > 0 ? `(${people.length})` : ''}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && canEditLeads && people.length > 0 ? <RefreshRoles companyId={account.id} /> : null}
            {canImportLeads ? (
              <Link
                href={`/crm/import?company=${account.id}`}
                className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted"
              >
                Import leads
              </Link>
            ) : null}
            {canAddLead ? <NewContactButton account={{ id: account.id, name: account.name ?? 'this account' }} /> : null}
            {canAddLead && canEditLeads ? (
              <NewContactButton
                account={{ id: account.id, name: account.name ?? 'this account' }}
                variant="decision_maker"
              />
            ) : null}
          </div>
        </div>

        {people.length === 0 ? (
          <p className="text-sm text-muted">
            {contactScope === 'assigned'
              ? 'Nobody at this account is assigned to you yet.'
              : 'No leads are linked to this account yet.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th scope="col" className="px-2 py-2 font-medium">Name</th>
                  <th scope="col" className="px-2 py-2 font-medium">Title</th>
                  <th scope="col" className="px-2 py-2 font-medium">Role(s)</th>
                  <th scope="col" className="px-2 py-2 font-medium">LinkedIn</th>
                  <th scope="col" className="px-2 py-2 font-medium">Sales Nav</th>
                  <th scope="col" className="px-2 py-2 font-medium">Other profiles</th>
                  <th scope="col" className="px-2 py-2 font-medium">Lead status</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const roles = rolesByContact.get(person.id) ?? { roles: [], manual: false }
                  return (
                    <tr key={person.id} className="border-b border-line align-top last:border-0">
                      <td className="px-2 py-2">
                        <Link href={`/crm/contacts/${person.id}`} className="font-medium text-ink hover:underline">
                          {person.full_name ?? 'Unnamed lead'}
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-ink">{person.job_title ?? <NotAvailable />}</td>
                      <td className="px-2 py-2">
                        <LeadRoleCell
                          contactId={person.id}
                          companyId={account.id}
                          roles={roles.roles}
                          manual={roles.manual}
                          choices={roleChoices}
                          canEdit={canEditLeads}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <ExternalLink url={person.linkedin_url} label="Profile" />
                      </td>
                      <td className="px-2 py-2">
                        <ExternalLink url={person.sales_navigator_url} label="Sales Navigator" />
                      </td>
                      <td className="px-2 py-2">
                        {(linksByContact.get(person.id) ?? []).length > 0 ? (
                          <SocialLinkList
                            links={(linksByContact.get(person.id) ?? []).map((link) => ({
                              ...link,
                              href: safeSourceUrl(link.url),
                            }))}
                          />
                        ) : (
                          <NotAvailable />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {stages.get(person.id) ?? <span className="text-muted">No open deal</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="deals" className="clay p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="deals" className="text-sm font-semibold text-ink">
            Deals {deals.length > 0 ? `(${deals.length})` : ''}
          </h3>
          {canCreateDeal && dealStages.length > 0 ? (
            <NewAccountDealButton
              account={{ id: account.id, name: account.name ?? account.domain ?? 'this account' }}
              stages={dealStages.map((s) => ({ stageId: s.stageId, label: s.label }))}
              people={people.map((p) => ({ id: p.id, name: p.full_name ?? 'Unnamed lead' }))}
              workspaceCurrency={ctx.workspace.defaultCurrency}
            />
          ) : null}
        </div>
        {deals.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {canCreateDeal && dealStages.length === 0
              ? 'No deals yet. Set up a pipeline with an open stage to add one.'
              : 'No deals against this account yet.'}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {deals.map((deal) => (
              <li key={deal.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="text-sm text-ink">{deal.title}</span>
                <span className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted">
                  <Link href={`/crm/pipeline?pipeline=${deal.pipeline_id}`} className="hover:text-ink hover:underline">
                    {stageNames.get(deal.stage_id) ?? 'Pipeline'}
                  </Link>
                  {deal.status === 'open' ? null : <span>{deal.status === 'won' ? 'Won' : 'Lost'}</span>}
                  <span>
                    {deal.value_amount === null
                      ? 'Value not set'
                      : formatMoney(Number(deal.value_amount), deal.currency, 'cents')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------- Research & notes ---------------- */}
        <section aria-labelledby="research" className="clay space-y-4 p-4">
          <h3 id="research" className="text-sm font-semibold text-ink">
            Research &amp; notes
          </h3>
          {canEdit ? <NoteForm companyId={account.id} /> : null}

          {notes.length === 0 ? (
            <p className="text-sm text-muted">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {notes.map((note) => (
                <li key={note.id} className="border-l-2 border-border pl-3">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{note.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {note.authorUserId ? `${personName(note.authorUserId)} · ` : ''}
                    <RelativeTime iso={note.createdAt} />
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-line pt-3">
            <h4 className="text-xs font-semibold text-ink">Sources</h4>
            {sources.length === 0 ? (
              <p className="mt-1 text-xs text-muted">
                No source records yet. Uploads, imports and hand-entered accounts each leave one here.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {sources.map((source) => (
                  <li key={source.id} className="text-xs">
                    <p className="text-ink">
                      {SOURCE_TYPE_LABELS[source.type] ?? source.type}
                      {' · '}
                      <span className="text-muted">
                        <RelativeTime iso={source.importedAt} />
                        {source.importedBy ? ` · ${personName(source.importedBy)}` : ''}
                      </span>
                    </p>
                    {source.url ? (
                      linkFor(source.url) ? (
                        <a
                          href={linkFor(source.url)!}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="break-all text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
                        >
                          {source.url}
                        </a>
                      ) : (
                        <span className="break-all text-muted">{source.url}</span>
                      )
                    ) : null}
                    {source.payload ? <SourcePayload payload={source.payload} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ---------------- Activity ---------------- */}
        <section aria-labelledby="activity" className="clay space-y-3 p-4">
          <h3 id="activity" className="text-sm font-semibold text-ink">
            Activity
          </h3>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing has happened yet. Activity on this account and its people appears here.
            </p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((entry) => (
                <li key={entry.id} className="border-l-2 border-border pl-3">
                  <p className="text-sm font-medium text-ink">
                    {ACTIVITY_LABELS[entry.activityType] ?? entry.activityType.replace(/_/g, ' ').toLowerCase()}
                    {entry.contact ? (
                      <>
                        {' · '}
                        <Link
                          href={`/crm/contacts/${entry.contact.id}`}
                          className="font-normal text-muted hover:text-ink hover:underline"
                        >
                          {entry.contact.name ?? 'a lead'}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted">
                    <RelativeTime iso={entry.occurredAt} />
                    {entry.actorUserId ? ` · ${personName(entry.actorUserId)}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * The parsed row, as text. ⚠️ NEVER HTML (rule 3): values render as React text
 * nodes, which escapes them; nested objects are flattened to key paths.
 */
function SourcePayload({ payload }: { payload: Record<string, unknown> }) {
  const flat: [string, string][] = []
  const walk = (prefix: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(prefix ? `${prefix}.${k}` : k, v)
      return
    }
    flat.push([prefix, Array.isArray(value) ? value.join(', ') : String(value)])
  }
  walk('', payload)
  if (flat.length === 0) return null
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-muted hover:text-ink">Show the recorded values</summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {flat.slice(0, 40).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-all text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

/** "Pipeline › Stage" for each deal's stage, archived ones included (closed deals keep theirs). */
async function dealStageNames(workspaceId: string, stageIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (stageIds.length === 0) return out
  const db = createAdminClient()
  const { data: stages, error } = await db
    .from('crm_pipeline_stages')
    .select('id, name, pipeline_id')
    .eq('workspace_id', workspaceId)
    .in('id', [...new Set(stageIds)])
  if (error) throw new Error(`dealStageNames failed: ${error.message}`)
  const { data: pipelines, error: pipelineError } = await db
    .from('crm_pipelines')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .in('id', [...new Set((stages ?? []).map((s) => s.pipeline_id))])
  if (pipelineError) throw new Error(`dealStageNames failed: ${pipelineError.message}`)
  const pipelineName = new Map((pipelines ?? []).map((p) => [p.id, p.name]))
  for (const stage of stages ?? []) out.set(stage.id, `${pipelineName.get(stage.pipeline_id) ?? 'Pipeline'} › ${stage.name}`)
  return out
}

/**
 * The newest upload that showed LinkedIn signals for this account, as dated
 * observations — "hiring" on 2 Oct is a fact about 2 Oct, not about today.
 */
function latestSignals(sources: { importedAt: string; payload: Record<string, unknown> | null }[]) {
  for (const source of sources) {
    const raw = source.payload?.signals
    if (!Array.isArray(raw)) continue
    const keys = raw.filter((k): k is string => typeof k === 'string' && /^[a-z0-9_]{1,60}$/.test(k))
    if (keys.length > 0) return { keys, seenAt: source.importedAt }
  }
  return null
}

const SIGNAL_LABELS: Record<string, string> = {
  hiring_on_linkedin: 'Hiring on LinkedIn',
  aiq_strategic_priorities: 'Strategic priorities listed',
}

/** A known key reads as LinkedIn names it; an unknown one as its own words. */
function signalLabel(key: string): string {
  const known = SIGNAL_LABELS[key]
  if (known) return known
  const words = key.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
