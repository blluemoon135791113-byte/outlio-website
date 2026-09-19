'use client'

import { useActionState } from 'react'

import {
  analyseEmailAction,
  compareSequencesAction,
  type EmailAnalysisState,
  type SequenceComparisonState,
} from '@/app/(product)/email/analysis-actions'
import { Button } from '@/components/ui/Button'
import { FormMessage } from '@/components/ui/Feedback'
import type { SequenceStats } from '@/lib/email/analysis'

/**
 * "Which sequence is working better, in this period."
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ TWO BUTTONS ON ONE SET OF DATES, AND THAT IS THE DESIGN.             ║
 * ║                                                                           ║
 * ║  "Compare" is arithmetic over the customer's own rows: instant, free,     ║
 * ║  and it works when the model is down. "Analyse the copy" spends a credit  ║
 * ║  and takes seconds.                                                       ║
 * ║                                                                           ║
 * ║  Collapsing them into one button would make the reliable half of this     ║
 * ║  screen depend on the unreliable half — somebody who only wants to know   ║
 * ║  which sequence replied better would pay for, and wait on, a model they   ║
 * ║  did not ask for.                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THE DATES ARE PLAIN INPUTS SHARED BY BOTH FORMS — via `form=`, so one pair
 * of fields drives two actions without mirroring their values into React state
 * where the two copies could disagree with what is on screen.
 */
