'use client'

import { useActionState, useState } from 'react'

import { analyseAction, type AnalysisState } from '@/app/(product)/linkedin/strategy-actions'
import { Button } from '@/components/ui/Button'
/*
 * ⚠️ `Stat` AND `FormMessage` COME FROM THE SHARED LAYER NOW. This file shipped
 * with its own `Stat` an hour before `components/ui/Feedback.tsx` existed —
 * which is precisely how the product reached 148 button definitions. The local
 * copy is deleted rather than kept "just for this screen".
 */
import { FormMessage, Stat } from '@/components/ui/Feedback'
import type { AnalysisReport, RepStats } from '@/lib/linkedin/analysis'

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
export type AnalysisPerson = { userId: string; name: string }

export function StrategyAnalysis({ people }: { people: AnalysisPerson[] }) {
  const [state, run, pending] = useActionState<AnalysisState, FormData>(analyseAction, null)
  /*
   * ⚠️ THE SELECTION IS THE FORM, matching `BulkAssign`. Each checkbox is a
   * real `<input name="userId">`, so what is submitted is by definition what is
   * ticked on screen. Mirroring it into React state is how a form ends up
   * analysing somebody who was unticked.
   *
   * Only `everyone` is state, because it controls whether the list is shown at
   * all — and it is a genuinely different question from "which of them".
   */
  const [everyone, setEveryone] = useState(true)

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Strategy analysis</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Reads the openers and pitches your team wrote, alongside what was actually recorded
          as sent and replied, and says what is working. The counts come from your own records;
          the AI comments on the writing only.
        </p>

        <form action={run} className="mt-4 space-y-4">
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Period
            </legend>
            <div className="mt-1.5 flex flex-wrap items-end gap-3">
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
            </div>
            {/*
              ⚠️ SAYS BOTH THINGS THAT WOULD OTHERWISE SURPRISE SOMEBODY.
              Leaving the dates empty reads the whole history, and the range is
              inclusive at both ends in UTC — a manager checking "the 31st"
              against their own records needs to know which day each boundary
              actually caught.
            */}
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Both dates are included. Leave them empty to read everything recorded so far.
              Days are counted in UTC.
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              Whose work
            </legend>

            <label className="mt-1.5 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={everyone}
                onChange={(event) => setEveryone(event.target.checked)}
              />
              Everyone on the team
            </label>

            {/*
              ⚠️ THE CHECKBOXES ARE UNMOUNTED, NOT HIDDEN, WHEN "everyone" IS
              ON. A hidden-but-present `<input name="userId">` still submits,
              so a stale tick from before the toggle would silently narrow a
              report that says it covers the whole team.
            */}
            {!everyone ? (
              people.length === 0 ? (
                <p className="mt-2 text-xs text-muted">
                  Nobody else is in this workspace yet.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {people.map((person) => (
                    <label
                      key={person.userId}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-line bg-panel px-2.5 py-1.5 text-sm text-ink"
                    >
                      <input type="checkbox" name="userId" value={person.userId} />
                      {person.name}
                    </label>
                  ))}
                </div>
              )
            ) : null}
          </fieldset>

          <Button type="submit" pending={pending} pendingLabel="Analysing…">
            Run analysis
          </Button>
        </form>

        {state && !state.ok ? (
          <FormMessage tone="error" className="mt-3">
            {state.error}
          </FormMessage>
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

      {state?.ok ? <Report report={state.report} people={people} /> : null}
    </div>
  )
}

function Report({
  report,
  people,
}: {
  report: NonNullable<Extract<AnalysisState, { ok: true }>>['report']
  people: AnalysisPerson[]
}) {
  return (
    <div className="space-y-4">
      {/*
        ⚠️ THE REPORT STATES ITS OWN SCOPE, read from `report.window` rather
        than from the form. The inputs above can be changed after a run, so a
        heading built from them would relabel a finished report — March's
        numbers under a heading that now says April.
      */}
      <ScopeLine window={report.window} people={people} />

      {/*
        ⚠️ THE CAVEAT SITS ABOVE THE FINDINGS, NOT BELOW THEM. It is the sentence
        that says whether any of this is evidence, and a reader who has already
        read six confident findings has formed a view before reaching it.
      */}
      {report.caveat ? (
        <p
          role="note"
          className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-2 text-xs leading-relaxed text-warning"
        >
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

/**
 * What this report actually covers, in one sentence.
 *
 * ⚠️ NAMES THE PEOPLE RATHER THAN COUNTING THEM, up to a point. "3 people
 * selected" leaves a reader unable to tell whether the person they care about
 * is in the numbers — which is the first thing anybody asks of a per-person
 * report.
 */
function ScopeLine({
  window,
  people,
}: {
  window: AnalysisReport['window']
  people: AnalysisPerson[]
}) {
  const period =
    window.from && window.to
      ? `${window.from} to ${window.to}`
      : window.from
        ? `since ${window.from}`
        : window.to
          ? `up to ${window.to}`
          : 'everything recorded so far'

  const names = window.userIds
    .map((id) => people.find((p) => p.userId === id)?.name)
    .filter((name): name is string => Boolean(name))

  const who =
    window.userIds.length === 0
      ? 'the whole team'
      : names.length === 0
        ? `${window.userIds.length} selected`
        : names.length <= 4
          ? names.join(', ')
          : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`

  return (
    <p className="text-xs text-muted">
      Covering <span className="font-medium text-ink">{period}</span> · {who}
    </p>
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
