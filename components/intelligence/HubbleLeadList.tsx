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

export type HubbleSavedDetail = {
  id: string
  kind: 'fact' | 'answer'
  /**
   * The research field key (`industry`, `tech_stack`, …).
   *
   * Carried so a distribution bar can find the leads behind it. `label` is for
   * display and is not stable enough to match on — two fields can render the
   * same words.
   */
  field: string | null
  label: string
  value: string
  sourceUrl: string | null
  status: string | null
}

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
  researchStatus: 'verified' | 'corroborated' | 'estimated' | 'unknown' | null
  researchSourceCount: number
  workEmail: string | null
  emailStatus: string | null
  mobilePhone: string | null
  phoneStatus: string | null
  /** Captured from the saved page. Shown when present, omitted when not. */
  salesNavigatorUrl: string | null
  companyUrl: string | null
  personBlurb: string | null
  tenureInRole: string | null
  tenureInCompany: string | null
  savedDetails: HubbleSavedDetail[]
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
      /* Kept as a defensive marker if this component is ever reused on a
         smooth-scrolled page; dashboard routes themselves use native scroll. */
      data-lenis-prevent
      tabIndex={fill ? 0 : undefined}
      aria-label="Leads"
      className={`clay hubble-lead-ledger divide-y divide-clay-sunken overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/25 ${
        // The row sets the height; the list just fills it and scrolls.
        fill ? 'h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]' : ''
      }`}
    >
      {leads.map((lead) => (
        <li key={lead.id}>
          <button
            type="button"
            onClick={() => onOpenLead(lead)}
            className="clay-interactive hubble-lead-row grid w-full cursor-pointer grid-cols-[minmax(0,1fr)] items-center gap-4 px-5 py-4 text-left sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]"
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
                        <span className="text-muted"> · lead&apos;s location</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted">Location unknown</span>
                  )}
                </span>
              </span>
            </span>

            {/* What they do */}
            <span className="hidden min-w-0 text-sm leading-snug text-muted sm:block">
              {lead.description ?? (
                /*
                 * ⚠️ NO OPACITY ON MUTED TEXT. These carried `text-muted/75`
                 * and `/60`, which dropped them to roughly 3.5:1 and 3:1 — below
                 * AA at any size, and it would have undone the darker token
                 * exactly where the page is hardest to read.
                 *
                 * Compact, but three DISTINCT words survive: researched with
                 * sources, researched-but-unconfirmed, and never researched.
                 * Collapsing them is how "failure looks like empty" returns.
                 */
                lead.researchStatus ? (
                  <span className="text-muted">
                    {lead.researchStatus === 'unknown'
                      ? 'Saved · unconfirmed'
                      : `${lead.researchSourceCount} source${lead.researchSourceCount === 1 ? '' : 's'}`}
                  </span>
                ) : (
                  <span className="text-muted">Not researched</span>
                )
              )}
            </span>

            <span aria-hidden className="hidden justify-self-end text-muted sm:block">
              View
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
