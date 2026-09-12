/**
 * The registry, the SQL and the dashboard must name the same metrics.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A REGISTRY THAT IS JUST A SECOND COPY OF THE LIST IS WORSE THAN NONE.    ║
 * ║                                                                           ║
 * ║  Two copies of a list agree on the day they are written and drift         ║
 * ║  afterwards — `TASK_FOR` existed three times in this codebase and all     ║
 * ║  three diverged. So this file does not check the registry against         ║
 * ║  itself: it reads migration 0082 and `lib/crm/metrics.ts` and asserts     ║
 * ║  all three agree, in both directions.                                     ║
 * ║                                                                           ║
 * ║  ⚠️ WHAT A DISAGREEMENT COSTS: `totals[metric]?.count ?? 0`. A metric the  ║
 * ║  SQL never writes is absent from the map and renders as a confident 0.    ║
 * ║  The dashboard says "0 calls held" and nothing anywhere errors. 0082's    ║
 * ║  own comment warns that adding a metric does not get it checked; this is  ║
 * ║  the check.                                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { replyRate } from '@/lib/crm/metrics'
import {
  BASE_METRICS,
  BASE_METRIC_IDS,
  DERIVED_METRICS,
  evaluateDerived,
  evaluateFormula,
  isBaseMetricId,
  metricsUsedBy,
  type Formula,
} from '@/lib/reporting/registry'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const SQL = read('supabase/migrations/0082_reporting_aggregates.sql')
const METRICS_TS = read('lib/crm/metrics.ts')

/**
 * Metric names the SQL actually writes.
 *
 * ⚠️ COMMENTS STRIPPED FIRST. 0082 discusses metric names in prose — including
 * a whole paragraph about `contacts_emailed` and reply rates — and matching
 * those would make every assertion below pass against documentation rather
 * than against the rollup. Comment-matching has bitten six guards here.
 */
const sqlWithoutComments = SQL.replace(/--[^\n]*/g, '')

/**
 * Values of `crm_reporting_daily.basis`, not metrics.
 *
 * ⚠️ EXCLUDED BECAUSE THE `won_deals` INSERT LISTS BOTH AS BARE LITERALS, one
 * line apart: `'owner',` then `'won_deals',`. The bare-string pattern below
 * cannot tell a basis column from a metric column, so it reported `owner` as
 * an unregistered metric. Naming the exclusion is honest; widening the
 * registry to contain `owner` would have been the convenient lie.
 */
const BASIS_LITERALS = new Set(['actor', 'owner', 'workspace'])

/** `then 'metric'`, `'metric' as metric` and the bare `'won_deals',` insert. */
const sqlMetricNames = new Set<string>(
  [
    ...[...sqlWithoutComments.matchAll(/then\s+'([a-z_]+)'/g)].map((m) => m[1]!),
    ...[...sqlWithoutComments.matchAll(/'([a-z_]+)'\s+as\s+metric/g)].map((m) => m[1]!),
    ...[...sqlWithoutComments.matchAll(/^\s*'([a-z_]+)',\s*$/gm)].map((m) => m[1]!),
  ].filter((name) => !BASIS_LITERALS.has(name)),
)

/**
 * The `checked (metric_name) as (values ...)` list the reconciler recounts.
 *
 * ⚠️ ANCHORED ON THE BLOCK TERMINATOR, NOT THE FIRST `),`. The obvious
 * non-greedy `([\s\S]*?)\)\s*,` stops at `('emails_sent'),` — the first entry —
 * and reported seven correctly-flagged metrics as wrong. A scanner's first
 * draft accusing correct code has happened here eight times now; the vacuity
 * assertions below are what caught it.
 */
