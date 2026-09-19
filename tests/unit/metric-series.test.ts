/**
 * The numbers behind a sparkline.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A CHART IS THE EASIEST PLACE IN A PRODUCT TO DRAW SOMETHING THAT     ║
 * ║  MEANS NOTHING.                                                           ║
 * ║                                                                           ║
 * ║  A pleasing curve is the default output of every charting library whether ║
 * ║  or not the data supports one, and nobody audits a 96-pixel line the way  ║
 * ║  they audit a figure. CLAUDE.md rule 4 governs a drawn shape exactly as   ║
 * ║  it governs a stored field, so these assert the two things that decide    ║
 * ║  whether the line is honest: that every point is a stored row, and that   ║
 * ║  the x-axis is the same for every card in a row.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = { data: unknown; error: unknown }
type Call = { table: string; filters: Record<string, unknown> }

const replies = new Map<string, Reply>()
const asked: Call[] = []

function builder(table: string) {
  const call: Call = { table, filters: {} }
  const thenable = {
    select: () => thenable,
    eq: (k: string, v: unknown) => {
      call.filters[k] = v
      return thenable
    },
    in: (k: string, v: unknown) => {
      call.filters[`in:${k}`] = v
      return thenable
    },
    is: (k: string, v: unknown) => {
      call.filters[`is:${k}`] = v
      return thenable
    },
    gte: (k: string, v: unknown) => {
      call.filters[`gte:${k}`] = v
      return thenable
    },
    lte: (k: string, v: unknown) => {
      call.filters[`lte:${k}`] = v
      return thenable
    },
    then: (resolve: (r: Reply) => unknown) => {
      asked.push(call)
      return Promise.resolve(replies.get(table) ?? { data: [], error: null }).then(resolve)
    },
  }
  return thenable
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}))

const { getMetricSeries } = await import('@/lib/crm/metrics')

beforeEach(() => {
  replies.clear()
  asked.length = 0
})

const row = (day: string, metric: string, count: number) => ({
  day,
  metric,
  count_value: count,
})

describe('the double is wired, so a pass means something', () => {
  it('returns a value for every metric it was asked about', async () => {
    replies.set('crm_reporting_daily', {
      data: [row('2026-01-02', 'emails_sent', 5)],
      error: null,
    })

    const series = await getMetricSeries('w1', {
      fromDay: '2026-01-01',
      toDay: '2026-01-03',
      basis: 'workspace',
      metrics: ['emails_sent', 'replies'],
    })

    expect(Object.keys(series).sort()).toEqual(['emails_sent', 'replies'])
    expect(series.emails_sent).toEqual([0, 5, 0])
  })
})

describe('the x-axis comes from the range, not from the rows', () => {
  /*
   * ⚠️ THE ONE THAT MAKES TWO CARDS COMPARABLE. Built from the rows that came
   * back, a quiet metric would be drawn across fewer points than a busy one —
   * so the same movement would look steeper on the quiet card, and the two
   * lines sitting side by side would be on different horizontal scales with
   * nothing to say so.
   */
  it('gives every metric the same number of points', async () => {
    replies.set('crm_reporting_daily', {
      data: [
        // Busy metric: something every day.
        row('2026-01-01', 'emails_sent', 3),
        row('2026-01-02', 'emails_sent', 4),
        row('2026-01-03', 'emails_sent', 5),
        // Quiet metric: one day only.
        row('2026-01-02', 'replies', 1),
      ],
      error: null,
    })

    const series = await getMetricSeries('w1', {
      fromDay: '2026-01-01',
      toDay: '2026-01-03',
      basis: 'workspace',
      metrics: ['emails_sent', 'replies'],
    })

    expect(series.emails_sent).toHaveLength(3)
    expect(series.replies).toHaveLength(3)
    expect(series.replies).toEqual([0, 1, 0])
  })

  it('covers the whole range even when nothing was recorded', async () => {
    replies.set('crm_reporting_daily', { data: [], error: null })

    const series = await getMetricSeries('w1', {
      fromDay: '2026-01-01',
      toDay: '2026-01-05',
      basis: 'workspace',
      metrics: ['replies'],
    })

    // Five real zeroes — the rollup ran and nothing happened. `Sparkline`
    // refuses to draw a flat line from this, which is the honest outcome.
    expect(series.replies).toEqual([0, 0, 0, 0, 0])
  })

  /*
   * ⚠️ STEPPED IN UTC MILLISECONDS, NOT BY MUTATING A LOCAL `Date`. Adding one
   * to `getDate()` lands on the wrong day across a daylight-saving boundary, so
   * twice a year a series would silently drop or repeat a day — a fault nobody
   * notices and nobody can reproduce on demand.
   */
  it('does not lose or repeat a day across a daylight-saving boundary', async () => {
    replies.set('crm_reporting_daily', { data: [], error: null })

    // Europe/London springs forward on 2026-03-29.
    const series = await getMetricSeries('w1', {
      fromDay: '2026-03-27',
      toDay: '2026-03-31',
      basis: 'workspace',
      metrics: ['replies'],
    })

    expect(series.replies).toHaveLength(5)
  })
})

describe('rows outside the range', () => {
  it('ignores a day the range does not cover', async () => {
    replies.set('crm_reporting_daily', {
      data: [row('2025-12-31', 'replies', 99), row('2026-01-02', 'replies', 2)],
      error: null,
    })

    const series = await getMetricSeries('w1', {
      fromDay: '2026-01-01',
      toDay: '2026-01-03',
      basis: 'workspace',
      metrics: ['replies'],
    })

    // The 99 is dropped rather than folded into the first point, which would
    // put last year's activity at the start of this month's line.
    expect(series.replies).toEqual([0, 2, 0])
  })
})

describe('scoping', () => {
  it('reads workspace rows with a null user, never a user id', async () => {
    replies.set('crm_reporting_daily', { data: [], error: null })

    await getMetricSeries('w1', {
      fromDay: '2026-01-01',
      toDay: '2026-01-03',
      basis: 'workspace',
      metrics: ['replies'],
    })

    const call = asked[0]!
    expect(call.filters.workspace_id).toBe('w1')
    expect(call.filters.basis).toBe('workspace')
    // `user_id is null` is what distinguishes a workspace total from a member's.
    expect(call.filters['is:user_id']).toBeNull()
    expect(call.filters.user_id).toBeUndefined()
  })

  /*
   * ⚠️ A SPARKLINE ON THE ACTOR BASIS MUST CARRY THE USER. Without it the line
   * under one person's figure would be drawn from the whole workspace — a
   * picture of somebody else's month, and entirely plausible.
   */
  it('reads actor rows for one member', async () => {
    replies.set('crm_reporting_daily', { data: [], error: null })

    await getMetricSeries('w1', {
      fromDay: '2026-01-01',
      toDay: '2026-01-03',
      basis: 'actor',
      userId: 'u1',
      metrics: ['replies'],
    })

    const call = asked[0]!
    expect(call.filters.basis).toBe('actor')
    expect(call.filters.user_id).toBe('u1')
    expect(call.filters['is:user_id']).toBeUndefined()
  })
})

describe('nothing asked, nothing read', () => {
  it('makes no query for an empty metric list', async () => {
    const series = await getMetricSeries('w1', {
      fromDay: '2026-01-01',
      toDay: '2026-01-03',
      basis: 'workspace',
      metrics: [],
    })

    expect(series).toEqual({})
    expect(asked).toHaveLength(0)
  })
})
