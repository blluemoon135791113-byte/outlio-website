'use client'

/**
 * The intelligence console (spec §30–§33).
 *
 * The whole interaction is: ask a question → see what it will cost → research →
 * a table of only the columns you asked for.
 *
 * Two things this screen must never do:
 *
 *  1. **Start an expensive job by accident.** The scope is an explicit choice
 *     and the estimate is shown before anything runs (spec §31).
 *  2. **Show a blank cell that could mean two things.** Every researched cell
 *     is `known` with a source or `Unknown` with a reason. "Does not use
 *     HubSpot" and "we could not find out" look different (spec §49).
 *
 * No entrance animations — CLAUDE.md forbids them on product tables.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Cell =
  | { state: 'known'; value: unknown; sourceUrl: string | null; sourceProvider: string }
  | { state: 'unknown' }

type Row = {
  leadId: string
  personName: string | null
  jobTitle: string | null
  companyName: string | null
  companyDomain: string | null
  fields: Record<string, Cell>
  qualification: {
    score: number
    qualified: boolean
    disqualifiedBy: string | null
    unknownCount: number
    reasons: string[]
  } | null
}

type RunResults = {
  runId: string
  status: string
  queryText: string
  columns: string[]
  rows: Row[]
  truncated: boolean
  metadata: {
    leadsEvaluated: number
    companiesResearched: number
    qualified: number | null
    cachedResultsUsed: number
    externalCalls: number
    durationMs: number | null
  }
  clarification: { questions: Array<{ id: string; question: string; options: string[] }> } | null
  error: string | null
}

type ScopeChoice = 'all_leads' | 'extraction_job'

export type IntelligenceConsoleProps = {
  totalLeads: number
  totalCompanies: number
  recentJobs: Array<{ id: string; label: string; leadCount: number }>
  profiles: Array<{ id: string; name: string }>
}

const EXAMPLES = [
  'Which of these companies use Shopify?',
  'Find companies that recently announced funding',
  'Which companies are hiring SDRs right now?',
  'What industry and how big is each company?',
]

/** Field key → column header. Anything unmapped falls back to the key. */
const COLUMN_LABELS: Record<string, string> = {
  company_domain: 'Website',
  employee_count: 'Employees',
  industry: 'Industry',
  headquarters: 'HQ',
  company_description: 'Description',
  business_model: 'Model',
  revenue_estimate: 'Revenue',
  company_number: 'Company number',
  company_status: 'Legal status',
  company_type: 'Company type',
  jurisdiction: 'Jurisdiction',
  incorporation_date: 'Incorporated',
  sic_codes: 'SIC codes',
  registered_office: 'Registered office',
  accounts_overdue: 'Accounts overdue',
  confirmation_statement_overdue: 'Statement overdue',
  insolvency_history: 'Insolvency history',
  funding_round: 'Round',
  funding_amount: 'Amount',
  funding_currency: 'Currency',
  funding_date: 'Announced',
  funding_investors: 'Investors',
  tech_stack: 'Technology',
  product_launches: 'Launches',
  recent_news: 'News',
  hiring_signals: 'Hiring',
  competitors: 'Competitors',
  website_signals: 'Website signals',
  pricing_signals: 'Pricing',
  review_presence: 'Reviews',
  review_rating: 'Rating',
  review_count: 'Review count',
  github_presence: 'GitHub',
  work_email: 'Email',
  email_status: 'Email status',
  mobile_phone: 'Phone',
  phone_status: 'Phone status',
}

function label(field: string): string {
  return COLUMN_LABELS[field] ?? field.replace(/_/g, ' ')
}

