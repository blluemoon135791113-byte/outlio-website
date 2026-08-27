import 'server-only'

/**
 * Daily search budget, per engine.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  WHY A BUDGET EXISTS AT ALL.                                             ║
 * ║                                                                          ║
 * ║  Every live search engine here is capped: Google CSE at 100 queries a    ║
 * ║  day, Brave at roughly 66, Tavily by whatever was paid for. When a cap   ║
 * ║  is reached the engine answers 429, the waterfall swallows it, and the   ║
 * ║  result is INDISTINGUISHABLE FROM A COMPANY NOBODY HAS WRITTEN ABOUT.    ║
 * ║                                                                          ║
 * ║  That is the failure this file prevents. Spending is counted BEFORE the  ║
 * ║  request, so the last few queries of the day are still available to a    ║
 * ║  user asking a question interactively rather than being consumed by a    ║
 * ║  batch that started at 3am.                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Counting reuses `consume_rate_limit` — one atomic statement, already
 * deployed, already correct under concurrency. A search budget is a rate limit
 * with a 24-hour window; a second counting mechanism would be duplication.
 */
import { createAdminClient } from '@/lib/supabase/admin'

const DAY_SECONDS = 24 * 60 * 60

export type EngineBudget = {
  /** Queries permitted per UTC day. `null` means uncapped. */
  perDay: number | null
  /**
   * Whether exhausting this engine costs money rather than goodwill.
   *
   * Load-bearing during an outage: see `reserveSearch`.
   */
  metered: boolean
}

/**
 * Defaults reflect each vendor's published free tier, minus nothing.
 *
 * They are deliberately the REAL cap rather than a safety margin: the point is
 * to know when the tier is spent, not to leave part of it unused. An operator
 * who wants headroom sets the environment variable.
 */
const DEFAULT_BUDGETS: Record<string, EngineBudget> = {
  // 100 queries/day on the free Custom Search JSON API.
  'google-cse': { perDay: 100, metered: false },
  // 2,000 queries/month ≈ 66/day.
  brave: { perDay: 66, metered: false },
  // Paid per call. No free tier to reason about, so the default is deliberately
  // small — an unbounded default on a metered vendor is how bills happen.
  tavily: { perDay: 200, metered: true },
  // Operator-owned or keyless. Costs a request, not a credit.
  solr: { perDay: null, metered: false },
  'web-research-mcp': { perDay: null, metered: false },
  mojeek: { perDay: null, metered: false },
}

function envBudget(engine: string): number | null | undefined {
  const key = `SERP_BUDGET_${engine.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
  const raw = process.env[key]?.trim()
  if (!raw) return undefined
  if (raw.toLowerCase() === 'unlimited') return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function budgetFor(engine: string): EngineBudget {
  const base = DEFAULT_BUDGETS[engine] ?? { perDay: null, metered: false }
  const override = envBudget(engine)
  return override === undefined ? base : { ...base, perDay: override }
}

function windowStart(now = Date.now()): Date {
  const ms = DAY_SECONDS * 1000
  return new Date(Math.floor(now / ms) * ms)
}

export type Reservation = { allowed: boolean; reason: 'ok' | 'exhausted' | 'unavailable' }

/**
 * Claims one query against today's allowance for an engine.
 *
 * ⚠️ FAILURE DIRECTION DEPENDS ON WHAT EXHAUSTION COSTS.
 *
 * If the counter itself is unreachable, a METERED engine is denied — an outage
 * in our database must never become unbounded spending at a vendor. A free
 * engine is allowed through, because denying it would take search down over a
 * bookkeeping problem, and the worst case is bumping a free tier a little
 * early, which the vendor already handles by answering 429.
 */
export async function reserveSearch(
  engine: string,
  now: Date = new Date(),
): Promise<Reservation> {
  const budget = budgetFor(engine)
  if (budget.perDay === null) return { allowed: true, reason: 'ok' }
  if (budget.perDay === 0) return { allowed: false, reason: 'exhausted' }

  try {
    const { data, error } = await createAdminClient().rpc('consume_rate_limit', {
      p_bucket: 'serp:daily',
      p_subject: engine,
      p_window_start: windowStart(now.getTime()).toISOString(),
      p_max_attempts: budget.perDay,
      // Blocked for the remainder of the window. A shorter block would expire
      // mid-day and, because the trip condition requires `blocked_until` to be
      // null, would never re-arm — the allowance would leak for the rest of
      // the day.
      p_block_seconds: DAY_SECONDS,
    })

    if (error) {
      return budget.metered
        ? { allowed: false, reason: 'unavailable' }
        : { allowed: true, reason: 'unavailable' }
    }

    const row = Array.isArray(data) ? data[0] : null
    const blockedUntil = row?.blocked_until ? Date.parse(row.blocked_until) : null
    const blocked = blockedUntil !== null && blockedUntil > now.getTime()
    return blocked ? { allowed: false, reason: 'exhausted' } : { allowed: true, reason: 'ok' }
  } catch {
    return budget.metered
      ? { allowed: false, reason: 'unavailable' }
      : { allowed: true, reason: 'unavailable' }
  }
}
