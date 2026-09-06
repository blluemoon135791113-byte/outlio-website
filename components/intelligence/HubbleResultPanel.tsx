'use client'

/**
 * The generative strip.
 *
 * A tall panel on the right, like Notion AI's. It holds the answer while the
 * lead list stays visible on the left — the point of the layout is that you can
 * read a finding and see the leads it is about at the same time.
 *
 * ⚠️ THE PANEL SCROLLS; IT DOES NOT GROW. A run over 25 leads produces far more
 * than fits, and a panel that grows pushes the page height around and moves the
 * footer action out from under the cursor. Height is pinned to the viewport and
 * the body scrolls inside it.
 */
import { useState } from 'react'

import { renderCellValue } from '@/components/intelligence/render-value'
import {
  analyseRun,
  analysisCsvRows,
  coverageOf,
  type MacroAnalysis,
} from '@/lib/intelligence/aggregate'
import { CONTACT_FIELDS } from '@/lib/intelligence/analysis-scope'
import { toCsv } from '@/lib/export/sanitize'
import type { RunPhase, RunResults, RunSummary } from '@/components/intelligence/useResearchRun'

const CONTACT_RESULT_FIELDS: ReadonlySet<string> = new Set(
  [...CONTACT_FIELDS].filter((field) => field !== 'email_status' && field !== 'phone_status'),
)

