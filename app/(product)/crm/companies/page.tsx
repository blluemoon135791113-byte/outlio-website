import type { Metadata } from 'next'
import Link from 'next/link'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can, dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Companies | Outlio',
  robots: { index: false, follow: false },
}

const PAGE_SIZE = 25

/**
 * Companies — M9, the route `CrmNav` has named since M2.
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
  const ctx = await requireWorkspace()

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
    .range(from, from + PAGE_SIZE - 1)

  if (scopedToSelf) query = query.eq('owner_user_id', ctx.userId)

  const { data: companies } = await query

  const rows = companies ?? []
  const counts = new Map<string, number>()

  if (rows.length > 0) {
    const { data: links } = await db
      .from('crm_contacts')
      .select('primary_company_id')
      .eq('workspace_id', ctx.workspace.id)
      .is('deleted_at', null)
      .in('primary_company_id', rows.map((r) => r.id))

    for (const link of links ?? []) {
      if (!link.primary_company_id) continue
      counts.set(link.primary_company_id, (counts.get(link.primary_company_id) ?? 0) + 1)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">Companies</h2>
        <p className="mt-0.5 text-sm text-muted">
          {scopedToSelf
            ? 'The companies you own, matched on registrable domain.'
            : 'Created automatically from the people you bring in, matched on registrable domain.'}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="clay p-10 text-center">
          <p className="text-sm font-medium text-ink">No companies yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
            A company appears here as soon as a contact arrives with one — nothing to set up.
          </p>
          <Link
            href="/crm/contacts"
            className="mt-3 inline-block rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-cream transition-colors duration-150 hover:opacity-90"
          >
            Go to contacts
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
                  <th scope="col" className="px-4 py-3 font-semibold">People</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((company) => (
                  <tr key={company.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">
                      {company.name ?? 'Unnamed company'}
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
                    <td className="px-4 py-3 text-muted">{counts.get(company.id) ?? 0}</td>
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
