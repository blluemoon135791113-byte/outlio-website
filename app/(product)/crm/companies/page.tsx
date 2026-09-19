import type { Metadata } from 'next'
import Link from 'next/link'

import { CompanyPeople, type CompanyPerson } from '@/components/crm/CompanyPeople'
import { emptyReason } from '@/lib/crm/empty-reason'

import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceContextIfPermitted } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Companies | Outlio',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 25

/**
 * Names kept per company for the People hover.
 *
 * ⚠️ A DISPLAY CAP, NOT A QUERY LIMIT. The count beside it is computed from
 * every row and stays exact; this only decides how many names a 64-row popover
 * shows before it says "N more". Eight fills the panel without making it
 * scroll, which is the point of a preview.
 */
const PEOPLE_PREVIEW = 8

/**
 * Companies — M9, the route the CRM navigation has named since M2.
 *
 * ⚠️ THE CONTACT COUNT IS ONE BATCHED QUERY, not one per row. A 25-row page
 * with a per-row count is 25 extra round trips, which is the shape that makes
 * a list feel broken at volume.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const params = await searchParams
  const ctx = await workspaceContextIfPermitted('crm.contact.view')
  // The layout renders the reason; this only stops the page computing and
  // serialising its result into the RSC payload.
  if (!ctx) return null

  if (!can({ role: ctx.role, modules: ctx.modules }, 'crm.company.view')) {
    return (
      <div className="clay p-10 text-center">
        <p className="text-sm font-medium text-ink">You do not have access to companies</p>
      </div>
    )
  }

  const page = Math.max(Number(params.page ?? 1) || 1, 1)
  const from = (page - 1) * PAGE_SIZE
  const db = createAdminClient()

  /*
   * ⚠️ THE OWNER FILTER, WHICH THIS PAGE SHIPPED WITHOUT. Every other CRM
   * surface applies `dataScope` — contacts, contact detail, the board,
   * reports — and this one did not, so a setter saw every company in the
   * workspace. RLS does not catch it: RLS grants a MEMBER the whole
   * workspace, and narrowing to "only assigned" is a policy decision that has
   * to be applied to the QUERY.
   */
  const scopedToSelf = dataScope(ctx.role) === 'assigned'

  // Scoped by workspace in code — the service role bypasses RLS.
  let query = db
    .from('crm_companies')
    .select('id, name, domain, industry, employee_count, headquarters')
    .eq('workspace_id', ctx.workspace.id)
    .is('deleted_at', null)
    .order('name')
    /*
     * ⚠️ A STABLE TIEBREAKER. Two companies can share a name — different
     * entities, or the same one ingested twice before a merge — and without a
     * second key they swap places between pages, so one is shown twice and
     * another never appears. Same reasoning as `lib/crm/contacts-list.ts`.
     */
    .order('id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1)

  if (scopedToSelf) query = query.eq('owner_user_id', ctx.userId)

  const { data: companies } = await query

  const rows = companies ?? []
  const counts = new Map<string, number>()
  const people = new Map<string, CompanyPerson[]>()

  if (rows.length > 0) {
    /*
     * ⚠️ STILL ONE QUERY, AND STILL UNBOUNDED — unchanged from when this only
     * counted. Three more columns are selected so the People cell can name the
     * people rather than only tallying them, which is the whole point of the
     * hover; a second query for the names would either need a per-company
     * LIMIT that PostgREST cannot express, or a global one that lets a single
     * 300-person company eat the entire budget and leave every other row
     * without a preview.
     *
     * The COUNT is computed from every row, so it stays exact; only the number
     * of NAMES kept in memory is capped. The payload grows with the workspace,
     * which is the same shape of cost this query already had — recorded here
     * as the thing to fix if this page ever feels slow, alongside the `total:
     * null` note above.
     */
    const { data: links } = await db
      .from('crm_contacts')
      .select('id, full_name, job_title, primary_company_id')
      .eq('workspace_id', ctx.workspace.id)
      .is('deleted_at', null)
      .in('primary_company_id', rows.map((r) => r.id))
      .order('full_name', { ascending: true, nullsFirst: false })

    for (const link of links ?? []) {
      const companyId = link.primary_company_id
      if (!companyId) continue

      counts.set(companyId, (counts.get(companyId) ?? 0) + 1)

      const named = people.get(companyId) ?? []
      if (named.length < PEOPLE_PREVIEW) {
        named.push({
          id: link.id,
          name: link.full_name,
          jobTitle: link.job_title,
        })
        people.set(companyId, named)
      }
    }
  }

  /*
   * ⚠️ `total: null` — THIS LIST DELIBERATELY RUNS NO COUNT QUERY. The pager
   * infers "probably another page" from a full page instead, which is cheaper
   * than counting, so `page > 1` is the only signal available. It is enough:
   * page 1 with nothing really is empty.
   */
  const reason = emptyReason({ search: '', filterCount: 0, page, total: null })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Companies</h2>
        <p className="mt-0.5 text-sm text-muted">
          {scopedToSelf
            ? 'The companies you own, matched on registrable domain.'
            : 'Created automatically from the people you bring in, matched on registrable domain.'}
        </p>
        {/*
          ⚠️ SAYS WHY A CELL IS EMPTY. A table of dashes with no explanation
          reads as a broken feature, and the honest answer is specific: a Sales
          Navigator SEARCH page carries a company NAME and nothing else, so the
          industry and headcount only arrive from a source that saw the company
          page itself. Naming that is the difference between "this is broken"
          and "I know what to do next".
        */}
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Domain, industry and headcount fill in from an account extraction or an
          enriched company — a search-results save only carries the name. They are
          recorded as they are observed and never guessed.
        </p>
      </div>

      {rows.length === 0 ? (
        /*
         * ⚠️ PAGE 1 AND PAGE 9 ARE DIFFERENT QUESTIONS. `page` is not clamped,
         * so `?page=9` renders zero rows on a workspace full of companies —
         * and "No companies yet" is then a false statement about their data,
         * with a button that takes them somewhere unrelated.
         *
         * This list deliberately runs no count query (see the note above the
         * pager: a full page implies another, which is cheaper than counting).
         * So the total is unavailable and `page > 1` is the signal instead —
         * page 1 with nothing really is empty; page 9 means they walked past
         * the end.
         */
        <div className="clay p-10 text-center">
          <p className="text-sm font-medium text-ink">
            {reason === 'past_end' ? `Nothing on page ${page}` : 'No companies yet'}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            {reason === 'past_end'
              ? 'The companies are on earlier pages.'
              : 'A company appears here as soon as a contact arrives with one — nothing to set up.'}
          </p>
          <Link
            href={reason === 'past_end' ? '/crm/companies' : '/crm/contacts'}
            className="mt-3 inline-block rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:bg-accent-deep"
          >
            {reason === 'past_end' ? 'Back to the first page' : 'Go to contacts'}
          </Link>
        </div>
      ) : (
        <>
          <div className="clay overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
                  <th scope="col" className="px-4 py-3 font-semibold">Company</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Domain</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Industry</th>
                  {/*
                    ⚠️ TWO DIFFERENT NUMBERS, NAMED DIFFERENTLY. "Employees" is
                    how big the company is, observed on its LinkedIn page;
                    "People" is how many of them are in YOUR CRM. One header
                    covering both would make a 4,000-person company with two
                    contacts unreadable either way round.
                  */}
                  <th scope="col" className="px-4 py-3 font-semibold">Employees</th>
                  <th scope="col" className="px-4 py-3 font-semibold">People</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((company) => (
                  <tr key={company.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">
                      {/* The row is now a way in. Until R2 the company detail
                          view did not exist at all. */}
                      <Link
                        href={`/crm/companies/${company.id}`}
                        className="hover:underline"
                      >
                        {company.name ?? 'Unnamed company'}
                      </Link>
                      {company.headquarters ? (
                        <span className="ml-2 text-xs font-normal text-muted">
                          {company.headquarters}
                        </span>
                      ) : null}
                    </td>
                    {/*
                      ⚠️ AN EM DASH, NOT A BLANK. A missing value must read as
                      "we do not have this", never as an empty cell that looks
                      like a rendering fault. Never invented — CLAUDE.md rule 4.
                    */}
                    <td className="px-4 py-3 text-muted">{company.domain ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">{company.industry ?? '—'}</td>
                    <td className="px-4 py-3 text-muted">
                      {company.employee_count === null
                        ? '—'
                        : company.employee_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <CompanyPeople
                        companyId={company.id}
                        companyName={company.name ?? 'this company'}
                        count={counts.get(company.id) ?? 0}
                        preview={people.get(company.id) ?? []}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            {page > 1 ? (
              <Link
                href={`/crm/companies?page=${page - 1}`}
                className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            {/* A full page means there is probably another; no count query needed. */}
            {rows.length === PAGE_SIZE ? (
              <Link
                href={`/crm/companies?page=${page + 1}`}
                className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
              >
                Next
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
