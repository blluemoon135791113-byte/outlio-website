import type { OutcomeCounts, SitesSummary } from '@/lib/admin/enrichment-sites'
import { SITES_WINDOW_DAYS } from '@/lib/admin/enrichment-sites'
import type { PageOutcome } from '@/lib/intelligence/observe'

/** What a page visit came to, in words an operator acts on. */
const OUTCOME_LABEL: Record<PageOutcome, string> = {
  read_contact: 'Contact on page',
  read_empty: 'Read, nothing',
  refused: 'Refused us',
  js_rendered: 'JavaScript only',
  blocked: 'Blocked by policy',
  unreachable: 'Unreachable',
  timeout: 'Timed out',
  not_html: 'Not a web page',
  too_large: 'Too large',
}

const ENGINE_OUTCOMES = ['hits', 'empty', 'failed', 'cooling_down', 'over_budget'] as const
const ENGINE_LABEL: Record<(typeof ENGINE_OUTCOMES)[number], string> = {
  hits: 'results',
  empty: 'empty',
  failed: 'failed',
  cooling_down: 'cooling',
  over_budget: 'over budget',
}

const PROVIDER_LABEL: Record<string, string> = {
  'company-contact': 'Company website',
  scout: 'Company team pages',
  'search-contact': 'Person search results',
  'search-company-contact': 'Other listings',
}

const PURPOSE_LABEL: Record<string, string> = {
  contact_email: 'Person email',
  contact_phone: 'Person phone',
  contact_domain_email: 'Person email at company domain',
  company_contact_offsite: 'Company contact in listings',
  domain_discovery: 'Company website',
  company_profile: 'Company profile',
  web_research: 'Web research',
  funding: 'Funding',
  other: 'Other',
}

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}

function Outcomes({ counts, total }: { counts: OutcomeCounts; total: number }) {
  const shown = (Object.keys(OUTCOME_LABEL) as PageOutcome[]).filter((outcome) => (counts[outcome] ?? 0) > 0)
  return (
    <span className="text-xs text-muted">
      {shown.map((outcome) => `${OUTCOME_LABEL[outcome]} ${percent(counts[outcome] ?? 0, total)}`).join(' · ')}
    </span>
  )
}

const panel = 'space-y-3 rounded-[var(--radius-xl)] border border-border bg-panel p-5'
const heading = 'text-lg font-semibold tracking-[-0.02em] text-ink'

/**
 * The sites enrichment read, what they gave, and why searches came back empty.
 * Hosts and counts only — see lib/admin/enrichment-sites.ts.
 */
export function EnrichmentSites({ summary }: { summary: SitesSummary | null }) {
  if (summary === null) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
        The sites report could not be loaded. Reload to try again; the server log has the reason.
      </p>
    )
  }
  if (summary.state === 'not_applied') {
    return (
      <p className="rounded-[var(--radius-lg)] border border-warning/30 bg-warning-soft p-4 text-sm text-ink">
        Sites and searches are recorded once migration <code>0159_enrichment_observability.sql</code> is
        applied in the Supabase SQL editor. Nothing is recorded until then.
      </p>
    )
  }
  if (summary.visits === 0 && summary.searches.length === 0) {
    return (
      <p className="rounded-[var(--radius-lg)] border border-border bg-panel p-4 text-sm text-muted">
        No pages read or searches made in the last {SITES_WINDOW_DAYS} days. The next upload fills this in.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <section className={panel}>
        <h2 className={heading}>Pages read — last {SITES_WINDOW_DAYS} days</h2>
        <p className="text-sm text-ink">
          {summary.visits} pages · <Outcomes counts={summary.byOutcome} total={summary.visits} />
        </p>
        {summary.truncated ? (
          <p className="text-xs text-muted">More rows than one read covers — counts show the newest 20,000.</p>
        ) : null}
        <ul className="space-y-1">
          {summary.byProvider.map((row) => (
            <li key={row.provider} className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="text-ink">{PROVIDER_LABEL[row.provider] ?? row.provider} <span className="tabular-nums text-muted">({row.visits})</span></span>
              <Outcomes counts={row.outcomes} total={row.visits} />
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={panel}>
          <h2 className={heading}>Sites read most</h2>
          <ul className="space-y-1">
            {summary.topSites.map((site) => (
              <li key={site.host} className="flex justify-between gap-3 text-sm">
                <span className="truncate text-ink">{site.host}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {site.visits} · {percent(site.outcomes.read_contact ?? 0, site.visits)} gave a contact
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={panel}>
          <h2 className={heading}>Sites refusing us</h2>
          {summary.refusingSites.length === 0 ? (
            <p className="text-sm text-muted">None refused a read.</p>
          ) : (
            <ul className="space-y-1">
              {summary.refusingSites.map((site) => (
                <li key={site.host} className="flex justify-between gap-3 text-sm">
                  <span className="truncate text-ink">{site.host}</span>
                  <span className="shrink-0 tabular-nums text-muted">{site.outcomes.refused} of {site.visits}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">A refusal or bot check is recorded and left alone — never worked around.</p>
        </section>
      </div>

      <section className={panel}>
        <h2 className={heading}>Searches — why they come back empty</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">For</th>
                <th className="py-1 pr-3 font-medium">Searches</th>
                <th className="py-1 pr-3 font-medium">Empty</th>
                <th className="py-1 pr-3 font-medium">From cache</th>
                <th className="py-1 font-medium">What each engine did</th>
              </tr>
            </thead>
            <tbody>
              {summary.searches.map((row) => (
                <tr key={row.purpose} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 text-ink">{PURPOSE_LABEL[row.purpose] ?? row.purpose}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{row.searches}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{percent(row.empty, row.searches)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{percent(row.cached, row.searches)}</td>
                  <td className="py-1.5 text-xs text-muted">
                    {Object.entries(row.engines).map(([engine, outcomes]) => (
                      <div key={engine}>
                        <span className="text-ink">{engine}</span>{' '}
                        {ENGINE_OUTCOMES.filter((outcome) => (outcomes[outcome] ?? 0) > 0)
                          .map((outcome) => `${ENGINE_LABEL[outcome]} ${outcomes[outcome]}`)
                          .join(' · ')}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={panel}>
        <h2 className={heading}>Where contacts came from</h2>
        {summary.valueSources.length === 0 ? (
          <p className="text-sm text-muted">No contacts stored in the last {SITES_WINDOW_DAYS} days.</p>
        ) : (
          <ul className="space-y-1">
            {summary.valueSources.map((source) => (
              <li key={source.host} className="flex justify-between gap-3 text-sm">
                <span className="truncate text-ink">{source.host}</span>
                <span className="shrink-0 tabular-nums text-muted">{source.values}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
