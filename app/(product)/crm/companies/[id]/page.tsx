import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { MoreDetails } from '@/components/crm/MoreDetails'
import { ValueProvenance } from '@/components/crm/ValueProvenance'
import { companyDetails, companyWebsite, linkedInSlug } from '@/lib/crm/company-details'
import { companyCitations, safeSourceUrl, type Provenance } from '@/lib/crm/provenance'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Company | Outlio',
  robots: { index: false, follow: false },
}

/**
 * A company's working view — R2.
 *
 * ⚠️ A COMPANY IS NOT A CONTACT. The brief is explicit that the two must stay
 * distinct objects: a contact is a human, a company is an organisation, and a
 * contact may display its company without becoming it. This page exists so the
 * account can be worked as an account — every person at it, every deal against
 * it — rather than only ever being a column on a person's row.
 */
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireWorkspace()
  const { id } = await params
  const db = createAdminClient()

  // Scoped by workspace in code — the service role bypasses RLS.
  const { data: company } = await db
    .from('crm_companies')
    // `source_company_id` is the structural link to research evidence (Phase 3).
    .select('id, name, domain, industry, employee_count, headquarters, linkedin_url, owner_user_id, source, source_company_id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!company) notFound()

  /*
   * ⚠️ THE SAME OWNER RULE AS EVERY OTHER CRM SURFACE. A setter restricted to
   * assigned data must not reach another person's account by typing its id
   * into the address bar — hiding the row from a list is not access control.
   */
  const scopedToSelf = dataScope(ctx.role) === 'assigned'
  if (scopedToSelf && company.owner_user_id !== ctx.userId) notFound()

  const [{ data: contacts }, { data: opportunities }] = await Promise.all([
    db
      .from('crm_contacts')
      .select('id, full_name, job_title, owner_user_id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('primary_company_id', id)
      .is('deleted_at', null)
      .order('full_name')
      .limit(100),
    db
      .from('crm_opportunities')
      .select('id, title, value_amount, currency, status')
      .eq('workspace_id', ctx.workspace.id)
      .eq('company_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const people = (contacts ?? []).filter((c) => !scopedToSelf || c.owner_user_id === ctx.userId)
  const deals = opportunities ?? []

  /*
   * ⚠️ 952 OF 1,000 SAMPLED EVIDENCE ROWS IN PRODUCTION ARE COMPANY-LEVEL, and
   * they cover exactly these fields — industry, employee_count, headquarters.
   * Until now none of it was reachable from this page.
   */
  const citations = await companyCitations(ctx.scope, {
    sourceCompanyId: company.source_company_id,
    source: company.source,
    values: {
      industry: company.industry,
      employee_count: company.employee_count,
      headquarters: company.headquarters,
    },
  })

  /*
   * The micro detail — funding, tech stack, socials, news. Read separately from
   * the facts above because these have no column to compare against: they are
   * evidence rows and nothing else, which is precisely why they were invisible.
   */
  const details = await companyDetails(ctx.scope, company.source_company_id)

  const facts: {
    label: string
    value: string | null
    /*
     * ⚠️ WHAT IS SHOWN, WHEN THE STORED VALUE IS TOO LONG TO SHOW. A full
     * LinkedIn URL is ~50 characters and this is a four-column grid: rendered
     * raw it wrapped out of its cell and overlapped the Industry column, so two
     * facts became one unreadable one. `value` still decides "Not recorded";
     * `display` only decides what the reader sees.
     */
    display?: string
    href?: string | null
    provenance?: Provenance
  }[] = [
    /*
     * ⚠️ A DOMAIN IS THE THING PEOPLE CLICK. It sat here as plain text while
     * being the fastest way to answer "who are these people" — and the stored
     * value is a bare host, so the scheme is added HERE for the link only. The
     * displayed text stays exactly what we observed.
     */
    { label: 'Website', value: company.domain, href: companyWebsite(company.domain) },
    {
      label: 'LinkedIn',
      value: company.linkedin_url,
      // The slug carries the identity; the rest of the URL is boilerplate.
      display: linkedInSlug(company.linkedin_url) ?? 'Company page',
      href: safeSourceUrl(company.linkedin_url),
    },
    { label: 'Industry', value: company.industry, provenance: citations.industry },
    {
      label: 'Employees',
      value: company.employee_count ? String(company.employee_count) : null,
      provenance: citations.employee_count,
    },
    { label: 'Location', value: company.headquarters, provenance: citations.headquarters },
  ]

  return (
    <div className="space-y-4">
      <div>
        <Link href="/crm/companies" className="text-xs text-muted hover:text-ink">
          ← Companies
        </Link>
        <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">
          {company.name ?? 'Unnamed company'}
        </h2>
      </div>

      <section className="clay p-4">
        <dl className="grid gap-3 sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-xs text-muted">{fact.label}</dt>
              {/*
                ⚠️ "Not recorded", never a blank or a zero. A missing value and
                a known-empty one are different facts, and the constitution
                forbids inventing the difference away.
              */}
              <dd className={fact.value ? 'text-sm text-ink' : 'text-sm text-muted'}>
                {fact.value === null ? (
                  'Not recorded'
                ) : fact.href ? (
                  <a
                    href={fact.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    // `break-words`: a long domain must wrap inside its own
                    // cell rather than spilling across the one beside it.
                    className="break-words underline decoration-border decoration-dotted underline-offset-2 transition-colors duration-150 hover:text-accent hover:decoration-accent"
                    title={fact.value}
                  >
                    {fact.display ?? fact.value}
                  </a>
                ) : (
                  /*
                    ⚠️ A VALUE WITH NO USABLE LINK IS STILL SHOWN. `companyWebsite`
                    returns null for anything it cannot turn into an http(s) URL,
                    and dropping the text along with the link would hide a fact we
                    hold because we could not make it clickable.
                  */
                  <span className="break-words">{fact.value}</span>
                )}
              </dd>
              {/*
                ⚠️ ONLY ON A VALUE THAT EXISTS. "Not recorded" already says
                everything there is to say; adding "added by hand" underneath it
                would describe the provenance of nothing.
              */}
              {fact.value && fact.provenance ? (
                <dd className="mt-0.5">
                  <ValueProvenance provenance={fact.provenance} />
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      </section>

      {/*
        ⚠️ BELOW THE FACTS, COLLAPSED. Funding, tech stack, news and socials are
        the detail somebody goes looking for once — not the thing they opened
        this page to read. It renders nothing at all when there is nothing to
        show, so a company nobody has researched looks exactly as it did before.
      */}
      <MoreDetails details={details} />

      <section className="clay p-4">
        <h3 className="text-sm font-semibold text-ink">
          People {people.length > 0 ? `(${people.length})` : ''}
        </h3>

        {people.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            {scopedToSelf
              ? 'Nobody here is assigned to you yet.'
              : 'No contacts are linked to this company yet. They are linked automatically when their email domain matches.'}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {people.map((person) => (
              <li key={person.id} className="py-2">
                <Link
                  href={`/crm/contacts/${person.id}`}
                  className="text-sm font-medium text-ink hover:underline"
                >
                  {person.full_name ?? 'Unnamed contact'}
                </Link>
                {person.job_title ? (
                  <span className="ml-2 text-xs text-muted">{person.job_title}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="clay p-4">
        <h3 className="text-sm font-semibold text-ink">Deals</h3>

        {deals.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No deals against this company yet. Create one from the pipeline or from a
            contact here.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {deals.map((deal) => (
              <li key={deal.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-sm text-ink">{deal.title}</span>
                <span className="text-xs text-muted">
                  {/* Blank value means unknown, so it says so instead of showing 0. */}
                  {/*
                    ⚠️ Intl WITH THE CURRENCY, not the code glued to a number.
                    `USD 1,200` is a string; `$1,200.00` is a formatted amount,
                    and the difference shows the moment a workspace sells in
                    anything other than dollars.
                  */}
                  {deal.value_amount === null
                    ? 'Value not set'
                    : new Intl.NumberFormat(undefined, {
                        style: 'currency',
                        currency: deal.currency ?? 'USD',
                      }).format(Number(deal.value_amount))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