/** Renders a researched value compactly without inventing precision. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'

  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>

    if ('value' in record) {
      if (Array.isArray(record.value)) return record.value.map(String).join(', ')
      if (typeof record.value === 'boolean') return record.value ? 'Yes' : 'No'
      if (record.value !== null && record.value !== undefined) return String(record.value)
    }
    if (typeof record.count === 'number') return record.count.toLocaleString()
    if (typeof record.domain === 'string') return record.domain
    if (typeof record.industry === 'string') return record.industry
    if (typeof record.headquarters === 'string') return record.headquarters
    if (typeof record.round === 'string') return record.round
    if (typeof record.amount === 'number') {
      const currency = typeof record.currency === 'string' ? record.currency : ''
      return `${currency} ${record.amount.toLocaleString()}`.trim()
    }
    if (Array.isArray(record.detected)) {
      return record.detected
        .map((item) =>
          item && typeof item === 'object' && 'name' in item
            ? String((item as { name: unknown }).name)
            : String(item),
        )
        .join(', ')
    }
    if (record.hiring === true) {
      const roles = Array.isArray(record.roles) ? record.roles : []
      return roles.length > 0 ? `Yes — ${roles.join(', ')}` : 'Yes'
    }
    if (typeof record.articleCount === 'number') {
      return `${record.articleCount} article${record.articleCount === 1 ? '' : 's'}`
    }
    if (Array.isArray(record.investors)) return record.investors.join(', ')
    if (typeof record.announcedAt === 'string') return record.announcedAt.slice(0, 10)

    const first = Object.values(record)[0]
    return first === undefined ? '—' : String(first)
  }

  return String(value)
}

export function IntelligenceConsole({
  totalLeads,
  totalCompanies,
  recentJobs,
  profiles,
}: IntelligenceConsoleProps) {
  const [question, setQuestion] = useState('')
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>('all_leads')
  const [jobId, setJobId] = useState(recentJobs[0]?.id ?? '')
  const [profileId, setProfileId] = useState('')

  const [phase, setPhase] = useState<'idle' | 'planning' | 'running' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [results, setResults] = useState<RunResults | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [])

  const scopeBody = useCallback(() => {
    return scopeChoice === 'extraction_job' && jobId
      ? { type: 'extraction_job' as const, extractionJobId: jobId }
      : { type: 'all_leads' as const }
  }, [scopeChoice, jobId])

  const poll = useCallback((runId: string) => {
    const tick = async () => {
      try {
        const response = await fetch(`/api/intelligence/runs/${runId}`, { cache: 'no-store' })
        if (!response.ok) {
          setPhase('error')
          setMessage('That research run could not be loaded.')
          return
        }

        const data = (await response.json()) as RunResults
        setResults(data)

        if (data.status === 'completed' || data.status === 'partially_complete') {
          setPhase('done')
          return
        }
        if (data.status === 'failed' || data.status === 'cancelled') {
          setPhase('error')
          setMessage(data.error ?? 'The research run did not finish.')
          return
        }
        if (data.status === 'waiting_for_clarification') {
          setPhase('idle')
          return
        }

        pollRef.current = setTimeout(tick, 2500)
      } catch {
        setPhase('error')
        setMessage('Lost connection while research was running.')
      }
    }

    pollRef.current = setTimeout(tick, 1500)
  }, [])

  async function ask() {
    if (question.trim().length < 3) return

    setPhase('planning')
    setMessage(null)
    setResults(null)
    setAnswers({})

    try {
      const response = await fetch('/api/intelligence/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: question.trim(),
          scope: scopeBody(),
          qualificationProfileId: profileId || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setPhase('error')
        setMessage(data?.error?.message ?? data?.reason ?? 'That question could not be researched.')
        return
      }

      if (data.status === 'refused') {
        setPhase('error')
        setMessage(data.reason)
        return
      }

      if (data.status === 'clarification_required') {
        setResults({
          runId: data.researchRunId,
          status: 'waiting_for_clarification',
          queryText: question,
          columns: [],
          rows: [],
          truncated: false,
          metadata: {
            leadsEvaluated: data.leadCount ?? 0,
            companiesResearched: data.companyCount ?? 0,
            qualified: null,
            cachedResultsUsed: 0,
            externalCalls: 0,
            durationMs: null,
          },
          clarification: { questions: data.questions ?? [] },
          error: null,
        })
        setPhase('idle')
        return
      }

      setPhase('running')
      poll(data.researchRunId)
    } catch {
      setPhase('error')
      setMessage('Could not reach Outlio. Check your connection and try again.')
    }
  }

  async function submitAnswers(runId: string) {
    setPhase('running')
    try {
      const response = await fetch('/api/intelligence/clarify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ researchRunId: runId, answers }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setPhase('error')
        setMessage(data?.error?.message ?? 'That answer could not be saved.')
        return
      }

      poll(runId)
    } catch {
      setPhase('error')
      setMessage('Could not reach Outlio. Check your connection and try again.')
    }
  }

  const scopeLeads = scopeChoice === 'all_leads'
    ? totalLeads
    : (recentJobs.find((job) => job.id === jobId)?.leadCount ?? 0)

  const busy = phase === 'planning' || phase === 'running'

  return (
    <div className="space-y-5">
      <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
        <label htmlFor="intelligence-question" className="text-sm font-semibold text-ink">
          Ask Outlio about these leads
        </label>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="intelligence-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy) ask()
            }}
            placeholder="Ask Outlio anything about these leads…"
            disabled={busy}
            className="h-11 flex-1 rounded-[var(--radius-md)] border border-border bg-paper px-3.5 text-sm text-ink outline-none transition-[border-color] duration-150 placeholder:text-muted focus:border-accent/50 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={ask}
            disabled={busy || question.trim().length < 3}
            aria-busy={busy}
            className="product-gradient inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] px-5 text-sm font-semibold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-95 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'planning' ? 'Planning…' : phase === 'running' ? 'Researching…' : 'Research'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuestion(example)}
              disabled={busy}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors duration-150 hover:border-accent/40 hover:text-ink disabled:opacity-60"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <div>
            <label htmlFor="scope" className="text-xs font-medium text-muted">
              Search
            </label>
            <select
              id="scope"
              value={scopeChoice}
              onChange={(event) => setScopeChoice(event.target.value as ScopeChoice)}
              disabled={busy}
              className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-border bg-paper px-2 text-sm text-ink disabled:opacity-60"
            >
              <option value="all_leads">All leads</option>
              {recentJobs.length > 0 ? <option value="extraction_job">One extraction</option> : null}
            </select>
          </div>

          {scopeChoice === 'extraction_job' ? (
            <div>
              <label htmlFor="job" className="text-xs font-medium text-muted">
                Extraction
              </label>
              <select
                id="job"
                value={jobId}
                onChange={(event) => setJobId(event.target.value)}
                disabled={busy}
                className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-border bg-paper px-2 text-sm text-ink disabled:opacity-60"
              >
                {recentJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label htmlFor="profile" className="text-xs font-medium text-muted">
              Score against
            </label>
            <select
              id="profile"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              disabled={busy}
              className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-border bg-paper px-2 text-sm text-ink disabled:opacity-60"
            >
              <option value="">No scoring</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            {/*
              An empty dropdown with no way to fill it is a dead end. Point at
              the screen that fixes it rather than leaving the control inert.
            */}
            {profiles.length === 0 ? (
              <a
                href="/dashboard/intelligence/profiles"
                className="mt-1 inline-block text-[11px] text-accent underline-offset-2 hover:underline"
              >
                Create an ICP profile
              </a>
            ) : null}
          </div>
        </div>

        {/*
          The pre-flight number (spec §31). Companies is the figure that matters:
          it is what actually gets researched, and therefore what it costs.
        */}
        <p className="mt-3 text-xs text-muted">
          This will evaluate <strong className="text-ink">{scopeLeads.toLocaleString()}</strong> leads
          {scopeChoice === 'all_leads' ? (
            <>
              {' '}across <strong className="text-ink">{totalCompanies.toLocaleString()}</strong> companies
            </>
          ) : null}
          . Companies already researched are reused and cost nothing.
        </p>
      </section>

      {message ? (
        <p
          role="status"
          className={
            phase === 'error'
              ? 'rounded-[var(--radius-lg)] border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger'
              : 'text-sm text-muted'
          }
        >
          {message}
        </p>
      ) : null}

      {results?.clarification && results.clarification.questions.length > 0 ? (
        <section className="rounded-[var(--radius-xl)] border border-accent/20 bg-accent-soft/40 p-5">
          <h2 className="text-sm font-semibold text-ink">One quick question first</h2>
          <p className="mt-1 text-xs text-muted">
            Nothing has been researched yet — answering keeps the results relevant.
          </p>

          <div className="mt-4 space-y-4">
            {results.clarification.questions.map((item) => (
              <div key={item.id}>
                <p className="text-sm text-ink">{item.question}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: option }))}
                      className={
                        answers[item.id] === option
                          ? 'rounded-full border border-accent bg-accent px-3 py-1 text-xs font-semibold text-white'
                          : 'rounded-full border border-border bg-panel px-3 py-1 text-xs text-ink hover:border-accent/40'
                      }
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => submitAnswers(results.runId)}
            disabled={
              busy ||
              results.clarification.questions.some((item) => !answers[item.id])
            }
            className="product-gradient mt-4 inline-flex h-9 items-center rounded-[var(--radius-md)] px-4 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
          >
            Continue
          </button>
        </section>
      ) : null}

      {phase === 'running' ? (
        <section
          role="status"
          className="rounded-[var(--radius-xl)] border border-border bg-panel p-8 text-center"
        >
          <p className="text-sm font-medium text-ink">Researching…</p>
          <p className="mt-1 text-xs text-muted">
            Companies are researched once each. This keeps running if you close the tab.
          </p>
        </section>
      ) : null}

      {phase === 'done' && results ? <Results results={results} /> : null}
    </div>
  )
}

