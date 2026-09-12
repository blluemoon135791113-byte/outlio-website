/**
 * The snooze date picker offers only days the server will accept.
 *
 * ⚠️ A FORM THAT OFFERS A DATE THE SERVER THEN REFUSES teaches people to
 * distrust the form. 0126 accepts a snooze strictly after now and no later than
 * now + 365 days; the action reads the chosen day as its start. So the picker
 * starts tomorrow and stops at day 364, leaving room for a timezone offset at
 * both ends.
 *
 * Fixtures are fabricated.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const { snoozeBounds } = await import('@/lib/crm/my-work')

describe('snoozeBounds', () => {
  it('runs from tomorrow to 364 days out', () => {
    expect(snoozeBounds(new Date('2026-09-14T12:00:00.000Z'))).toEqual({
      minSnoozeDate: '2026-09-15',
      // Sept 2026 → Sept 2027 spans February 2027, which has 28 days, so 365
      // days lands on 2027-09-14 and 364 on the day before.
      maxSnoozeDate: '2027-09-13',
    })
  })

  it('never offers today', () => {
    // Just before midnight UTC: "tomorrow" must still be the next calendar day,
    // not today with a late time that is already in the past by the start of it.
    const { minSnoozeDate } = snoozeBounds(new Date('2026-09-14T23:59:00.000Z'))
    expect(minSnoozeDate).toBe('2026-09-15')
  })

  it('stays inside the 365-day bound the database enforces', () => {
    const now = new Date('2026-02-28T08:00:00.000Z')
    const { maxSnoozeDate } = snoozeBounds(now)

    const startOfLastDay = new Date(`${maxSnoozeDate}T00:00:00.000Z`).getTime()
    expect(startOfLastDay).toBeLessThanOrEqual(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  })
})
