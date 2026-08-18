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
import { renderCellValue } from '@/components/intelligence/render-value'
import type { RunPhase, RunResults } from '@/components/intelligence/useResearchRun'

export function HubbleResultPanel({
  phase,
  message,
  results,
  merge,
  onEnrich,
  onClose,
  columnLabel,
}: {
  phase: RunPhase
  message: string | null
  results: RunResults | null
  merge: { state: 'idle' | 'busy' | 'done'; summary: string | null }
  onEnrich: () => void
  onClose: () => void
  columnLabel: (field: string) => string
}) {
  const working = phase === 'planning' || phase === 'running'

  return (
    <aside
      aria-label="Hubble results"
      className="clay-raised flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden lg:sticky lg:top-6"
    >
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {working ? 'Hubble is working' : phase === 'error' ? 'Could not finish' : 'Result'}
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
          className="shrink-0 rounded-full px-2 py-1 text-muted transition-colors duration-150 hover:text-ink"
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

        {results?.clarification && results.clarification.questions.length > 0 ? (
          <div className="space-y-2">
            {/* Nothing has been queued or charged at this point. */}
            <p className="text-sm text-ink">{message ?? 'One more detail first.'}</p>
            {results.clarification.questions.map((question) => (
              <p key={question.id} className="text-sm text-muted">
                {question.question}
              </p>
            ))}
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

              {results.status === 'partially_complete' ? (
                /* The honest status, not a failure. Some fields simply could
                   not be found, and the run says which. */
                <p className="rounded-[var(--radius-lg)] bg-warning-soft px-3 py-2 text-xs text-warning">
                  Some values could not be found. They are marked Unknown below, never guessed.
                </p>
              ) : null}

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
                                /* "Unknown" and "does not have one" are
                                   different facts and must look different. */
                                <span className="text-muted/70">Unknown</span>
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
                : 'w-full rounded-[var(--radius-lg)] bg-teal px-4 py-2.5 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.98] disabled:opacity-60'
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
