import 'server-only'

/**
 * Report export (M4 Phase 10.5).
 *
 * ⚠️ EVERY CELL GOES THROUGH `sanitizeCell`. A contact's name is
 * attacker-controlled — anyone can set their own LinkedIn headline to
 * `=cmd|'/c calc'!A1` — and a report that names people carries that straight
 * into Excel. The defence is implemented once in `lib/export/sanitize.ts` and
 * this file must not reimplement any part of it.
 *
 * ⚠️ GATED ON `report.export`, which setters do not have. An export is bulk
 * exfiltration of the whole team's numbers, which is a different act from
 * reading your own dashboard.
 */
import { toCsv, type CsvColumn } from '@/lib/export/sanitize'
import type { BatchFunnel, LeaderboardRow, PipelineTotals } from '@/lib/crm/reports'
import type { SetterDashboard } from '@/lib/crm/metrics'

export type ReportKind = 'leaderboard' | 'funnels' | 'my_activity'

/**
 * ⚠️ REPORT EXPORTS ARE SYNCHRONOUS, AND THAT IS A DELIBERATE LIMIT.
 *
 * The M4 brief asks for background jobs on large datasets. A report is an
 * AGGREGATE — one row per member, one per batch — so it is bounded by team
 * size and batch count, not by contact count. A workspace with a million
 * contacts still has a leaderboard of twenty rows.
 *
 * RECORD-level exports (every contact, every activity) are the large case and
 * genuinely need the queue. They belong with the contact list, use the existing
 * `export_jobs` path, and are Ledger DR17 — not quietly folded in here where
 * they would time out a request handler.
 */
const MAX_ROWS = 5_000

export class ReportTooLargeError extends Error {}

function guard(rowCount: number): void {
  if (rowCount > MAX_ROWS) {
    throw new ReportTooLargeError(
      `That report has ${rowCount} rows, which is more than a direct download can carry. It needs a background export.`,
    )
  }
}

/** Percentage, or the empty marker — never "0%" for "no data". */
function rate(value: number | null): string | null {
  return value === null ? null : `${Math.round(value * 100)}%`
}

const LEADERBOARD_COLUMNS: readonly CsvColumn<LeaderboardRow>[] = [
  { header: 'Person', value: (r) => r.name },
  { header: 'Contacts created', value: (r) => r.contactsCreated },
  { header: 'Engagements', value: (r) => r.engagements },
  { header: 'Openers sent', value: (r) => r.openersSent },
  { header: 'Personalized DMs', value: (r) => r.personalizedDms },
  { header: 'Follow-ups', value: (r) => r.followUps },
  { header: 'Emails sent', value: (r) => r.emailsSent },
  { header: 'Contacts emailed', value: (r) => r.contactsEmailed },
  { header: 'Replies', value: (r) => r.replies },
  { header: 'Reply rate', value: (r) => rate(r.replyRate) },
  { header: 'Qualified', value: (r) => r.qualified },
  { header: 'Calls booked', value: (r) => r.callsBooked },
  { header: 'Calls held', value: (r) => r.callsHeld },
  { header: 'Tasks completed', value: (r) => r.tasksCompleted },
  { header: 'Won deals', value: (r) => r.wonDeals },
  { header: 'Won revenue', value: (r) => r.wonRevenue },
]

/**
 * ⚠️ COLUMN NAMES MATCH THE SCREEN EXACTLY.
 *
 * M4 criterion 7 is that the export matches the on-screen numbers. Renaming a
 * column in the file — "Emails" for "Emails sent" — is how the two quietly
 * stop being comparable, and the reader has no way to know which is which.
 */
export function leaderboardCsv(rows: LeaderboardRow[]): string {
  guard(rows.length)
  return toCsv(rows, LEADERBOARD_COLUMNS, {
    // Every column is pinned: a leaderboard with a column dropped for being
    // all-zero looks like the metric does not exist, when it means nobody did
    // that thing this period. That distinction is the report's whole point.
    alwaysKeep: LEADERBOARD_COLUMNS.map((c) => c.header),
  })
}

type FunnelRow = { batch: string; step: string; contacts: number; wonRevenue: number | null }

/**
 * Funnels export LONG, one row per step, rather than wide.
 *
 * A wide file needs a column per step and breaks the moment a step is added.
 * Long survives that, and it is the shape a pivot table wants anyway.
 */
export function funnelsCsv(funnels: BatchFunnel[]): string {
  const rows: FunnelRow[] = []
  for (const funnel of funnels) {
    for (const step of funnel.steps) {
      rows.push({
        batch: funnel.name,
        step: step.label,
        contacts: step.value,
        // Revenue belongs to the batch, not to a step, so it is stated once
        // rather than repeated down every row where it would look like a
        // per-step figure that happens to be identical.
        wonRevenue: step.label === 'Won' ? funnel.wonRevenue : null,
      })
    }
  }

  guard(rows.length)

  return toCsv(
    rows,
    [
      { header: 'Batch', value: (r) => r.batch },
      { header: 'Step', value: (r) => r.step },
      { header: 'Contacts', value: (r) => r.contacts },
      { header: 'Won revenue', value: (r) => r.wonRevenue },
    ],
    { alwaysKeep: ['Batch', 'Step', 'Contacts', 'Won revenue'] },
  )
}

/** One person's own numbers, as a single row. */
export function myActivityCsv(
  dashboard: SetterDashboard,
  pipeline: PipelineTotals,
  name: string,
): string {
  const row = { ...dashboard, name, pipeline }

  const columns: CsvColumn<typeof row>[] = [
    { header: 'Person', value: (r) => r.name },
    { header: 'From', value: (r) => r.fromDay },
    { header: 'To', value: (r) => r.toDay },
    ...LEADERBOARD_COLUMNS.slice(1).map((column) => ({
      header: column.header,
      value: (r: typeof row) => column.value(r as unknown as LeaderboardRow),
    })),
    { header: 'Open deals', value: (r) => r.pipeline.openDeals },
    { header: 'Open value', value: (r) => r.pipeline.openValue },
    { header: 'Weighted forecast', value: (r) => r.pipeline.weightedValue },
  ]

  /*
   * ⚠️ EVERY COLUMN PINNED, and this one bit.
   *
   * `toCsv` drops a column that is empty on every row — right for a lead
   * export, where an all-N/A column reads as the extractor having failed.
   * Wrong for a report of ONE row: a person with no replies has a null reply
   * rate, so the column vanished entirely and the file no longer listed a
   * metric the screen was showing. M4 criterion 7 is that the export matches
   * the on-screen numbers, and a missing column fails it just as surely as a
   * wrong number.
   */
  return toCsv([row], columns, { alwaysKeep: columns.map((c) => c.header) })
}

/** A filename a person can find again a month later. */
export function exportFilename(kind: ReportKind, fromDay: string, toDay: string): string {
  const label: Record<ReportKind, string> = {
    leaderboard: 'team',
    funnels: 'lead-batches',
    my_activity: 'my-activity',
  }
  return `outlio-${label[kind]}-${fromDay}-to-${toDay}.csv`
}
