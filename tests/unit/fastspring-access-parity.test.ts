/**
 * The TypeScript and SQL definitions of "this subscription grants access" must
 * agree, for every input.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `lib/fastspring/access.ts` SAYS: "This mirrors                          ║
 * ║  `public.fastspring_subscription_grants_access` in SQL. Both must change  ║
 * ║  together."                                                              ║
 * ║                                                                           ║
 * ║  Nothing made that true. The SQL function is the LIVE one — 0068 calls it ║
 * ║  in two places to decide whether a paying customer has access. The        ║
 * ║  TypeScript function is imported by nothing at all, which Phase 0.5's     ║
 * ║  orphan-module guard is how we found it.                                 ║
 * ║                                                                           ║
 * ║  ⚠️ A DEAD MIRROR IS WORSE THAN NO MIRROR. It reads as a second opinion   ║
 * ║  that agrees, so someone changing the billing rule reasonably updates the ║
 * ║  file they can see — TypeScript — and ships nothing, because the SQL is   ║
 * ║  what runs. The failure mode is a billing rule that looks changed and is  ║
 * ║  not, and it would surface as customers keeping or losing access wrongly. ║
 * ║                                                                           ║
 * ║  So this file does not delete the mirror. It makes it load-bearing.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fastSpringSubscriptionGrantsAccess } from '@/lib/fastspring/access'

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations')

const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n')

/**
 * The states the SQL function accepts, read out of its body.
 *
 * ⚠️ PARSED FROM THE MIGRATION, NEVER HARD-CODED HERE. A copy of the list in
 * this file would be a third definition of the same rule, and then two of the
 * three could drift while the test stayed green.
 */
function sqlAcceptedStates(): string[] {
  /*
   * The LAST definition wins — `create or replace` means an earlier migration's
   * version is not what runs, and this rule has exactly the shape that made
   * migration 0070 delete the signup gate.
   */
  const all = [
    ...SQL.matchAll(
      /create or replace function public\.fastspring_subscription_grants_access[\s\S]*?\$\$([\s\S]*?)\$\$;/g,
    ),
  ]
  const body = all.at(-1)?.[1] ?? ''
  const list = body.match(/p_state in \(([^)]*)\)/)
  if (!list) return []
  return [...list[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!)
}

/** Every state either side might see, including ones both should reject. */
const ALL_STATES = ['active', 'trial', 'overdue', 'canceled', 'deactivated', 'nonsense']

describe('the scanner itself', () => {
  it('finds the SQL definition', () => {
    // Without this, a rename makes every assertion below vacuous against [].
    const states = sqlAcceptedStates()
    expect(states.length).toBeGreaterThan(0)
    expect(states).toContain('active')
  })
})

describe('TypeScript and SQL agree', () => {
  const accepted = new Set(sqlAcceptedStates())

  for (const state of ALL_STATES) {
    for (const active of [true, false]) {
      it(`state=${state} active=${active}`, () => {
        /*
         * The SQL is `coalesce(p_active, false) and p_state in (...)`, so an
         * inactive subscription is denied whatever its state — which is the
         * half people get wrong, because `canceled` being ACCEPTED looks like
         * a bug until you know FastSpring keeps a cancelled subscription
         * usable until the paid period ends.
         */
        const sqlSays = active && accepted.has(state)
        expect(
          fastSpringSubscriptionGrantsAccess(state, active),
          `lib/fastspring/access.ts and public.fastspring_subscription_grants_access ` +
            `disagree for state="${state}", active=${active}. The SQL is what runs — ` +
            `0068 calls it to decide whether a paying customer has access — so a ` +
            `change made only in TypeScript ships nothing, and a change made only in ` +
            `SQL leaves this file lying about the rule.`,
        ).toBe(sqlSays)
      })
    }
  }

  it('rejects an inactive subscription in every state', () => {
    for (const state of ALL_STATES) {
      expect(fastSpringSubscriptionGrantsAccess(state, false)).toBe(false)
    }
  })

  it('still accepts canceled-but-paid, which looks wrong and is not', () => {
    // FastSpring sends `state: 'canceled'` with `active: true` for the rest of
    // the period the customer already paid for. Denying it would cut off
    // service somebody has paid for.
    expect(fastSpringSubscriptionGrantsAccess('canceled', true)).toBe(true)
  })
})