function Results({ results }: { results: RunResults }) {
  const { metadata, columns, rows } = results

  if (rows.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-dashed border-border bg-surface-muted/40 p-10 text-center">
        <p className="text-sm font-medium text-ink">No leads matched that question.</p>
        <p className="mt-1 text-xs text-muted">
          Try widening the scope, or ask about a different attribute.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{metadata.leadsEvaluated.toLocaleString()} leads evaluated</span>
        <span>{metadata.companiesResearched.toLocaleString()} companies</span>
        {metadata.qualified !== null ? (
          <span className="font-semibold text-ink">{metadata.qualified.toLocaleString()} qualified</span>
        ) : null}
        <span>{metadata.cachedResultsUsed.toLocaleString()} reused from cache</span>
        <span>{metadata.externalCalls.toLocaleString()} external calls</span>
        {results.status === 'partially_complete' ? (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 font-medium text-warning">
            Some fields unknown
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-sm)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Company</th>
              {columns.map((field) => (
                <th key={field} scope="col" className="px-4 py-3 font-medium">
                  {label(field)}
                </th>
              ))}
              {rows.some((row) => row.qualification) ? (
                <th scope="col" className="px-4 py-3 font-medium">Fit</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.leadId} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{row.personName ?? '—'}</span>
                  {row.jobTitle ? (
                    <span className="block text-xs text-muted">{row.jobTitle}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-ink">
                  {row.companyName ?? '—'}
                  {row.companyDomain ? (
                    <span className="block text-xs text-muted">{row.companyDomain}</span>
                  ) : null}
                </td>

                {columns.map((field) => {
                  const cell = row.fields[field]
                  return (
                    <td key={field} className="px-4 py-3 align-top">
                      {!cell || cell.state === 'unknown' ? (
                        // NOT a blank. "Unknown" and "no" are different answers.
                        <span className="text-xs italic text-muted">Unknown</span>
                      ) : (
                        <>
                          <span className="text-ink">{renderValue(cell.value)}</span>
                          {cell.sourceUrl ? (
                            <a
                              href={cell.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="mt-0.5 block text-[11px] text-accent underline-offset-2 hover:underline"
                            >
                              source
                            </a>
                          ) : null}
                        </>
                      )}
                    </td>
                  )
                })}

                {rows.some((r) => r.qualification) ? (
                  <td className="px-4 py-3">
                    {row.qualification ? (
                      <>
                        <span
                          className={
                            row.qualification.qualified
                              ? 'font-semibold text-success'
                              : 'font-semibold text-muted'
                          }
                        >
                          {row.qualification.score}
                        </span>
                        {row.qualification.reasons.length > 0 ? (
                          <span className="block text-[11px] text-muted">
                            {row.qualification.reasons.join(' · ')}
                          </span>
                        ) : null}
                        {row.qualification.unknownCount > 0 ? (
                          <span className="block text-[11px] italic text-muted">
                            {row.qualification.unknownCount} unchecked
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs italic text-muted">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results.truncated ? (
        <p className="text-xs text-muted">
          Showing the first {rows.length.toLocaleString()} rows. Narrow the scope to see the rest.
        </p>
      ) : null}
    </section>
  )
}
