/**
 * Report export — M4 Phase 10.5.
 *
 * M4 ACCEPTANCE CRITERION 7: "export output matches the on-screen report
 * numbers exactly; export blocked for unauthorized roles."
 *
 * The role half is enforced in the route (`report.export`); this file covers
 * the output half — and the failure it exists to prevent is a MISSING COLUMN,
 * which fails the criterion just as surely as a wrong number and is far easier
 * to ship without noticing.
 */
import { describe, expect, it } from 'vitest'

import type { SetterDashboard } from '@/lib/crm/metrics'
import {
  exportFilename,
  funnelsCsv,
  leaderboardCsv,
  myActivityCsv,
  ReportTooLargeError,
} from '@/lib/crm/report-export'
import type { BatchFunnel, LeaderboardRow, PipelineTotals } from '@/lib/crm/reports'

function dashboard(over: Partial<SetterDashboard> = {}): SetterDashboard {
  return {
    userId: 'u1',
    fromDay: '2026-08-01',
    toDay: '2026-08-30',
    contactsCreated: 0,
    engagements: 0,
    openersSent: 0,
    personalizedDms: 0,
    followUps: 0,
    emailsSent: 0,
    contactsEmailed: 0,
    replies: 0,
    replyRate: null,
    qualified: 0,
    callsBooked: 0,
    callsHeld: 0,
    tasksCompleted: 0,
    wonDeals: 0,
    wonRevenue: 0,
    ...over,
  }
}

const PIPELINE: PipelineTotals = {
  openDeals: 0,
  openValue: 0,
  weightedValue: 0,
  wonDeals: 0,
  wonValue: 0,
}

const row = (over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  ...dashboard(),
  name: 'Sam Ellis',
  ...over,
})

/** Header row, with the UTF-8 BOM stripped. */
function headers(csv: string): string[] {
  return csv.replace(/^﻿/, '').split('\r\n')[0]!.split(',')
}

function cells(csv: string, line = 1): string[] {
  return csv.replace(/^﻿/, '').split('\r\n')[line]!.split(',')
}

describe('every metric column survives, even when empty', () => {
  it('KEEPS the reply-rate column for a person with no replies', () => {
    // The bug this pins: `toCsv` drops a column that is empty on every row,
    // which is right for a lead export and wrong for a one-row report. The
    // column vanished and the file stopped listing a metric the screen shows.
    const csv = myActivityCsv(dashboard({ contactsCreated: 44 }), PIPELINE, 'sam@acme.com')
    expect(headers(csv)).toContain('Reply rate')
  })

  it('keeps every leaderboard column when the whole team did nothing', () => {
    const csv = leaderboardCsv([row(), row({ name: 'Pat Chen' })])
    for (const header of [
      'Person', 'Contacts created', 'Engagements', 'Openers sent',
      'Personalized DMs', 'Follow-ups', 'Emails sent', 'Contacts emailed',
      'Replies', 'Reply rate', 'Qualified', 'Calls booked', 'Calls held',
      'Tasks completed', 'Won deals', 'Won revenue',
    ]) {
      expect(headers(csv)).toContain(header)
    }
  })

  it('keeps every funnel column when nothing has been won', () => {
    expect(headers(funnelsCsv([funnel()]))).toEqual([
      'Batch', 'Step', 'Contacts', 'Won revenue',
    ])
  })
})

describe('the numbers match the screen', () => {
  it('carries counts through unchanged', () => {
    const csv = leaderboardCsv([
      row({ contactsEmailed: 12, replies: 3, replyRate: 0.25, wonRevenue: 4500 }),
    ])
    const values = cells(csv)
    const index = (h: string) => headers(csv).indexOf(h)

    expect(values[index('Contacts emailed')]).toBe('12')
    expect(values[index('Replies')]).toBe('3')
    expect(values[index('Won revenue')]).toBe('4500')
  })

  it('renders a reply rate as the same percentage the page shows', () => {
    const csv = leaderboardCsv([row({ replyRate: 0.25 })])
    expect(cells(csv)[headers(csv).indexOf('Reply rate')]).toBe('25%')
  })

  it('writes N/A, never 0%, when there is no rate at all', () => {
    // A person who emailed nobody has no rate. "0%" would say they were
    // ignored by everyone.
    const csv = leaderboardCsv([row({ replyRate: null })])
    expect(cells(csv)[headers(csv).indexOf('Reply rate')]).toBe('N/A')
  })
})

describe('formula injection', () => {
  it('neutralises a hostile name without destroying it', () => {
    // Anyone can set their own LinkedIn headline, and a report that names
    // people carries it straight into Excel.
    const csv = leaderboardCsv([row({ name: `=cmd|'/c calc'!A1` })])
    const value = cells(csv)[0]!

    expect(value.startsWith('=')).toBe(false)
    // Prefixed, not stripped: the original characters survive so the data is
    // still readable.
    expect(value).toContain(`cmd|'/c calc'!A1`)
  })

  it('neutralises a hostile batch name too', () => {
    const csv = funnelsCsv([funnel({ name: '+1+1' })])
    expect(cells(csv)[0]!.startsWith('+')).toBe(false)
  })
})

describe('funnels export long, not wide', () => {
  it('writes one row per step so a new step does not change the shape', () => {
    const csv = funnelsCsv([funnel()])
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
    // Header plus one row per step.
    expect(lines).toHaveLength(1 + 3)
  })

  it('states revenue once, on the Won step', () => {
    const csv = funnelsCsv([funnel({ wonRevenue: 1000 })])
    const body = csv.replace(/^﻿/, '').split('\r\n').slice(1)
    const withRevenue = body.filter((line) => line.endsWith(',1000'))
    // Repeating it on every row would read as a per-step figure.
    expect(withRevenue).toHaveLength(1)
  })
})

describe('size guard', () => {
  it('refuses a report too large for a direct download', () => {
    // Reports are aggregates and should never reach this. If one does, the
    // record-level export path is what is actually wanted (Ledger DR17).
    const many = Array.from({ length: 5001 }, () => row())
    expect(() => leaderboardCsv(many)).toThrow(ReportTooLargeError)
  })

  it('allows a realistic team', () => {
    expect(() => leaderboardCsv(Array.from({ length: 200 }, () => row()))).not.toThrow()
  })
})

describe('filenames', () => {
  it('names the report and its period, so it is findable a month later', () => {
    expect(exportFilename('leaderboard', '2026-08-01', '2026-08-30')).toBe(
      'outlio-team-2026-08-01-to-2026-08-30.csv',
    )
    expect(exportFilename('funnels', '2026-08-01', '2026-08-30')).toContain('lead-batches')
    expect(exportFilename('my_activity', '2026-08-01', '2026-08-30')).toContain('my-activity')
  })
})

function funnel(over: Partial<BatchFunnel> = {}): BatchFunnel {
  return {
    batchId: 'b1',
    name: 'Extraction 2026-08-14',
    createdAt: '2026-08-14T00:00:00Z',
    steps: [
      { label: 'Extracted', value: 25 },
      { label: 'Canonical contacts', value: 25 },
      { label: 'Won', value: 0 },
    ],
    wonRevenue: 0,
    ...over,
  }
}
