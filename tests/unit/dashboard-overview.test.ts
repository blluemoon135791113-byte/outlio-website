import { load } from 'cheerio'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(), workspace: vi.fn(), pipeline: vi.fn(), overdue: vi.fn(), rpc: vi.fn(),
}))

vi.mock('@/lib/auth/access', () => ({ requireAccess: mocks.access }))
vi.mock('@/lib/workspaces/context', () => ({ getWorkspaceContext: mocks.workspace }))
vi.mock('@/lib/crm/reports', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/crm/reports')>(),
  getPipelineTotals: mocks.pipeline,
  countOverdueTasks: mocks.overdue,
}))
vi.mock('@/lib/crm/overview', () => ({
  getHeadlineKpis: vi.fn(async () => ({ kind: 'pending' })),
  getOverviewPerformance: vi.fn(async () => ({ kind: 'pending' })),
  hasRealActivity: vi.fn(() => false),
}))
vi.mock('@/lib/extension/capture', () => ({ getActiveSession: vi.fn(async () => null) }))
vi.mock('@/lib/extension/devices', () => ({ countDevices: vi.fn(async () => 0) }))
vi.mock('@/lib/onboarding/steps', () => ({
  loadFirstRun: vi.fn(async () => null), shouldShowFirstRun: vi.fn(() => false),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => {
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (result: { count: number; error: null }) => unknown) =>
          Promise.resolve(resolve({ count: 1, error: null })),
      }
      return query
    },
  }),
}))
vi.mock('@/components/extension/ExtensionCard', () => ({ ExtensionCard: () => null }))
vi.mock('@/components/extension/LiveCapture', () => ({ LiveCapture: () => null }))
vi.mock('@/components/onboarding/FirstRun', () => ({ FirstRun: () => null }))
vi.mock('@/components/product/AnalyticsValidationPanel', () => ({ AnalyticsValidationPanel: () => null }))

import DashboardPage from '@/app/(product)/dashboard/page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({
    userId: 'user-fixture', email: 'member@example.com', accessExpiresAt: null,
    plan: {
      key: 'starter', name: 'Lead Engine',
      limits: { extractions_per_day: 10, extractions_per_month: 100, records_per_month: 1000, exports_per_month: null },
    },
    usage: { extractionsToday: 0, extractionsThisMonth: 1, recordsThisMonth: 0, exportsThisMonth: 0 },
  })
  mocks.workspace.mockResolvedValue({
    workspace: { id: 'workspace-fixture' }, role: 'manager', modules: new Set(['crm', 'reports']),
  })
  mocks.pipeline.mockResolvedValue({ openValue: 100, openDeals: 2, unconvertible: 0 })
  mocks.overdue.mockResolvedValue(3)
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'credit_balance' ? [{ remaining: 0, allowance: 100 }] : [], error: null,
  }))
})

const renderPage = async () => load(renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) })))

describe('a team reporting failure stays inside its overview panel', () => {
  it('keeps the dashboard and overdue count when the pipeline read fails', async () => {
    mocks.pipeline.mockRejectedValue(new Error('fixture pipeline failure'))
    const $ = await renderPage()
    const team = $('section[aria-label="Team activity"]')
    expect($('h1').text()).toBe('Overview')
    expect($('section[aria-label="Usage this period"]').length).toBe(1)
    expect(team.text()).toContain('Overdue tasks3')
    expect(team.text()).toContain('Open pipeline—')
    expect(team.find('[role="alert"]').text()).toContain('could not be loaded')
  })

  it('keeps pipeline figures when the overdue read fails', async () => {
    mocks.overdue.mockRejectedValue(new Error('fixture task failure'))
    const $ = await renderPage()
    const team = $('section[aria-label="Team activity"]')
    expect(team.text()).toContain('Open deals2')
    expect(team.text()).toContain('Overdue tasks—')
    expect(team.find('[role="alert"]').text()).toContain('could not be loaded')
  })

  it('shows an error, not an absent panel or invented zeros, when both reads fail', async () => {
    mocks.pipeline.mockRejectedValue(new Error('fixture pipeline failure'))
    mocks.overdue.mockRejectedValue(new Error('fixture task failure'))
    const $ = await renderPage()
    const team = $('section[aria-label="Team activity"]')
    expect(team.find('[role="alert"]').text()).toContain('could not be loaded')
    expect(team.text()).toContain('Open deals—')
  })

  it('still gates both reads for a setter', async () => {
    mocks.workspace.mockResolvedValue({
      workspace: { id: 'workspace-fixture' }, role: 'setter', modules: new Set(['crm', 'reports']),
    })
    const $ = await renderPage()
    expect(mocks.pipeline).not.toHaveBeenCalled()
    expect(mocks.overdue).not.toHaveBeenCalled()
    expect($('section[aria-label="Team activity"]')).toHaveLength(0)
  })

  it('keeps successful real zeros as numbers without an error', async () => {
    mocks.pipeline.mockResolvedValue({ openValue: 0, openDeals: 0, unconvertible: 0 })
    mocks.overdue.mockResolvedValue(0)
    const $ = await renderPage()
    const team = $('section[aria-label="Team activity"]')
    expect(team.text()).toContain('Open deals0')
    expect(team.find('[role="alert"]')).toHaveLength(0)
  })
})

describe('usage bars distinguish zero, nonzero, unlimited and unknown', () => {
  it('does not give zero usage or exhausted credits a nonzero progress bar', async () => {
    const $ = await renderPage()
    const widths = $('section[aria-label="Usage this period"] article').map((_, article) =>
      $(article).find('[style]').attr('style') ?? 'no bar').get()
    expect(widths).toEqual(['width:0%', 'width:0%', 'width:3%', 'width:0%', 'no bar'])
  })

  it('does not draw a bar for an unreadable credit balance', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'fixture failure' } })
    const $ = await renderPage()
    const credits = $('section[aria-label="Usage this period"] article').first()
    expect(credits.text()).toContain('Balance unavailable')
    expect(credits.find('[style]')).toHaveLength(0)
  })
})
