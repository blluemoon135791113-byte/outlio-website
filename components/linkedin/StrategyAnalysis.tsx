'use client'

import { useActionState } from 'react'

import { analyseAction, type AnalysisState } from '@/app/(product)/linkedin/strategy-actions'
import type { RepStats } from '@/lib/linkedin/analysis'

/**
 * The strategy analysis — Phase 20, premium.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NO PERCENTAGE IS RENDERED THAT THE SERVER DID NOT COMPUTE, AND A      ║
 * ║  `null` RATE IS PRINTED AS WORDS RATHER THAN AS A NUMBER.                 ║
 * ║                                                                           ║
 * ║  `email_events` still holds 254 false `replied` rows — a whole mailbox    ║
 * ║  counted as prospect replies against two messages ever sent, which        ║
 * ║  renders 12,700%. This screen is where that class of error becomes a       ║
 * ║  manager's decision about a person, so the arithmetic lives in            ║
 * ║  `gatherStats` and this file only lays it out.                            ║
 * ║                                                                           ║
 * ║  A rate below the floor arrives as `null` and is shown as "not enough     ║
 * ║  data" — never as 0%, which means something different and much worse to    ║
 * ║  the rep it is about.                                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function StrategyAnalysis() {
  const [state, run, pending] = useActionState<AnalysisState, FormData>(analyseAction, null)

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Strategy analysis</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Reads the openers and pitches your team wrote, alongside what was actually recorded
          as sent and replied, and says what is working. The counts come from your own records;
          the AI comments on the writing only.
        </p>
        <form action={run} className="mt-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-medium text-cream transition-colors duration-150 hover:bg-accent-deep disabled:opacity-60"
          >
            {pending ? 'Analysing…' : 'Run analysis'}
          </button>
        </form>

        {state && !state.ok ? (
          <p role="alert" className="mt-3 text-xs text-danger">
            {state.error}
          </p>
        ) : null}
      </div>

      {pending ? (
        /*
          ⚠️ A DESIGNED LOADING STATE, not a spinner. This call takes seconds and
          the page is otherwise blank, which reads as nothing having happened.
        */
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4" aria-busy>
          <div className="h-4 w-48 rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse" />
          <div className="mt-3 space-y-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-3 w-full max-w-xl rounded-[var(--radius-sm)] bg-surface-muted motion-safe:animate-pulse"
              />
            ))}
          </div>
        </div>
      ) : null}

      {state?.ok ? <Report report={state.report} /> : null}
    </div>
  )
}

function Report({ report }: { report: NonNullable<Extract<AnalysisState, { ok: true }>>['report'] }) {
  return (
    <div className="space-y-4">
      {/*
        ⚠️ THE CAVEAT SITS ABOVE THE FINDINGS, NOT BELOW THEM. It is the sentence
        that says whether any of this is evidence, and a reader who has already
        read six confident findings has formed a view before reaching it.
      */}
      {report.caveat ? (
        <p role="note" className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-xs leading-relaxed text-warning">
          {report.caveat}
        </p>
      ) : null}

      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Everyone</h3>
        <StatRow stats={report.overall} />
      </div>

      {report.perRep.length > 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold text-ink">By person</h3>
          <ul className="mt-2 divide-y divide-border">
            {report.perRep.map((rep) => (
              <li key={rep.userId ?? 'unassigned'} className="py-3 first:pt-1 last:pb-1">
                <p className="text-xs font-medium text-ink">
                  {rep.name ?? 'Unattributed'}
                </p>
                <StatRow stats={rep} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink">Findings</h3>
        <ul className="mt-2 space-y-3">
          {report.findings.map((finding, i) => (
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
  )
}

function StatRow({ stats }: { stats: RepStats }) {
  return (
    <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
      <Stat label="Recorded actions" value={String(stats.sent)} />
      <Stat label="Replies" value={String(stats.replies)} />
      <Stat label="Meetings" value={String(stats.meetings)} />
      {/*
        ⚠️ `null` IS "not enough data", NEVER 0%. Zero means thirty were sent and
        nobody answered — a finding. Null means we have not sent enough to say,
        which is not. Rendering the second as the first tells a rep their
        approach failed when it has not been tried.
      */}
      <Stat
        label="Reply rate"
        value={stats.replyRate === null ? 'not enough data' : `${stats.replyRate}%`}
        muted={stats.replyRate === null}
      />
      {stats.unconfirmed > 0 ? (
        <Stat label="Unconfirmed" value={String(stats.unconfirmed)} warn />
      ) : null}
      <Stat label="Messages written" value={String(stats.openers + stats.pitches)} />
    </dl>
  )
}

function Stat({
  label,
  value,
  muted,
  warn,
}: {
  label: string
  value: string
  muted?: boolean
  warn?: boolean
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm tabular-nums ${
          warn ? 'text-warning' : muted ? 'text-muted' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
