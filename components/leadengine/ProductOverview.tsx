/**
 * ⚠️ CATEGORIES, NOT A PROMISE PER LEAD. Availability depends on the company
 * and what is public. A cell we could not fill says so, with a reason.
 */
const RESEARCH = [
  ['Company profile', 'Domain, industry, headcount, headquarters, description and specialties'],
  ['Registries & filings', 'Companies House, SEC EDGAR and GLEIF: status, type, incorporation, officers, filing history'],
  ['Funding', 'Round, amount, date and named investors'],
  ['Technology', 'Stack detected from the public site, plus churn and website signals'],
  ['Momentum', 'Hiring signals, recent news, product launches, employee growth, competitors'],
  ['Public contacts', 'Work email and phone where a company or person has published them'],
  ['Reviews & presence', 'Review platforms, ratings, counts and public GitHub activity'],
  ['Public funding', 'US federal award totals, counts and types where they exist'],
]

const CAPTURED = [
  ['Full name', 'Exactly as shown on the profile'],
  ['LinkedIn profile', 'A direct link to the person'],
  ['Job title', 'Their actual role, not their tenure'],
  ['Company', 'Plus a company link where one exists'],
  ['Location', 'City, region, country'],
  ['Summary', 'The short bio line under their name'],
  ['Time in role', 'How long in this position'],
  ['Time at company', 'How long at this employer'],
]

/**
 * Shared between the Lead Engine homepage and the standalone `/product` page.
 *
 * No id here: `DashboardPreview` already owns `#product-preview`, and both
 * render on the homepage. Two elements with one id is a duplicate the browser
 * resolves by taking the first — the nav links to `/product` instead.
 */
export function ProductOverview() {
  return (
    <section className="bg-paper px-4 py-20 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <div className="max-w-2xl">
          <p className="text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">
            The intelligence
          </p>
          <h2 className="mt-4 text-4xl font-bold uppercase leading-tight tracking-tight sm:text-5xl">
            60+ researched fields, each with a source
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted sm:text-lg">
            Choose the columns you actually need. Outlio gathers them from
            public sources and records where each one came from, so any value
            can be checked in one click.
          </p>
        </div>

        <dl className="mt-12 grid gap-x-10 gap-y-6 sm:grid-cols-2">
          {RESEARCH.map(([name, note]) => (
            <div key={name} className="border-t border-border pt-4">
              <dt className="text-base font-semibold text-ink">{name}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted">{note}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 border-t border-border pt-10">
          <h3 className="text-xl font-bold tracking-tight">
            Plus everything captured from the page itself
          </h3>
          <dl className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {CAPTURED.map(([name, note]) => (
              <div key={name} className="flex flex-wrap items-baseline gap-x-2">
                <dt className="text-sm font-semibold text-ink">{name}</dt>
                <dd className="text-sm text-muted">— {note}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="clay mt-10 max-w-2xl p-5 text-sm leading-relaxed text-muted">
          <strong className="font-semibold text-ink">Sales Navigator only.</strong>{' '}
          Lead Engine reads saved <em>Sales Navigator lead search-results</em>{' '}
          pages. A regular linkedin.com search page, a company page, or a file
          from anywhere else will be rejected rather than silently mis-parsed.
        </p>
      </div>
    </section>
  )
}
