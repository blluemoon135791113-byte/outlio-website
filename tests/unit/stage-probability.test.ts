/**
 * A blank probability is a question, not a zero — A9.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE DEFECT.                                                              ║
 * ║                                                                           ║
 * ║  The setup form used `Number(value) || 0`, so clearing the probability    ║
 * ║  box — the natural way to say "I have not decided" — stored a deliberate  ║
 * ║  0%. A stage at 0% contributes nothing to the weighted forecast           ║
 * ║  (`sum(value_amount * probability / 100)` in 0084), so the whole stage    ║
 * ║  reads as "these deals will not close" rather than "nobody said".         ║
 * ║                                                                           ║
 * ║  `default_probability` is `not null default 0` and genuinely cannot hold  ║
 * ║  unknown. So the fix is not to invent a representation — it is to REFUSE  ║
 * ║  the blank and ask, because a forecast built from figures people meant is ║
 * ║  the only kind worth showing.                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ PROVEN NON-VACUOUS BY BREAKING IT (§2.1): restoring `Number(raw) || 0` in
 * `parseStageProbability` fails "a blank field is not a decision" — the
 * returned 0 is indistinguishable from a deliberate one.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseStageProbability } from '@/lib/crm/opportunities'

describe('parseStageProbability', () => {
  it('a blank field is not a decision', () => {
    /*
     * ⚠️ THE DEFECT, IN ONE ASSERTION. Returning 0 here is what made "not
     * decided" and "will not close" the same stored value.
     */
    expect(parseStageProbability('')).toBeNull()
    expect(parseStageProbability('   ')).toBeNull()
  })

  it('keeps 0 as a real answer, because Lost genuinely is 0%', () => {
    // The suggested pipeline ships a Lost stage at 0. Rejecting 0 outright
    // would refuse the product's own default.
    expect(parseStageProbability('0')).toBe(0)
    expect(parseStageProbability('100')).toBe(100)
    expect(parseStageProbability(' 45 ')).toBe(45)
  })

  it('refuses what is out of range rather than clamping it silently', () => {
    /*
     * The old code clamped with Math.min/Math.max, so 250 became 100 and -5
     * became 0 — a number the person never chose, stored as though they had.
     * Out of range is a typo worth surfacing.
     */
    expect(parseStageProbability('101')).toBeNull()
    expect(parseStageProbability('-1')).toBeNull()
    expect(parseStageProbability('250')).toBeNull()
  })

  it('refuses input that is numeric to JavaScript but not to a person', () => {
    // `Number` is happy with all of these; none is a percentage anybody typed
    // on purpose, and NaN/Infinity must never reach the column.
    for (const raw of ['abc', '1e2', '0x10', '12.5', 'NaN', 'Infinity', '']) {
      expect(parseStageProbability(raw), `${raw} was accepted`).toBeNull()
    }
  })
})

describe('the refusal is enforced where it binds', () => {
  /*
   * ⚠️ COMMENTS STRIPPED, AND THIS FILE WALKED INTO IT. The action's comment
   * quotes the old `Number(probabilities[i] ?? 0) || 0` to explain what was
   * wrong with it, and the absence assertion below matched the explanation.
   * Documenting a defect must not look like committing it — the same trap
   * `action-reachability` and `service-role-scoping` both record.
   */
  const action = readFileSync(
    join(__dirname, '..', '..', 'app/(product)/crm/pipeline/actions.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('the server action validates, not just the form', () => {
    /*
     * A server action is a public HTTP endpoint — CLAUDE.md: "Hiding a button
     * is not access control", and the same holds for validation. A check that
     * lives only in PipelineSetup.tsx is bypassed by anyone posting directly.
     */
    expect(action).toContain('parseStageProbability')
    expect(action, 'the old silent coercion is back').not.toContain('Number(probabilities')
  })
})

describe('§8 deal-level probability does not exist yet', () => {
  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THIS GUARD EXISTS SO NOBODY "FIXES" A9 BY BUILDING THE WRONG HALF. ║
   * ║                                                                       ║
   * ║  §8 wants `effective_probability` = deal → stage → unknown. There is   ║
   * ║  no deal tier: nothing writes `crm_opportunities.probability` except   ║
   * ║  `createOpportunity` copying the stage default, and                    ║
   * ║  `crm_move_opportunity_stage` overwriting it on every move. So the     ║
   * ║  chain has nothing to fall back FROM, and a nullable column today      ║
   * ║  would be machinery for a population of zero.                          ║
   * ║                                                                       ║
   * ║  Asserted in BOTH directions, like money-single-currency.test.ts: the  ║
   * ║  day something does set a deal's own probability, this fails and says  ║
   * ║  what to implement rather than leaving the conflation to be found in   ║
   * ║  a forecast.                                                          ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  const opportunities = readFileSync(
    join(__dirname, '..', '..', 'lib/crm/opportunities.ts'),
    'utf8',
  )

  it('nothing updates a deal probability independently of its stage', () => {
    // An `update({ probability })` anywhere means the deal tier has arrived.
    // No `s` flag: the project targets below es2018, and `[^}]` already spans
    // newlines, so dotAll would buy nothing even where it compiled.
    const updatesProbability = /\.update\(\{[^}]*\bprobability\b/.test(opportunities)

    expect(
      updatesProbability,
      'Something now sets a deal probability of its own. §8 needs the full ' +
        'precedence chain before that is safe: make crm_opportunities.probability ' +
        'nullable, stop crm_move_opportunity_stage overwriting a deal that has its ' +
        'own value, and report unknown-probability coverage in the forecast — ' +
        'otherwise unknown and 0% stay the same number in every weighted total.',
    ).toBe(false)
  })

  it('the stage move still overwrites it, which is why the above holds', () => {
    // Tied together deliberately: if someone stops the overwrite, this fails
    // and points at the guard above rather than leaving it describing a system
    // that no longer exists.
    const move = readFileSync(
      join(__dirname, '..', '..', 'supabase/migrations/0076_crm_opportunities.sql'),
      'utf8',
    )
    expect(move).toMatch(/probability\s*=\s*case v_stage\.kind/)
  })
})
