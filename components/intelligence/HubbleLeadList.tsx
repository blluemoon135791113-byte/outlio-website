'use client'

/**
 * The Hubble lead list.
 *
 * One row per lead: the person on the left, their company in the middle, what
 * the company does on the right.
 *
 * ⚠️ TWO OF THESE COLUMNS ARE RESEARCHED, NOT EXTRACTED. A saved Sales
 * Navigator page carries a name, a role, a company and the PERSON's location.
 * The company's own location (`headquarters`) and its description
 * (`company_description`) only exist after Hubble has researched them, so those
 * cells say so rather than sitting blank — an empty cell reads as "this company
 * has no description", which is a different claim entirely.
 *
 * No entrance animation. CLAUDE.md forbids them on product lists.
 */
import { CompanyAvatar, PersonAvatar } from '@/components/intelligence/Avatar'

export type HubbleLead = {
  id: string
  fullName: string | null
  jobTitle: string | null
  companyName: string | null
  companyDomain: string | null
  /** The company's HQ when researched, else the person's own location. */
  companyLocation: string | null
  /** True when `companyLocation` is the person's, not the company's. */
  locationIsPersonal: boolean
  description: string | null
}

export function HubbleLeadList({
  leads,
  loading,
  onOpenLead,
  emptyHint,
  fill = false,
}: {
  leads: HubbleLead[]
  loading: boolean
  onOpenLead: (lead: HubbleLead) => void
  emptyHint: string
  /** Match the result panel's height instead of ending at the last row. */
  fill?: boolean
}) {
  if (loading) {
    return (
      <div className="clay p-4">
        {/* A fixed number of placeholders, sized like real rows, so the list
            does not jump when the data lands. */}
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-b border-clay-sunken px-2 py-4 last:border-0"
          >
            <span className="h-11 w-11 shrink-0 rounded-full bg-clay-sunken" />
            <span className="h-3 w-40 rounded-full bg-clay-sunken" />
            <span className="ml-auto h-3 w-56 rounded-full bg-clay-sunken" />
          </div>
        ))}
        <span className="sr-only" aria-live="polite">
          Loading leads
        </span>
      </div>
    )
  }

  if (leads.length === 0) {
    return (
      <div className="clay px-6 py-16 text-center">
        <p className="text-sm font-medium text-ink">No leads to show</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{emptyHint}</p>
      </div>
    )
  }

  return (
    <ul
      /* `data-lenis-prevent`: Lenis owns the page scroll and would swallow this
         container's own once the list is tall enough to need one. */
      data-lenis-prevent
      className={`clay divide-y divide-clay-sunken overflow-hidden ${
        // The row sets the height; the list just fills it and scrolls.
        fill ? 'h-full overflow-y-auto' : ''
      }`}
    >
      {leads.map((lead) => (
        <li key={lead.id}>
          <button
            type="button"
            onClick={() => onOpenLead(lead)}
            className="clay-interactive grid w-full cursor-pointer grid-cols-[minmax(0,1fr)] items-center gap-4 px-5 py-4 text-left sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]"
          >
            {/* Person */}
            <span className="flex min-w-0 items-center gap-3">
              <PersonAvatar name={lead.fullName} />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium text-ink">
                  {lead.fullName ?? 'Unnamed lead'}
                </span>
                <span className="block truncate text-sm text-muted">
                  {lead.jobTitle ?? 'Role not listed'}
                </span>
              </span>
            </span>

            {/* Company */}
            <span className="flex min-w-0 items-center gap-3">
              <CompanyAvatar name={lead.companyName} domain={lead.companyDomain} />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium text-ink">
                  {lead.companyName ?? 'Company not listed'}
                </span>
                <span className="block truncate text-sm text-muted">
                  {lead.companyLocation ? (
                    <>
                      {lead.companyLocation}
                      {/*
                        Labelled, because a seller filtering on "companies in
                        Austin" must not be shown a person who lives in Austin
                        and works for a company in Berlin.
                      */}
                      {lead.locationIsPersonal ? (
                        <span className="text-muted/70"> · lead's location</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted/60">Location unknown</span>
                  )}
                </span>
              </span>
            </span>

            {/* What they do */}
            <span className="hidden min-w-0 text-sm leading-snug text-muted sm:block">
              {lead.description ?? (
                <span className="text-muted/60">Not researched yet — ask Hubble above</span>
              )}
            </span>

            <span aria-hidden className="hidden justify-self-end text-muted sm:block">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
