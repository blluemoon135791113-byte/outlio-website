/**
 * The overview's performance row — and the four ways a stat card lies.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A NUMBER ON A DASHBOARD IS A CLAIM ABOUT SOMEBODY'S WEEK.                 ║
 * ║                                                                           ║
 * ║  It can lie by rendering an uncomputed period as zero, by rendering a      ║
 * ║  failed read as zero, by inventing a percentage from a zero baseline, or   ║
 * ║  by comparing a part-period against a whole one. Each of those produces a  ║
 * ║  plausible figure, which is why none of them would ever be reported as a   ║
 * ║  bug — the setter would just believe it.                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/crm/metrics', () => ({
  getSetterDashboard: vi.fn(),
  getLastRollupRun: vi.fn(),
}))

const { getSetterDashboard, getLastRollupRun } = await import('@/lib/crm/metrics')
const { getOverviewPerformance } = await import('@/lib/crm/overview')

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

/** A dashboard with every figure at `n`, so a test can vary one thing. */
function dash(overrides: Record<string, number | null> = {}) {
  return {
    userId: 'u1',
    fromDay: '2026-01-01',
    toDay: '2026-01-30',
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
    ...overrides,
  }
}

const RUN = { finishedAt: '2026-01-30T10:00:00.000Z', rowsWritten: 12, discrepancies: 0, error: null }

beforeEach(() => {
  vi.mocked(getLastRollupRun).mockReset()
  vi.mocked(getSetterDashboard).mockReset()
})

/** Current period first, prior period second — the order the loader awaits them. */
function given(now: ReturnType<typeof dash>, before: ReturnType<typeof dash>) {
  vi.mocked(getSetterDashboard)
    .mockResolvedValueOnce(now as never)
    .mockResolvedValueOnce(before as never)
}

