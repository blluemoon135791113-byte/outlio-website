/**
 * Reads a return date from a form, for routing availability.
 *
 * Shared by the admin control (Lead routing settings) and a member's own
 * (Profile), so both refuse the same dates with the same words.
 *
 * An empty value means available again. A date means away until the START of
 * that day, read in the server's timezone — the same rule snooze uses, because
 * no user or workspace timezone exists to read.
 *
 * ⚠️ PURE, AND NOT IN A 'use server' FILE. Every exported async function there
 * becomes a public endpoint; this takes `now` so it needs no clock of its own.
 */
const AWAY_MAX_MS = 2 * 365 * 24 * 60 * 60 * 1000

export function parseAwayDate(raw: string, now: Date): { awayUntil: string | null } | { error: string } {
  const value = raw.trim()
  if (value === '') return { awayUntil: null }

  const at = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : null
  if (!at || Number.isNaN(at.getTime())) return { error: 'Pick a return date.' }
  if (at.getTime() <= now.getTime() || at.getTime() > now.getTime() + AWAY_MAX_MS) {
    return { error: 'Pick a return date after today and within two years, or clear it.' }
  }
  return { awayUntil: at.toISOString() }
}
