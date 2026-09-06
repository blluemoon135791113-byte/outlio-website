import { describe, expect, it } from 'vitest'

import { formatAge, schedulerHealth } from '@/lib/admin/scheduler-health'

const NOW = new Date('2026-09-05T12:00:00.000Z')

/** A timestamp `minutes` before NOW. */
function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString()
}

describe('schedulerHealth', () => {
  it('reports never-run when the table is empty', () => {
    // The state before the first tick, and also the state when the workflow
    // has never successfully authenticated. Both need to be loud.
    const health = schedulerHealth(null, NOW)
    expect(health.level).toBe('never')
    expect(health.detail).toContain('CRON_SECRET')
  })

  it('is healthy for a tick within the last few minutes', () => {
    expect(schedulerHealth(ago(3), NOW).level).toBe('healthy')
  })

  it('tolerates GitHub running late without crying wolf', () => {
    // GitHub delays scheduled runs under load. 12 minutes is two missed slots
    // and routine; escalating here would produce alerts nobody believes.
    expect(schedulerHealth(ago(12), NOW).level).toBe('healthy')
  })

  it('flags delayed at 20 minutes and stale at an hour', () => {
    expect(schedulerHealth(ago(20), NOW).level).toBe('delayed')
    expect(schedulerHealth(ago(59), NOW).level).toBe('delayed')
    expect(schedulerHealth(ago(60), NOW).level).toBe('stale')
    expect(schedulerHealth(ago(60 * 30), NOW).level).toBe('stale')
  })

  it('says outbound email has stopped when stale, because that is the consequence', () => {
    // The point of the panel: not "a job is late" but "your product is not
    // working". An operator who reads only this sentence must still act.
    const health = schedulerHealth(ago(180), NOW)
    expect(health.detail).toContain('Email is not being sent')
  })

  it('never renders a negative age when the database clock leads the server', () => {
    /*
     * The row is written with the DATABASE clock and compared here against the
     * SERVER clock. A few seconds of skew the wrong way must not produce
     * "ran in -4 seconds", and must not be mistaken for staleness either.
     */
    const future = new Date(NOW.getTime() + 4_000).toISOString()
    const health = schedulerHealth(future, NOW)
    expect(health.level).toBe('healthy')
    expect(health.label).not.toContain('-')
  })

  it('treats an unparseable timestamp as unknown rather than throwing', () => {
    // This panel is the tool for diagnosing a broken scheduler; it must not be
    // the thing that takes the admin page down.
    expect(() => schedulerHealth('not a date', NOW)).not.toThrow()
    expect(schedulerHealth('not a date', NOW).level).toBe('never')
  })
})

describe('formatAge', () => {
  it('singularises one unit', () => {
    expect(formatAge(1_000)).toBe('1 second')
    expect(formatAge(60_000)).toBe('1 minute')
    expect(formatAge(3_600_000)).toBe('1 hour')
    expect(formatAge(86_400_000)).toBe('1 day')
  })

  it('steps up units at the boundary rather than reporting 90 minutes', () => {
    expect(formatAge(59_000)).toBe('59 seconds')
    expect(formatAge(90 * 60_000)).toBe('1 hour')
    expect(formatAge(36 * 3_600_000)).toBe('1 day')
    expect(formatAge(72 * 3_600_000)).toBe('3 days')
  })
})