describe('an uncomputed period is not a quiet week', () => {
  it('reports pending when the rollup has never run', async () => {
    /*
     * ⚠️ THE ONE THIS ROW EXISTS TO GET RIGHT. Before the rollup was given a
     * trigger at all, `crm_reporting_daily` was empty for every workspace in
     * production — so this is not a hypothetical branch, it is the state every
     * existing customer was in.
     */
    given(dash(), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue(null)

    const result = await getOverviewPerformance('ws', 'u1')

    expect(result.kind).toBe('pending')
    expect(result).not.toHaveProperty('cards')
  })

  it('reports real zeroes when a run HAS happened', async () => {
    // The distinction the branch above depends on: a computed zero is a fact
    // about the week and must render, or a quiet week looks like an outage.
    given(dash(), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')

    expect(result.kind).toBe('ready')
    if (result.kind !== 'ready') throw new Error('unreachable')
    expect(result.cards.map((c) => c.value)).toEqual([0, 0, 0, 0])
  })

  it('reports unavailable — never zero — when the read throws', async () => {
    vi.mocked(getSetterDashboard).mockRejectedValue(new Error('reporting down'))
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')

    expect(result.kind).toBe('unavailable')
  })
})

describe('a delta is never invented', () => {
  it('refuses a percentage when the previous period was zero', async () => {
    /*
     * ⚠️ EVERY PERCENTAGE FROM ZERO IS WRONG. "+100%" is arithmetic nonsense
     * and "+∞%" at least looks it; the honest report is that this is new.
     */
    given(dash({ contactsCreated: 14 }), dash({ contactsCreated: 0 }))
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')
    const contacts = result.cards.find((c) => c.key === 'contacts_created')!

    expect(contacts.delta).toBeNull()
    expect(contacts.isNew).toBe(true)
  })

  it('does not call nothing-from-nothing new', async () => {
    given(dash(), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')

    for (const c of result.cards) {
      expect(c.delta).toBeNull()
      expect(c.isNew, `${c.key} claims to be new`).toBe(false)
    }
  })

  it('computes a real change when there is a baseline', async () => {
    given(dash({ emailsSent: 150 }), dash({ emailsSent: 100 }))
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')
    const emails = result.cards.find((c) => c.key === 'emails_sent')!

    expect(emails.delta).toBeCloseTo(0.5)
    expect(emails.isNew).toBe(false)
  })

  it('reports a fall as a fall', async () => {
    given(dash({ replies: 3 }), dash({ replies: 12 }))
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')

    expect(result.cards.find((c) => c.key === 'replies')!.delta).toBeCloseTo(-0.75)
  })
})

describe('the comparison is fair', () => {
  it('measures two windows of equal length that do not overlap', async () => {
    /*
     * ⚠️ THE BUG THIS PREVENTS SHOWS UP ON THE FIRST OF EVERY MONTH. A
     * month-to-date compared against a whole previous month reports a collapse
     * in every metric, every month, and the figures are all individually
     * correct.
     */
    given(dash(), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')

    const days = (from: string, to: string) =>
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

    expect(days(result.fromDay, result.toDay)).toBe(
      days(result.priorFromDay, result.priorToDay),
    )
    // The prior window ends strictly before the current one begins.
    expect(result.priorToDay < result.fromDay).toBe(true)
  })

  it('dates the figures by when the run FINISHED, not when it started', async () => {
    // A run that started and never finished computed nothing; stamping the
    // figures with its start time would claim a freshness they do not have.
    given(dash(), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue({ ...RUN, finishedAt: null })

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')

    expect(result.computedAt).toBeNull()
  })
})

describe('a hint states a second fact, not a fabricated one', () => {
  it('says nobody was emailed rather than 0%', async () => {
    /*
     * `replyRate` is null when the denominator is zero — a team that has sent
     * nothing has no reply rate, and "0%" reads as failure rather than absence.
     */
    given(dash({ replies: 0, replyRate: null }), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')

    expect(result.cards.find((c) => c.key === 'replies')!.hint).toBe('nobody emailed yet')
  })

  it('renders a real reply rate as a percentage', async () => {
    given(dash({ replies: 3, replyRate: 0.12, contactsEmailed: 25 }), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')

    expect(result.cards.find((c) => c.key === 'replies')!.hint).toBe(
      '12% of contacts emailed',
    )
  })
})

describe('direction is declared per metric', () => {
  it('every card says which way is good', async () => {
    /*
     * Not a style point. The day a bounce or unsubscribe count joins this row,
     * a rise must not render in the success colour because the row assumed all
     * metrics grow in the right direction.
     */
    given(dash(), dash())
    vi.mocked(getLastRollupRun).mockResolvedValue(RUN)

    const result = await getOverviewPerformance('ws', 'u1')
    if (result.kind !== 'ready') throw new Error('unreachable')

    for (const c of result.cards) {
      expect(typeof c.higherIsBetter, `${c.key} has no direction`).toBe('boolean')
    }
  })
})

describe('the row is reachable and obeys the product design rules', () => {
  const PAGE = read('app/(product)/dashboard/page.tsx')
  const ROW = read('components/product/PerformanceRow.tsx')
  /*
   * ⚠️ THE CARD IS A SEPARATE FILE AND THIS GUARD FOLLOWED IT THERE.
   *
   * These assertions were written against `PerformanceRow` when it drew its own
   * card, and they failed the moment that moved into the shared `StatCard` —
   * correctly, because a source-text check is a claim about where the behaviour
   * lives. Repointing them is the fix; deleting them because "it still works"
   * would leave the reports page, which now renders through the same card,
   * unguarded.
   */
  const CARD = read('components/product/StatCard.tsx')

  it('is rendered by the dashboard, not merely written', () => {
    // The defect class this repo keeps finding: correct code nothing renders.
    expect(PAGE).toContain('<PerformanceRow data={performance} />')
    expect(PAGE).toContain('getOverviewPerformance(')
  })

  it('is gated on the CRM permission before it reads anything', () => {
    expect(PAGE).toMatch(/can\(policy, 'crm\.contact\.view'\)/)
  })

  it('sits above the usage row, because outcomes outrank consumption', () => {
    expect(PAGE.indexOf('<PerformanceRow')).toBeLessThan(
      PAGE.indexOf('aria-label="Usage this period"'),
    )
  })

  it('ships all three states', () => {
    for (const state of ["'unavailable'", "'pending'"]) {
      expect(ROW, `no ${state} state`).toContain(state)
    }
    expect(ROW).toMatch(/still being computed/)
    expect(ROW).toMatch(/could not be loaded/)
  })

  it('never animates in and never uses Reveal', () => {
    // CLAUDE.md: no entrance animations on product surfaces.
    for (const source of [ROW, CARD]) {
      expect(source).not.toContain('Reveal')
      expect(source).not.toMatch(/animate-(in|fade|slide)/)
    }
  })

  it('does not blur, per the condition on the relaxed gradient rule', () => {
    for (const source of [ROW, CARD]) expect(source).not.toContain('backdrop-')
  })

  it('carries direction without relying on colour', () => {
    // A triangle and a printed sign, so the change survives greyscale and a
    // screen reader identically. The ▲/▼ glyphs this replaced are announced by
    // some screen readers as "black up-pointing triangle".
    expect(CARD).toContain('<path')
    expect(CARD).toContain('sr-only')
    expect(CARD, 'a decorative triangle glyph is back').not.toMatch(/[▲▼]/)
  })

  it('states the baseline as well as the percentage', () => {
    // A percentage with no visible baseline is a number the reader cannot
    // judge; the reports grid shows "was N" and the badge carries it too.
    expect(CARD).toMatch(/previous\.toLocaleString\(\)/)
  })

  it('hardcodes no colour', () => {
    /*
     * The project rule, enforced globally by hard-rules; asserted here too
     * because a stat card is exactly where a "just this once" hex lands.
     */
    for (const source of [ROW, CARD]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(source).not.toMatch(/\b(rgb|hsl)a?\(/)
    }
  })

  it('is the only place a delta is rendered', () => {
    /*
     * ⚠️ THE POINT OF EXTRACTING IT. The reports page and the overview each
     * had their own change badge, both correct and subtly different. Two right
     * answers to one question is how `TASK_FOR` came to exist three times and
     * diverge (see lib/crm/metrics.ts), and a divergence here means a figure
     * that reads differently on two screens of the same product.
     */
    const REPORTS = read('app/(product)/crm/reports/page.tsx')
    expect(REPORTS).toContain('StatCard')
    expect(REPORTS, 'the reports page draws its own change badge again').not.toMatch(
      /[▲▼]/,
    )
    expect(REPORTS).not.toMatch(/text-success.*text-danger|change >= 0 \?/)
  })
})