export function HubbleResultPanel({
  phase,
  message,
  results,
  summary,
  summaryPending,
  merge,
  onEnrich,
  onClarify,
  onClose,
  columnLabel,
  onDrillDown,
}: {
  phase: RunPhase
  message: string | null
  results: RunResults | null
  summary: RunSummary | null
  summaryPending: boolean
  merge: { state: 'idle' | 'busy' | 'done'; summary: string | null }
  onEnrich: () => void
  onClarify: (answers: Record<string, string>) => void
  onClose: () => void
  columnLabel: (field: string) => string
  /** Filter the lead list to the rows behind one share. */
  onDrillDown?: (filter: { field: string; label: string }) => void
}) {
  const working = phase === 'planning' || phase === 'running'
  const [answers, setAnswers] = useState<Record<string, string>>({})

  return (
    <aside
      aria-label="Hubble results"
      /* Height comes from the grid row it shares with the lead list. */
      className="hubble-result-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-clay)]"
    >
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {working
              ? 'Hubble is working'
              : phase === 'error'
                ? 'Could not finish'
                : phase === 'clarifying'
                  ? 'One detail first'
                  : 'Result'}
          </p>
          {results?.queryText ? (
            <p className="mt-0.5 truncate text-xs text-muted" title={results.queryText}>
              {results.queryText}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close results"
          className="cursor-pointer shrink-0 rounded-full px-2 py-1 text-muted transition-colors duration-150 hover:text-ink"
        >
          ✕
        </button>
      </header>

      {/* Native overflow on product routes; the marker also keeps this safe if
          the panel is later reused inside a smooth-scrolled surface. */}
      <div
        tabIndex={0}
        aria-label="Research result details"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 outline-none [scrollbar-gutter:stable] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/20"
      >
        {working ? (
          <div role="status" className="space-y-2.5 py-2">
            <p className="text-sm text-muted">
              {phase === 'planning'
                ? 'Reading the question and deciding what to look up…'
                : 'Researching. Companies already known are reused and cost nothing.'}
            </p>
            {/* Placeholder lines, not a spinner: they show the shape of what is
                coming while the prompt status names the active phase. */}
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className="block h-3 rounded-full bg-clay-sunken" />
            ))}
            <p className="pt-1 text-xs text-muted">This keeps running if you close the tab.</p>
          </div>
        ) : null}

        {phase === 'error' && message ? (
          <p className="rounded-[var(--radius-lg)] bg-danger-soft px-3.5 py-3 text-sm text-danger">
            {message}
          </p>
        ) : null}

        {phase === 'clarifying' && results?.clarification?.questions.length ? (
          <div className="space-y-4">
            {/*
              ⚠️ NOTHING HAS BEEN QUEUED OR CHARGED YET. The clarification
              exists so a vague question does not spend money guessing, which
              is why the answers are pickable rather than merely displayed —
              an unanswerable question is a dead end, and a dead end here looks
              exactly like the product being broken.
            */}
            <p className="text-sm text-muted">{message ?? 'Pick an answer to continue.'}</p>

            {results.clarification.questions.map((question) => (
              <fieldset key={question.id}>
                <legend className="mb-2 text-sm font-medium text-ink">{question.question}</legend>

                <div className="flex flex-wrap gap-2">
                  {question.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() =>
                        setAnswers((current) => ({ ...current, [question.id]: option }))
                      }
                      aria-pressed={answers[question.id] === option}
                      className={`clay-interactive cursor-pointer rounded-[var(--radius-clay)] px-3.5 py-2 text-left text-xs ${
                        answers[question.id] === option
                          ? 'hubble-selected-option font-medium'
                          : 'bg-clay-sunken text-ink'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}

            <button
              type="button"
              onClick={() => onClarify(answers)}
              disabled={
                Object.keys(answers).length < results.clarification.questions.length
              }
              className="clay-interactive hubble-primary-action w-full cursor-pointer rounded-[var(--radius-clay)] px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {Object.keys(answers).length < results.clarification.questions.length
                ? 'Answer every question to continue'
                : 'Research this'}
            </button>
          </div>
        ) : null}

        {phase === 'done' && results ? (
          results.rows.length === 0 ? (
            <EmptyResearchResult results={results} columnLabel={columnLabel} />
          ) : (
            <div className="space-y-3">
              {/*
                ⚠️ THE FINDING COMES FIRST, AND IT IS PROSE.

                This panel used to open with four telemetry tiles — matches,
                companies checked, cache reuse, external calls — none of which
                the person asking the question wanted to know. Below them came
                every lead in the run, most reading "Not found". The few
                companies that HAD an answer were buried among them.

                A question about twenty companies is a question about what is
                true across them. That is a sentence.
              */}
              <SummaryBlock
                summary={summary}
                pending={summaryPending}
                rowCount={results.rows.length}
                hasKnownData={results.rows.some((row) =>
                  results.columns.some((field) => row.fields[field]?.state === 'known'),
                )}
              />

              {/*
               * ⚠️ THE ARITHMETIC, BENEATH THE PROSE.
               *
               * `SummaryBlock` is model-written and reads well; this is the
               * counted version of the same set, and the two answer to
               * different standards. If the prose and these numbers ever
               * disagree, THE NUMBERS ARE THE ONES THAT CAME FROM THE DATA.
               */}
              <MacroAnalysisPanel
                analysis={analyseRun(results.columns, results.rows)}
                onDrillDown={onDrillDown}
              />

              <ContactResults results={results} columnLabel={columnLabel} />

              {(() => {
                /*
                 * If EVERY cell failed because its providers were unavailable,
                 * say so once at the top. That is an operational problem — a
                 * quota or a rate limit — and it is not the same message as
                 * "these companies have no funding".
                 */
                const cells = results.rows.flatMap((row) =>
                  results.columns.map((field) => row.fields[field]),
                )
                const unavailable = cells.filter(
                  (cell) => cell?.state === 'unknown' && cell.reason === 'provider_unavailable',
                ).length

                if (unavailable > 0 && unavailable === cells.length) {
                  return (
                    <p className="rounded-[var(--radius-lg)] bg-danger-soft px-3 py-2 text-xs text-danger">
                      No source could be reached for this question — every provider was
                      unavailable, rate-limited or out of quota. Nothing here means these
                      companies lack the data; it means we could not look.
                    </p>
                  )
                }

                /*
                 * ⚠️ THE "some values could not be found" BANNER IS GONE.
                 *
                 * It stated, in a coloured box, exactly what the coverage line
                 * under the finding already says in plain words — and its
                 * promise that "each says why below" pointed at a per-lead
                 * list that no longer exists. Two statements of one fact, the
                 * louder of them now untrue.
                 */

                return null
              })()}

            </div>
          )
        ) : null}
      </div>

      {/*
        Enrichment lives in the footer, pinned outside the scroll area, so it
        stays reachable however long the answer is.
      */}
      {phase === 'done' && results && results.rows.length > 0 ? (
        <footer className="border-t border-clay-sunken px-5 py-3.5">
          {merge.summary ? (
            <p className="mb-2 text-xs text-muted">{merge.summary}</p>
          ) : (
            <p className="mb-2 text-xs text-muted">
              Add these columns to your leads so exports carry them.
            </p>
          )}

          <button
            type="button"
            onClick={onEnrich}
            disabled={merge.state !== 'idle'}
            aria-busy={merge.state === 'busy'}
            className={
              merge.state === 'done'
                ? 'w-full rounded-[var(--radius-lg)] bg-success-soft px-4 py-2.5 text-sm font-semibold text-success'
                : 'clay-interactive hubble-primary-action w-full cursor-pointer rounded-[var(--radius-clay)] px-4 py-2.5 text-sm font-semibold disabled:opacity-60'
            }
          >
            {merge.state === 'busy'
              ? 'Enriching…'
              : merge.state === 'done'
                ? 'List enriched'
                : 'Enrich List Data'}
          </button>
        </footer>
      ) : null}
    </aside>
  )
}

/**
 * The written finding, and one honest line about coverage.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ COVERAGE IS A NUMBER, NEVER A ROLL-CALL.                             ║
 * ║                                                                          ║
 * ║  "4 of 20 had a public record" tells the user everything the old wall of ║
 * ║  "Not found" cards told them, in nine words, without burying the four    ║
 * ║  that did. Naming the sixteen would be listing what we do not have —     ║
 * ║  which is exactly what the user cannot act on.                           ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
function SummaryBlock({
  summary,
  pending,
  rowCount,
  hasKnownData,
}: {
  summary: RunSummary | null
  pending: boolean
  rowCount: number
  hasKnownData: boolean
}) {
  if (pending) {
    return (
      <div role="status" className="space-y-1.5">
        {Array.from({ length: 2 }).map((_, index) => (
          <span key={index} className="hubble-shimmer block h-2.5 rounded-full" />
        ))}
        <span className="sr-only">Working out what these results show</span>
      </div>
    )
  }

  if (!summary) {
    /*
     * No finding: nothing was found, or no model is configured. Say it plainly
     * rather than leave a gap where a paragraph should be.
     */
    return (
      <p className="text-sm text-muted">
        {hasKnownData
          ? 'Sourced results are shown below; a narrative summary was unavailable.'
          : `Nothing was found for this question across the ${rowCount.toLocaleString()} record${rowCount === 1 ? '' : 's'} checked.`}
      </p>
    )
  }

  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        Narrative summary
      </p>
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{summary.text}</p>
      <p className="mt-1.5 text-xs text-muted">
        Based on {summary.withData} of {(summary.withData + summary.withoutData).toLocaleString()}{' '}
        record{summary.withData + summary.withoutData === 1 ? '' : 's'} with public evidence.
      </p>
    </div>
  )
}

/**
 * Contact questions are requests for actionable values, so show the matches.
 * Unknown rows remain summarized as coverage rather than becoming a wall of
 * "not found" cards.
 */
/**
 * How sure we are, shown only when there is something worth saying.
 *
 * ⚠️ SILENT ON THE ORDINARY CASE. Most cells come from one provider, and
 * stamping "1 source" on every one of them is noise that trains people to stop
 * reading. This speaks up for the two states that change a decision:
 * independent agreement, and disagreement — disagreement louder, because
 * acting on a contested value costs more than skipping a corroborated one.
 */
function Corroboration({
  cell,
}: {
  cell: { corroboratingProviders?: readonly string[]; conflictingProviders?: readonly string[]; confidence?: number; sourceProvider?: string }
}) {
  const agree = cell.corroboratingProviders ?? []
  const disagree = cell.conflictingProviders ?? []
  const pct = typeof cell.confidence === 'number' ? Math.round(cell.confidence * 100) : null

  if (disagree.length > 0) {
    return (
      <span
        className="mt-0.5 block text-[10px] text-warning"
        title={`${disagree.join(', ')} reported a different value${pct === null ? '' : ` — ${pct}% confidence`}`}
      >
        {disagree.length} disagree{disagree.length === 1 ? 's' : ''}
      </span>
    )
  }

  if (agree.length > 0) {
    return (
      <span
        className="mt-0.5 block text-[10px] text-success"
        title={`${[cell.sourceProvider, ...agree].filter(Boolean).join(', ')} independently agree${pct === null ? '' : ` — ${pct}% confidence`}`}
      >
        {agree.length + 1} sources agree
      </span>
    )
  }

  return null
}

/**
 * The macro answer, rendered.
 *
 * ⚠️ EVERY NUMBER COMES FROM `analyseRun`, WHICH IS PURE ARITHMETIC OVER THE
 * ROWS. No model writes a sentence about a customer's data here: a claim that
 * cannot be traced back to a count is the fabrication rule 4 forbids.
 */
function MacroAnalysisPanel({
  analysis,
  onDrillDown,
}: {
  analysis: MacroAnalysis
  onDrillDown?: (filter: { field: string; label: string }) => void
}) {
  if (analysis.distributions.length === 0 && analysis.numerics.length === 0) return null

  const coverage = coverageOf(analysis)

  /*
   * Built and revoked on click rather than held in state: an object URL kept
   * across renders is a leak, and the file is small enough that generating it
   * on demand is imperceptible.
   */
  const downloadCsv = () => {
    const csv = toCsv(analysisCsvRows(analysis), [
      { header: 'Field', value: (row) => row.field },
      { header: 'Value', value: (row) => row.value },
      { header: 'Count', value: (row) => row.count },
      { header: 'Share %', value: (row) => row.share_percent },
      { header: 'Known', value: (row) => row.known },
      { header: 'Entity', value: (row) => row.entity },
      { header: 'Total entities', value: (row) => row.total_entities },
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'outlio-analysis.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section aria-label="Set analysis" className="rounded-[var(--radius-lg)] bg-clay-sunken p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold text-ink">Counted analysis</h3>
          <p className="mt-0.5 text-[10px] text-muted">Calculated directly from the sourced rows.</p>
        </div>
        <div className="flex items-baseline gap-3">
          <p className="text-[11px] text-muted">
            {analysis.leads.toLocaleString()} leads · {analysis.companies.toLocaleString()} companies
          </p>
          <button
            type="button"
            onClick={downloadCsv}
            className="cursor-pointer text-[11px] font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
          >
            Export CSV
          </button>
        </div>
      </div>

      {analysis.headlines.length > 0 ? (
        <ul className="space-y-1">
          {analysis.headlines.map((line) => (
            <li
              key={line}
              className={`text-xs leading-5 ${
                line.startsWith('Thin evidence') ? 'text-warning' : 'text-ink'
              }`}
            >
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 space-y-3">
        {analysis.distributions.slice(0, 3).map((distribution) => (
          <div key={distribution.field}>
            <p className="flex items-baseline justify-between gap-2 text-[11px] text-muted">
              <span className="font-semibold uppercase tracking-[0.08em]">
                {distribution.field.replace(/_/g, ' ')}
              </span>
              {/* The base, next to the breakdown it produced. */}
              <span>
                {distribution.known} of {distribution.base}{' '}
                {distribution.entity === 'company' ? 'companies' : 'leads'} known
              </span>
            </p>
            <ul className="mt-1 space-y-1">
              {distribution.buckets.slice(0, 4).map((bucket) => (
                <li key={bucket.label}>
                  {/* Clicking a share filters the lead list to the rows behind
                      it — the point of a breakdown is getting to the records. */}
                  <button
                    type="button"
                    onClick={() => onDrillDown?.({ field: distribution.field, label: bucket.label })}
                    disabled={!onDrillDown}
                    className="flex w-full cursor-pointer items-center gap-2 rounded text-left text-xs enabled:hover:text-ink disabled:cursor-default"
                  >
                    <span
                      aria-hidden
                      className="h-1 rounded-full bg-accent"
                      style={{ width: `${Math.max(4, Math.round(bucket.share * 100))}%` }}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">{bucket.label}</span>
                    <span className="shrink-0 text-muted">{Math.round(bucket.share * 100)}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/*
         * ⚠️ COVERAGE, THINNEST FIRST.
         *
         * Sorted best-first this would be a reassurance exercise. The useful
         * question is what the analysis is WEAKEST on, because that is the
         * column a reader is most likely to over-trust.
         */}
        {coverage.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Data completeness
            </p>
            <ul className="mt-1 space-y-1">
              {coverage.slice(0, 5).map((entry) => (
                <li key={entry.field} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {entry.field.replace(/_/g, ' ')}
                  </span>
                  <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-clay-raised">
                    <span
                      aria-hidden
                      className={`block h-full rounded-full ${entry.thin ? 'bg-warning' : 'bg-accent'}`}
                      style={{ width: `${Math.round(entry.share * 100)}%` }}
                    />
                  </span>
                  <span className={`shrink-0 tabular-nums ${entry.thin ? 'text-warning' : 'text-muted'}`}>
                    {entry.known}/{entry.total}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {analysis.numerics.slice(0, 2).map((numeric) => (
          <p key={numeric.field} className="text-xs text-ink">
            <span className="font-semibold uppercase tracking-[0.08em] text-muted">
              {numeric.field.replace(/_/g, ' ')}
            </span>{' '}
            median {numeric.median.toLocaleString()}
            <span className="text-muted">
              {' '}· {numeric.min.toLocaleString()}–{numeric.max.toLocaleString()} ·{' '}
              {numeric.known} of {numeric.base}{' '}
              {numeric.entity === 'company' ? 'companies' : 'leads'} known
            </span>
          </p>
        ))}
      </div>
    </section>
  )
}

function ContactResults({
  results,
  columnLabel,
}: {
  results: RunResults
  columnLabel: (field: string) => string
}) {
  const fields = results.columns.filter((field) => CONTACT_RESULT_FIELDS.has(field))
  if (fields.length === 0) return null

  const matches = results.rows.flatMap((row) => {
    const values = fields.flatMap((field) => {
      const cell = row.fields[field]
      if (cell?.state !== 'known') return []
      const statusField =
        field === 'work_email'
          ? 'email_status'
          : field === 'mobile_phone'
            ? 'phone_status'
            : null
      const statusCell = statusField ? row.fields[statusField] : undefined
      return [{
        field,
        cell,
        status: statusCell?.state === 'known' ? renderCellValue(statusCell.value) : null,
      }]
    })
    return values.length > 0 ? [{ row, values }] : []
  })
  if (matches.length === 0) return null

  return (
    <section aria-label="Contacts found" className="rounded-[var(--radius-lg)] bg-clay-sunken p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold text-ink">Contacts found</h3>
        <span className="text-[11px] tabular-nums text-muted">{matches.length.toLocaleString()}</span>
      </div>
      <ul className="divide-y divide-border/70">
        {matches.map(({ row, values }) => (
          /* A company-only row has no lead id; `companyId` is its identity. */
          <li key={row.leadId ?? row.companyId} className="py-2 first:pt-0 last:pb-0">
            <p className="truncate text-xs font-semibold text-ink">
              {row.personName ?? 'Unnamed lead'}
            </p>
            {row.companyName ? (
              <p className="truncate text-[11px] text-muted">{row.companyName}</p>
            ) : null}
            <div className="mt-1 space-y-1">
              {values.map(({ field, cell, status }) => (
                <div key={field} className="flex items-start justify-between gap-3 text-xs">
                  <span className="shrink-0 text-muted">{columnLabel(field)}</span>
                  <span className="min-w-0 text-right">
                    {cell.sourceUrl ? (
                      <a
                        href={cell.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all font-medium text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
                      >
                        {renderCellValue(cell.value)}
                      </a>
                    ) : (
                      <span className="break-all font-medium text-ink">
                        {renderCellValue(cell.value)}
                      </span>
                    )}
                    <Corroboration cell={cell} />
                    {status ? (
                      <span className="mt-0.5 block text-[10px] font-medium text-muted">
                        {status}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="clay-sunken px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value.toLocaleString()}</dd>
    </div>
  )
}

function EmptyResearchResult({
  results,
  columnLabel,
}: {
  results: RunResults
  columnLabel: (field: string) => string
}) {
  const coverage = Object.entries(results.metadata.fieldCoverage ?? {})
  const missing = coverage
    .map(([field, counts]) => ({
      field,
      count:
        counts.notFound +
        counts.providerUnavailable +
        counts.noProvider +
        counts.noCompany,
      ...counts,
    }))
    .filter((item) => item.count > 0)

  const providerUnavailable = missing.some((item) => item.providerUnavailable > 0)
  const noProvider = missing.some((item) => item.noProvider > 0)
  const noCompany = Math.max(0, ...missing.map((item) => item.noCompany))
  const incomplete = results.status === 'partially_complete' || missing.length > 0

  let title = 'No verified matches'
  let explanation = `Hubble checked ${results.metadata.companiesResearched.toLocaleString()} companies and verified the requested information, but none met every filter.`

  if (incomplete) {
    if (providerUnavailable) {
      title = 'Research sources were unavailable'
      explanation =
        'Hubble could not reach every source needed to apply your filters. This is an incomplete search, not proof that no companies qualify.'
    } else if (noProvider) {
      title = 'A required data source is not configured'
      explanation =
        'Hubble has no connected source for part of this question, so it could not safely decide which companies match.'
    } else {
      title = 'Not enough verified information'
      explanation = `Hubble checked ${results.metadata.companiesResearched.toLocaleString()} companies, but the available sources did not provide every fact required by your filters. Unknown values are excluded rather than guessed.`
    }
  }

  return (
    <div className="space-y-4 py-2">
      <div className="hubble-empty-state rounded-[var(--radius-clay)] p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-clay-raised text-sm font-semibold text-ink shadow-[var(--shadow-button)]"
          >
            i
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{title}</p>
            <p className="mt-1 text-sm leading-6 text-muted">{explanation}</p>
          </div>
        </div>

        {missing.length > 0 ? (
          <div className="mt-4 border-t border-border/70 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              What was missing
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">
              {missing.map((item) => (
                <li key={item.field} className="flex items-baseline justify-between gap-4">
                  <span>{columnLabel(item.field)}</span>
                  <span className="text-right tabular-nums text-ink/75">
                    {[
                      item.notFound > 0
                        ? `No public evidence for ${item.notFound.toLocaleString()}`
                        : null,
                      item.providerUnavailable > 0
                        ? `Source unavailable for ${item.providerUnavailable.toLocaleString()}`
                        : null,
                      item.noProvider > 0
                        ? `No source connected for ${item.noProvider.toLocaleString()}`
                        : null,
                      item.noCompany > 0
                        ? `No company linked for ${item.noCompany.toLocaleString()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {noCompany > 0 ? (
          <p className="mt-3 text-xs leading-5 text-muted">
            {noCompany.toLocaleString()} lead{noCompany === 1 ? '' : 's'} could not be checked
            because no company is linked.
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Companies checked" value={results.metadata.companiesResearched} />
        <Stat label="External searches" value={results.metadata.externalCalls} />
      </dl>
    </div>
  )
}
