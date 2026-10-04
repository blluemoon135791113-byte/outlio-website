import { load } from 'cheerio'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/crm/metrics', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/crm/metrics')>(),
  getMetricTotals: vi.fn(),
  getMetricSeries: vi.fn(),
  getLastRollupRun: vi.fn(),
}))

import { HeadlineRow } from '@/components/product/HeadlineRow'
import { StatCard } from '@/components/product/StatCard'
import { getLastRollupRun, getMetricSeries, getMetricTotals } from '@/lib/crm/metrics'
import { getHeadlineKpis } from '@/lib/crm/overview'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getLastRollupRun).mockResolvedValue({
    finishedAt: '2026-09-19T10:00:00Z', rowsWritten: 10, discrepancies: 0, error: null,
  })
  vi.mocked(getMetricSeries).mockResolvedValue({})
})

async function replyCard(now: [number, number], before: [number, number]) {
  const totals = ([emailed, replied]: [number, number]) => ({
    contacts_emailed: { count: emailed, amount: 0 },
    replies: { count: replied, amount: 0 },
  })
  vi.mocked(getMetricTotals)
    .mockResolvedValueOnce(totals(now))
    .mockResolvedValueOnce(totals(before))
  const data = await getHeadlineKpis('workspace-fixture', '7d')
  expect(data.kind).toBe('ready')
  const $ = load(renderToStaticMarkup(createElement(HeadlineRow, { data, range: '7d' })))
  return $('article').filter((_, element) => $(element).find('p').first().text() === 'Reply rate')
}

describe('reply-rate cards report percentage points, not relative percentages', () => {
  it.each([
    { now: [100, 30], before: [100, 20], change: '+10 pp', baseline: '20%' },
    { now: [100, 10], before: [100, 20], change: '−10 pp', baseline: '20%' },
    { now: [100, 10], before: [100, 0], change: '+10 pp', baseline: '0%' },
  ])('$before → $now shows $change', async ({ now, before, change, baseline }) => {
    const card = await replyCard(now as [number, number], before as [number, number])
    expect(card.text()).toContain(change)
    expect(card.text()).toContain(`from ${baseline} in the previous period`)
    expect(card.text()).not.toContain('New')
  })

  it.each([
    { now: [0, 0], before: [0, 0], value: '—' },
    { now: [0, 0], before: [100, 0], value: '—' },
    { now: [100, 0], before: [0, 0], value: '0%' },
  ])('does not label an unavailable or zero rate New: $now / $before', async ({ now, before, value }) => {
    const card = await replyCard(now as [number, number], before as [number, number])
    expect(card.text()).toContain(value)
    expect(card.text()).not.toContain('New')
    expect(card.text()).not.toContain('No change')
  })

  it('still labels the first positive rate New when the prior rate is unavailable', async () => {
    expect((await replyCard([100, 10], [0, 0])).text()).toContain('New')
  })

  it('shows No change when both periods have a measured zero rate', async () => {
    expect((await replyCard([100, 0], [100, 0])).text()).toContain('No change')
  })

  it('does not draw raw reply counts under a rate (varying volume is not a varying rate)', async () => {
    vi.mocked(getMetricSeries).mockResolvedValue({
      replies: [1, 10, 2], contacts_emailed: [10, 100, 20],
    })
    const card = await replyCard([130, 13], [100, 10])
    expect(card.html()).not.toContain('sparkline-')
  })

  it('keeps relative percent changes and numeric New inference for ordinary count cards', () => {
    const draw = (value: number, change: number | null, previous: number) =>
      load(renderToStaticMarkup(createElement(StatCard, {
        label: 'Contacts', value, delta: { change, previous },
      }))).text()
    expect(draw(30, 0.5, 20)).toContain('+50%')
    expect(draw(1, null, 0)).toContain('New')
    expect(draw(0, null, 0)).not.toContain('New')
  })
})
