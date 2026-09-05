/**
 * Turns "when did the tick last run" into a verdict.
 *
 * WHY A PURE FUNCTION AND NOT AN INLINE COMPARISON IN THE PAGE
 *
 * The thresholds below are the whole product of this feature — everything else
 * is a table and a paragraph. They need a test, and a comparison buried in JSX
 * does not get one.
 */

export type SchedulerLevel = 'healthy' | 'delayed' | 'stale' | 'never'

export type SchedulerHealth = {
  level: SchedulerLevel
  label: string
  /** Sentence shown under the label. Says what to do when something is wrong. */
  detail: string
}

/**
 * The scheduler is a GitHub Actions workflow on a five-minute cron schedule.
 *
 * ⚠️ THE THRESHOLDS ARE DELIBERATELY LOOSE. GitHub treats a cron as a floor,
 * not a promise: it delays scheduled runs under load, sometimes by several
 * minutes, and drops them entirely during an incident. Alerting at 6 minutes
 * would cry wolf several times a week, and an alert nobody believes is worse
 * than no alert. 20 minutes means at least three consecutive misses.
 */
const DELAYED_AFTER_MS = 20 * 60_000
const STALE_AFTER_MS = 60 * 60_000

/** How the operator finds out why it stopped — the same three causes every time. */
const CAUSES =
  'Check that the Background tick workflow is enabled on the default branch, ' +
  'that CRON_SECRET is set in the repository secrets, and that GitHub has not ' +
  'disabled the schedule for inactivity.'

export function schedulerHealth(
  lastRunAt: string | null | undefined,
  now: Date = new Date(),
): SchedulerHealth {
  if (!lastRunAt) {
    return {
      level: 'never',
      label: 'Never run',
      detail: `No background tick has ever been recorded. ${CAUSES}`,
    }
  }

  const last = new Date(lastRunAt)
  if (Number.isNaN(last.getTime())) {
    /*
     * Unparseable is treated as unknown-and-bad rather than thrown. This panel
     * exists to report trouble; making it crash the admin page on bad input
     * would take out the only screen that can diagnose the problem.
     */
    return {
      level: 'never',
      label: 'Unknown',
      detail: `The last run time could not be read. ${CAUSES}`,
    }
  }

  /*
   * ⚠️ CLAMPED AT ZERO. The row is written with the DATABASE clock and compared
   * against the SERVER clock; a few seconds of skew the wrong way would
   * otherwise render "ran in -3 seconds".
   */
  const ageMs = Math.max(0, now.getTime() - last.getTime())

  if (ageMs >= STALE_AFTER_MS) {
    return {
      level: 'stale',
      label: `Last ran ${formatAge(ageMs)} ago`,
      detail: `The scheduler has stopped. Email is not being sent and replies are not being read. ${CAUSES}`,
    }
  }

  if (ageMs >= DELAYED_AFTER_MS) {
    return {
      level: 'delayed',
      label: `Last ran ${formatAge(ageMs)} ago`,
      detail:
        'Later than the five-minute schedule. GitHub delays scheduled runs under ' +
        'load, so this is usually temporary — worth watching, not yet acting on.',
    }
  }

  return {
    level: 'healthy',
    label: `Last ran ${formatAge(ageMs)} ago`,
    detail: 'Running on schedule.',
  }
}

/** Whole units only — this is a status line, not a stopwatch. */
export function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
