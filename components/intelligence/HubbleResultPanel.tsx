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
import type { RunPhase, RunResults } from '@/components/intelligence/useResearchRun'

export function HubbleResultPanel({
  phase,
  message,
  results,
  merge,
  onEnrich,
  onClarify,
  onClose,
  columnLabel,
}: {
  phase: RunPhase
  message: string | null
  results: RunResults | null
  merge: { state: 'idle' | 'busy' | 'done'; summary: string | null }
  onEnrich: () => void
  onClarify: (answers: Record<string, string>) => void
  onClose: () => void
  columnLabel: (field: string) => string
}) {
  const working = phase === 'planning' || phase === 'running'
  const [answers, setAnswers] = useState<Record<string, string>>({})

  return (
    <aside
      aria-label="Hubble results"
      className="clay-raised flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden lg:sticky lg:top-6"
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

      {/*
        ⚠️ `data-lenis-prevent` IS LOAD-BEARING. The app runs Lenis smooth
        scroll, which hijacks the page scroll — without this attribute a nested
        scroll container does not scroll at all.
      */}
      <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {working ? (
          <div role="status" className="space-y-2.5 py-2">
            <p className="text-sm text-muted">
              {phase === 'planning'
                ? 'Reading the question and deciding what to look up…'
                : 'Researching. Companies already known are reused and cost nothing.'}
            </p>
            {/* Placeholder lines, not a spinner: they show the shape of what is
                coming, and the teal ring on the prompt bar carries the motion. */}
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
                          ? 'bg-ink font-medium text-white'
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
              className="clay-interactive w-full cursor-pointer rounded-[var(--radius-clay)] bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {Object.keys(answers).length < results.clarification.questions.length
                ? 'Answer every question to continue'
                : 'Research this'}
            </button>
          </div>
        ) : null}

        {phase === 'done' && results ? (
          results.rows.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              No leads matched that question. Try widening the list, or asking about a different
              attribute.
            </p>
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="Leads" value={results.metadata.leadsEvaluated} />
                <Stat label="Companies" value={results.metadata.companiesResearched} />
                <Stat label="Reused from cache" value={results.metadata.cachedResultsUsed} />
                <Stat label="External calls" value={results.metadata.externalCalls} />
              </dl>

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

                if (results.status === 'partially_complete') {
                  return (
                    <p className="rounded-[var(--radius-lg)] bg-warning-soft px-3 py-2 text-xs text-warning">
                      Some values could not be found. Each says why below, and none are guessed.
                    </p>
                  )
                }

                return null
              })()}

              <ul className="space-y-2.5">
                {results.rows.map((row) => (
                  <li key={row.leadId} className="clay-sunken px-3.5 py-3">
                    <p className="truncate text-sm font-medium text-ink">
                      {row.personName ?? 'Unnamed lead'}
                      {row.companyName ? (
                        <span className="font-normal text-muted"> · {row.companyName}</span>
                      ) : null}
                    </p>

                    <dl className="mt-1.5 space-y-1">
                      {results.columns.map((field) => {
                        const cell = row.fields[field]
                        return (
                          <div key={field} className="flex gap-2 text-xs">
                            <dt className="w-28 shrink-0 text-muted">{columnLabel(field)}</dt>
                            <dd className="min-w-0 flex-1 text-ink">
                              {!cell || cell.state !== 'known' ? (
                                /*
                                 * ⚠️ THE REASON, NOT JUST "UNKNOWN". A field
                                 * nobody could look up because the provider was
                                 * out of quota is not a company without
                                 * funding, and a wall of bare "Unknown" reads
                                 * as the product being broken.
                                 */
                                <span className="text-muted/70">
                                  {cell?.reason === 'provider_unavailable'
                                    ? 'Source unavailable'
                                    : cell?.reason === 'no_provider'
                                      ? 'No source for this'
                                      : cell?.reason === 'no_company'
                                        ? 'No company linked'
                                        : 'Not found'}
                                </span>
                              ) : (
                                renderCellValue(cell.value)
                              )}
                            </dd>
                          </div>
                        )
                      })}
                    </dl>
                  </li>
                ))}
              </ul>

              {results.truncated ? (
                <p className="text-xs text-muted">
                  Showing the first {results.rows.length} rows. Narrow the list to see the rest.
                </p>
              ) : null}
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
                : 'clay-interactive w-full cursor-pointer rounded-[var(--radius-clay)] bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60'
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="clay-sunken px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink">{value.toLocaleString()}</dd>
    </div>
  )
}