const reconciledInSql = (() => {
  const block = sqlWithoutComments.match(
    /checked\s*\(metric_name\)\s*as\s*\(([\s\S]*?)\n\s*\)\s*,/,
  )
  if (!block) return new Set<string>()
  return new Set([...block[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!))
})()

/** Metric names the dashboard reads by string literal, via its `n(...)` helper. */
const readByDashboard = new Set<string>(
  [...METRICS_TS.matchAll(/n\((?:actor|owner|workspace),\s*'([a-z_]+)'\)/g)].map((m) => m[1]!),
)

describe('the scanners can see what they police', () => {
  /*
   * Without these three, a rename in the SQL or a refactor of the dashboard's
   * helper makes every assertion below pass against an empty set — which is
   * this project's signature defect, not a passing test.
   */
  it('found metric names in the SQL', () => {
    expect(sqlMetricNames.size).toBeGreaterThanOrEqual(13)
    expect(sqlMetricNames.has('won_deals')).toBe(true)
  })

  it('found the reconciler’s checked list', () => {
    expect(reconciledInSql.size).toBeGreaterThanOrEqual(8)
    expect(reconciledInSql.has('replies')).toBe(true)
  })

  it('found the names the dashboard reads', () => {
    expect(readByDashboard.size).toBeGreaterThanOrEqual(13)
    expect(readByDashboard.has('calls_held')).toBe(true)
  })

  it('does not count a metric named only in a comment', () => {
    expect(sqlWithoutComments).not.toContain('Adding a metric to the rollup')
  })
})

describe('registry ↔ migration 0082', () => {
  it('every registry metric is written by the rollup', () => {
    const missing = BASE_METRIC_IDS.filter((id) => !sqlMetricNames.has(id))
    expect(
      missing,
      'The registry names metrics the SQL never writes. Each would read as a ' +
        'confident 0 on the dashboard:\n' + missing.join('\n'),
    ).toEqual([])
  })

  it('every metric the rollup writes is in the registry', () => {
    const unregistered = [...sqlMetricNames].filter((name) => !isBaseMetricId(name))
    expect(
      unregistered,
      'The rollup writes metrics the registry does not name, so nothing ' +
        'describes where they come from or whether they are reconciled:\n' +
        unregistered.join('\n'),
    ).toEqual([])
  })

  it('the reconciled flag matches the reconciler’s own list', () => {
    /*
     * Five of thirteen are deliberately unreconciled. Recording that as a flag
     * is only useful if the flag is true; a stale `reconciled: true` would
     * claim a number is cross-checked when it is not.
     */
    const wrong = BASE_METRIC_IDS.filter(
      (id) => BASE_METRICS[id].reconciled !== reconciledInSql.has(id),
    )
    expect(
      wrong.map((id) => `${id}: registry says ${BASE_METRICS[id].reconciled}`),
      'reconciled flags disagree with 0082’s checked list',
    ).toEqual([])
  })

  it('records exactly the five metrics the reconciler skips', () => {
    const unreconciled = BASE_METRIC_IDS.filter((id) => !BASE_METRICS[id].reconciled).sort()
    expect(unreconciled).toEqual([
      'calls_held',
      'follow_ups',
      'personalized_dms',
      'qualified',
      'won_deals',
    ])
  })
})

describe('registry ↔ the dashboard', () => {
  it('every metric the dashboard reads is in the registry', () => {
    const unregistered = [...readByDashboard].filter((name) => !isBaseMetricId(name))
    expect(
      unregistered,
      'The dashboard reads metric names the registry does not know:\n' +
        unregistered.join('\n'),
    ).toEqual([])
  })

  it('won_deals is owner-basis, because reading it as actor returns nothing', () => {
    // The SQL credits outcomes to whoever OWNED the record, not the actor.
    expect(BASE_METRICS.won_deals.basis).toBe('owner')
    expect(METRICS_TS).toContain("n(owner, 'won_deals')")
  })

  it('the three distinct-contact metrics are marked as such', () => {
    const distinct = BASE_METRIC_IDS.filter(
      (id) => BASE_METRICS[id].countMode === 'distinct_contacts',
    ).sort()
    // Four emails to one person is ONE contact emailed (Ledger §20).
    expect(distinct).toEqual(['contacts_emailed', 'qualified', 'replies'])
  })
})

describe('the formula grammar', () => {
  const totals = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { count: v, amount: 0 }]))

  /*
   * ⚠️ EXPLICIT VALUES, NOT PARITY WITH `replyRate`. An earlier version of this
   * test asserted `evaluateDerived('reply_rate', t) === replyRate(t)`, which was
   * meaningful only while the two were separate implementations. `replyRate`
   * now DELEGATES to the registry, so that assertion compares a function to
   * itself and passes no matter what either does — vacuous, and in the way this
   * project keeps being caught by.
   *
   * These numbers are the contract instead: 3 replies from 10 contacts emailed
   * is 0.3, and nobody emailed has no rate at all.
   */
  it('computes the rate the dashboard shows', () => {
    expect(evaluateDerived('reply_rate', totals({ replies: 3, contacts_emailed: 10 }))).toBe(0.3)
    expect(evaluateDerived('reply_rate', totals({ replies: 10, contacts_emailed: 10 }))).toBe(1)
    expect(evaluateDerived('reply_rate', totals({ replies: 0, contacts_emailed: 10 }))).toBe(0)
    expect(evaluateDerived('reply_rate', totals({ replies: 0, contacts_emailed: 0 }))).toBeNull()
  })

  it('and replyRate returns exactly that, because it is the same definition', () => {
    // Guards the delegation itself: if `replyRate` grows its own arithmetic
    // again, these diverge and the dashboard shows one of two answers.
    const t = totals({ replies: 3, contacts_emailed: 10 })
    expect(replyRate(t)).toBe(0.3)
    expect(replyRate(totals({ replies: 1, contacts_emailed: 0 }))).toBeNull()
  })

  it('a zero denominator is null — never 0, never Infinity, never NaN', () => {
    const value = evaluateDerived('reply_rate', totals({ replies: 5, contacts_emailed: 0 }))
    expect(value).toBeNull()
    expect(Number.isNaN(value as number)).toBe(false)
  })

  it('null propagates rather than being treated as zero', () => {
    const formula: Formula = {
      op: 'add',
      left: { op: 'div', left: { op: 'const', value: 1 }, right: { op: 'const', value: 0 } },
      right: { op: 'const', value: 100 },
    }
    // 1/0 is unanswerable, so the sum is unanswerable — not 100.
    expect(evaluateFormula(formula, {})).toBeNull()
  })

  it('an absent metric is 0, because the rollup writes no row for a real zero', () => {
    // Distinct from the null case above: the query succeeded and found none.
    expect(evaluateFormula({ op: 'metric', id: 'replies' }, {})).toBe(0)
  })

  it('reports which base metrics a formula needs', () => {
    expect(metricsUsedBy(DERIVED_METRICS.reply_rate.formula).sort()).toEqual([
      'contacts_emailed',
      'replies',
    ])
  })

  it('has no way to turn a string into a formula', () => {
    /*
     * §5.14: no user SQL, no `eval`. The grammar is constructible only in
     * TypeScript, which is what makes injection impossible rather than merely
     * unlikely. A future `parseFormula(text)` would need this test updated,
     * and that should be a conversation.
     */
    const source = read('lib/reporting/registry.ts')
    for (const forbidden of ['eval(', 'new Function', 'JSON.parse']) {
      expect(source, `${forbidden} must not appear in the registry`).not.toContain(forbidden)
    }
  })
})
