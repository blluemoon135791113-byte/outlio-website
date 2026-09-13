/**
 * Loop protection, and the direction it fails in.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `flow_check_loop_protection` RETURNS NULL TO MEAN "MAY PROCEED", SO A    ║
 * ║  DISCARDED ERROR MEANT "MAY PROCEED" TOO.                                 ║
 * ║                                                                           ║
 * ║  `const { data: haltReason } = await db.rpc(...)` threw the error away.    ║
 * ║  On any database hiccup `haltReason` was `undefined` — falsy — and the run ║
 * ║  went ahead with no protection at all, silently, at exactly the moment the ║
 * ║  database was already unhappy.                                            ║
 * ║                                                                           ║
 * ║  Migration 0093 says what is at stake in its own words: "a self-triggering ║
 * ║  flow is the dangerous case, because it can spawn thousands of runs in     ║
 * ║  seconds." The per-contact-per-day limit rides along with it, which in an  ║
 * ║  outreach product means the same person entering the same flow over and    ║
 * ║  over.                                                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const ENGINE = strip(readFileSync(join(ROOT, 'lib/flows/engine.ts'), 'utf8'))
const MIGRATION = readFileSync(
  join(ROOT, 'supabase/migrations/0093_flow_engine.sql'),
  'utf8',
)

describe('the scanner sees what it polices', () => {
  it('reads the engine and the function it calls', () => {
    expect(ENGINE).toContain('flow_check_loop_protection')
    expect(MIGRATION).toContain('create or replace function public.flow_check_loop_protection')
  })
})

describe('a check that cannot run halts the flow', () => {
  it('captures the error instead of discarding it', () => {
    /*
     * ⚠️ THE EXACT SHAPE OF THE BUG. `const { data: haltReason }` compiles,
     * reads naturally, and silently converts every failure into permission.
     */
    expect(ENGINE).toMatch(/error: loopError/)
    expect(ENGINE, 'the RPC error is being discarded again').not.toMatch(
      /const \{ data: haltReason \} = await db\.rpc\('flow_check_loop_protection'/,
    )
  })

  it('treats an unavailable check as a halt, not as permission', () => {
    expect(ENGINE).toMatch(/loopError\s*\n?\s*\?\s*'Stopped:/)
    expect(ENGINE, 'an error still falls through to the raw result').not.toMatch(
      /const haltReason = loopCheck\s*$/m,
    )
  })

  it('records why, so the customer is not left guessing', () => {
    /*
     * 0093: "Returning the REASON rather than a boolean is the point: the
     * caller stores it on the run, and the customer sees why." A halt with no
     * reason is indistinguishable from a flow that simply stopped working.
     */
    expect(ENGINE).toMatch(/halt_reason: haltReason/)
    expect(ENGINE).toMatch(/console\.error\('flow loop protection unavailable'/)
  })

  it('the halt still goes through the normal recorded path', () => {
    // Not a separate early return: an error-halt is written to `flow_runs` with
    // status 'halted' exactly like a limit-halt, so both appear in the same
    // place for whoever is wondering why the flow stopped.
    const halt = ENGINE.slice(ENGINE.indexOf('if (haltReason) {'))
    expect(halt).toMatch(/status: 'halted'/)
    expect(halt).toMatch(/reason: 'halted'/)
  })
})

describe('the asymmetry is deliberate and stays documented', () => {
  it('null from the function still means proceed', () => {
    /*
     * ⚠️ THE OTHER DIRECTION. If a real "no halt" answer started halting, every
     * flow in the product would stop — so the fix must not have turned a
     * legitimate NULL into a refusal.
     */
    expect(MIGRATION).toMatch(/Returns NULL when the run may proceed/)
    expect(ENGINE).toMatch(/\?\s*'Stopped:[^']*'\s*\n?\s*:\s*loopCheck/)

    /*
     * ⚠️ ASSERTED AS AN ABSENCE, BECAUSE THE PREFIX MATCH ABOVE IS NOT ENOUGH.
     * `: loopCheck ?? 'Stopped: unknown'` satisfies it and would halt EVERY
     * flow in the product — a legitimate NULL turned into a refusal. Caught by
     * mutation; it is the same substring mistake that let
     * `/suppressContact\(\{/` match inside `unsuppressContact({` and
     * `crm_opportunities_fx_pair` match `..._fx_pair_DISABLED`.
     */
    expect(ENGINE, 'a legitimate "may proceed" is being coalesced into a halt').not.toMatch(
      /loopCheck\s*\?\?/,
    )
  })

  it('the opposite choice elsewhere is still the opposite', () => {
    /*
     * ⚠️ `consume_rate_limit` FAILS OPEN, ON PURPOSE, and this file fails
     * closed. Both are right: refusing a rate-limited action on a blip costs
     * one delayed request, while proceeding without loop protection costs
     * thousands of runs or repeated mail to a real person. Asserted so the two
     * are not "harmonised" later by someone who notices they disagree.
     */
    const contactStop = readFileSync(join(ROOT, 'lib/crm/contact-stop.ts'), 'utf8')
    expect(contactStop).toMatch(/`consume_rate_limit` fails open/)
    // And the suppression predicate, which faces the same choice, still fails
    // CLOSED — the two together are what make this a decision per case rather
    // than a house style.
    expect(contactStop).toMatch(/IT FAILS CLOSED ON ERROR/)
  })
})
