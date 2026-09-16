/**
 * An action Outlio cannot run must be refused by the server, not by a dropdown.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `actionIsImplemented` HAD EXACTLY ONE CALLER: A MENU FILTER.          ║
 * ║                                                                           ║
 * ║  `FlowBuilder.tsx`'s two action pickers dropped unimplemented actions from ║
 * ║  the list, and nothing else ever asked. CLAUDE.md rule 8 — "hiding a       ║
 * ║  button is not access control" — and the publish path is a server action,  ║
 * ║  which is a public HTTP endpoint: a definition can arrive having never     ║
 * ║  passed a picker.                                                         ║
 * ║                                                                           ║
 * ║  ⚠️ LATENT, NOT LIVE, AND THE DISTINCTION IS HONEST RATHER THAN           ║
 * ║  REASSURING. `UNIMPLEMENTED_ACTIONS` is empty today, so nothing can slip   ║
 * ║  through, and `flow-action-coverage.test.ts` fails if an action is added   ║
 * ║  without a runner. But that guard protects the REPO at CI time, which is   ║
 * ║  not the same guarantee as refusing a REQUEST — and the list exists at all ║
 * ║  because the next action added is expected to sit in it for a while.      ║
 * ║  Seven actions were once publishable and dead; that is what it is for.    ║
 * ║                                                                           ║
 * ║  ⚠️ PHASE 13 IS WHAT MAKES IT LOAD-BEARING. A model emitting a definition  ║
 * ║  never touches the picker, so UI-only enforcement is worth nothing to it.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACTION_TYPES,
  UNIMPLEMENTED_ACTIONS,
  actionIsImplemented,
  publishProblems,
  validateFlowDefinition,
  type ActionType,
} from '@/lib/flows/definition'

const ROOT = join(__dirname, '..', '..')
const DEFINITION = readFileSync(join(ROOT, 'lib/flows/definition.ts'), 'utf8')

/** Config that satisfies `REQUIRED_ACTION_CONFIG`, so a refusal can only be about availability. */
const SATISFYING_CONFIG: Partial<Record<ActionType, Record<string, unknown>>> = {
  ADD_TAG: { tag: 'x' },
  ASSIGN_OWNER: { userId: '00000000-0000-0000-0000-000000000001' },
}

function oneStep(action: ActionType) {
  return validateFlowDefinition({
    trigger: { type: 'contact_created' },
    entryStepId: 's1',
    steps: [
      {
        id: 's1',
        type: 'ACTION',
        action,
        config: SATISFYING_CONFIG[action] ?? {},
        next: null,
      },
    ],
  })
}

describe('the premise this file rests on', () => {
  it('every catalogued action is implemented today', () => {
    /*
     * ⚠️ IF THIS FAILS, THE FAILURE IS THE POINT. It means something was added
     * to `UNIMPLEMENTED_ACTIONS`, which changes what the tests below are
     * asserting — and whoever added it should read this file rather than
     * discover the behaviour from a rejected publish.
     */
    expect(
      UNIMPLEMENTED_ACTIONS,
      'an action is now unimplemented; the availability refusal below is live, ' +
        'so confirm the publish path reports it and the parse path still loads it',
    ).toEqual([])
  })
})

describe('an implemented action is never refused for availability', () => {
  /*
   * ⚠️ THE DANGEROUS DIRECTION, per `REQUIRED_ACTION_CONFIG`'s own note: "a
   * missing entry can only fail to catch a bad publish; a wrong entry would
   * refuse a good one." A check that refused working actions would break every
   * flow in the product, so it is asserted over the whole catalogue rather than
   * one example.
   */
  for (const action of Object.keys(ACTION_TYPES) as ActionType[]) {
    it(`${action} publishes without an availability complaint`, () => {
      const complaints = publishProblems(oneStep(action)).filter((p) =>
        p.includes('cannot run yet'),
      )
      expect(complaints, `${action} is implemented but was refused as unavailable`).toEqual(
        [],
      )
    })
  }
})

describe('the refusal is server-side and in the right tier', () => {
  it('publishProblems is what refuses, not the parser', () => {
    /*
     * ⚠️ TIER MATTERS AND IS INVISIBLE IN BEHAVIOUR TODAY. `advanceRun` parses
     * every STORED definition on every run, so putting this in
     * `validateFlowDefinition` would retroactively make published flows fail to
     * LOAD the moment an action was retired — the author could no longer open
     * the flow to repair it. `definition.ts` states this in its own words:
     * "retroactively invalidating stored data is a migration, not a
     * validation."
     *
     * Asserted as an absence, because a prefix match cannot tell the tiers
     * apart and moving the check is a one-line edit.
     */
    const publish = DEFINITION.slice(DEFINITION.indexOf('export function publishProblems'))
    expect(publish).toMatch(/if \(!actionIsImplemented\(step\.action\)\)/)

    const parser = DEFINITION.slice(
      DEFINITION.indexOf('export function validateFlowDefinition'),
      DEFINITION.indexOf('export function publishProblems'),
    )
    expect(
      parser,
      'the availability check moved into the parser; stored flows using a ' +
        'retired action will no longer load, so nobody can repair them',
    ).not.toMatch(/actionIsImplemented/)
  })

  it('the builder still filters too, because both layers are wanted', () => {
    /*
     * The server check does not make the menu filter redundant: offering an
     * action that will be refused at publish is a bad experience, and refusing
     * it is the guarantee. Asserted so that "the server checks it now" does not
     * become a reason to delete the filter.
     */
    const builder = readFileSync(join(ROOT, 'components/flows/FlowBuilder.tsx'), 'utf8')
    expect(builder).toMatch(/actionIsImplemented/)
  })

  it('the refusal names the action and tells the author what to do', () => {
    // A publish blocker the author cannot act on is a dead end. Verified by
    // mutation (ADD_TAG temporarily marked unimplemented, 2026-09-14): the
    // publish tier refused it and the parse tier still loaded it.
    const publish = DEFINITION.slice(DEFINITION.indexOf('export function publishProblems'))
    expect(publish).toMatch(/which Outlio cannot run yet/)
    expect(publish).toMatch(/Remove the step or choose another action/)
  })
})

describe('actionIsImplemented answers from the list, not from a hardcoded set', () => {
  it('reads UNIMPLEMENTED_ACTIONS', () => {
    // Proves the predicate is wired to the list rather than returning a
    // constant — which, with the list empty, would be indistinguishable.
    expect(actionIsImplemented('ADD_TAG')).toBe(true)
    const source = DEFINITION.slice(DEFINITION.indexOf('export function actionIsImplemented'))
    expect(source).toMatch(/UNIMPLEMENTED_ACTIONS\.includes\(type\)/)
  })
})