export function SequenceComparison() {
  const [comparison, compare, comparing] = useActionState<SequenceComparisonState, FormData>(
    compareSequencesAction,
    null,
  )
  const [analysis, analyse, analysing] = useActionState<EmailAnalysisState, FormData>(
    analyseEmailAction,
    null,
  )

  return (
    <section className="space-y-4">
      <div className="clay space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Compare sequences</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Which sequence got the most back, over a period you choose. The counts come from
            your own event records.
          </p>
        </div>

        {/*
          ⚠️ ONE `<form id>`, TWO SUBMIT BUTTONS POINTING AT IT. The second
          button lives outside the element and reaches it with `form=`, which
          is why both actions see the same dates without a line of state.
        */}
        <form id="sequence-window" action={compare} className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-ink">
            <span className="block">From</span>
            <input
              type="date"
              name="from"
              className="mt-1 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="text-xs font-medium text-ink">
            <span className="block">To</span>
            <input
              type="date"
              name="to"
              className="mt-1 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>

          <Button type="submit" pending={comparing} pendingLabel="Counting…">
            Compare
          </Button>

          <Button
            type="submit"
            form="sequence-window"
            formAction={analyse}
            variant="secondary"
            pending={analysing}
            pendingLabel="Reading the copy…"
          >
            Analyse the copy
          </Button>
        </form>

        <p className="text-xs leading-relaxed text-muted">
          Both dates are included. Leave them empty to read everything recorded so far. Days
          are counted in UTC.
        </p>

        {comparison && !comparison.ok ? (
          <FormMessage tone="error">{comparison.error}</FormMessage>
        ) : null}
        {analysis && !analysis.ok ? (
          <FormMessage tone="error">{analysis.error}</FormMessage>
        ) : null}
      </div>

      {comparison?.ok ? (
        <>
          {comparison.caveat ? <Caveat>{comparison.caveat}</Caveat> : null}
          <Table sequences={comparison.sequences} overall={comparison.overall} />
        </>
      ) : null}

      {analysis?.ok ? (
        <div className="space-y-4">
          {/*
            ⚠️ THE CAVEAT SITS ABOVE THE FINDINGS. It is the sentence that says
            whether any of this is evidence, and a reader who has already read
            six confident findings has formed a view before reaching it.
          */}
          {analysis.report.caveat ? <Caveat>{analysis.report.caveat}</Caveat> : null}

          {/*
            Rendered from the report's own numbers rather than from
            `comparison`, so the table and the findings below it always
            describe the same period — the date inputs can be changed between
            the two runs.
          */}
          <Table
            sequences={analysis.report.sequences}
            overall={analysis.report.overall}
          />

          <div className="clay p-4">
            <h3 className="text-sm font-semibold text-ink">What the copy is doing</h3>
            <ul className="mt-2 space-y-3">
              {analysis.report.findings.map((finding, i) => (
                <li key={i}>
                  <p className="text-xs font-semibold text-ink">
                    <span
                      className={
                        finding.kind === 'working'
                          ? 'text-success'
                          : finding.kind === 'not_working'
                            ? 'text-danger'
                            : 'text-accent'
                      }
                    >
                      {finding.kind === 'working'
                        ? 'Working'
                        : finding.kind === 'not_working'
                          ? 'Not working'
                          : 'Do this'}
                    </span>
                    {' — '}
                    {finding.headline}
                  </p>
                  {finding.detail ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{finding.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="note"
      className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-xs leading-relaxed text-warning"
    >
      {children}
    </p>
  )
}

function Table({
  sequences,
  overall,
}: {
  sequences: SequenceStats[]
  overall: SequenceStats
}) {
  if (sequences.length === 0) {
    return (
      <div className="clay p-8 text-center">
        <p className="text-sm font-medium text-ink">No sequence sent anything in this period</p>
        <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted">
          Widen the dates, or leave them empty to read everything recorded so far.
        </p>
      </div>
    )
  }

  return (
    <div className="clay overflow-x-auto p-0">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-[0.08em] text-muted">
            <th scope="col" className="px-4 py-3 font-semibold">Sequence</th>
            <th scope="col" className="px-4 py-3 font-semibold">People</th>
            <th scope="col" className="px-4 py-3 font-semibold">Sent</th>
            <th scope="col" className="px-4 py-3 font-semibold">Replied</th>
            {/*
              ⚠️ THE HEADER SAYS "per person", BECAUSE `/email/analytics`
              directly above measures replies per MESSAGE and the two figures
              are two clicks apart. Both are right; calling them the same thing
              was the bug `lib/crm/metrics.ts` already records.
            */}
            <th scope="col" className="px-4 py-3 font-semibold">Reply rate (per person)</th>
            <th scope="col" className="px-4 py-3 font-semibold">Bounced</th>
          </tr>
        </thead>
        <tbody>
          {sequences.map((row) => (
            <tr key={row.campaignId} className="border-b border-line last:border-0">
              <td className="px-4 py-3">
                <span className="font-medium text-ink">{row.name}</span>
                <span className="ml-2 text-xs text-muted">{row.status}</span>
              </td>
              <td className="px-4 py-3 tabular-nums text-ink">{row.contacted}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{row.sent}</td>
              <td className="px-4 py-3 tabular-nums text-ink">{row.replied}</td>
              <td className="px-4 py-3 tabular-nums">
                <Rate value={row.replyRate} contacted={row.contacted} />
              </td>
              <td className="px-4 py-3 tabular-nums text-ink">{row.bounced}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border text-sm font-semibold">
            <td className="px-4 py-3 text-ink">Everything</td>
            <td className="px-4 py-3 tabular-nums text-ink">{overall.contacted}</td>
            <td className="px-4 py-3 tabular-nums text-ink">{overall.sent}</td>
            <td className="px-4 py-3 tabular-nums text-ink">{overall.replied}</td>
            <td className="px-4 py-3 tabular-nums">
              <Rate value={overall.replyRate} contacted={overall.contacted} />
            </td>
            <td className="px-4 py-3 tabular-nums text-ink">{overall.bounced}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/**
 * ⚠️ `null` IS "not enough data", NEVER 0%. Zero means thirty people were
 * contacted and nobody answered — a finding. Null means too few were contacted
 * to say, which is not. Rendering the second as the first condemns a sequence
 * that has barely been tried, and this table exists to rank them against each
 * other.
 */
function Rate({ value, contacted }: { value: number | null; contacted: number }) {
  if (value !== null) return <span className="text-ink">{value}%</span>
  return (
    <span className="text-muted" title={`${contacted} contacted — too few to compute a rate`}>
      not enough data
    </span>
  )
}
