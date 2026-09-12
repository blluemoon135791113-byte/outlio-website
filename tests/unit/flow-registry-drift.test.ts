/**
 * §5.10's registry pin and deprecation warning — Phase 13's prerequisite.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  "A published flow pins the registry version it compiled against;         ║
 * ║  deprecation raises a validator warning and requires a migration path."   ║
 * ║                                                                           ║
 * ║  Neither half existed. `validateFlowDefinition` checks structure — schema, ║
 * ║  unique ids, dangling targets, cycles without a wait — and says nothing    ║
 * ║  about whether the capabilities a definition uses are still current.      ║
 * ║                                                                           ║
 * ║  ⚠️ WHY THIS IS THE FOUNDATION AND NOT A DETAIL. Phase 13 hands a model a  ║
 * ║  registry snapshot and accepts only ids from it. Without a recorded        ║
 * ║  version, "the snapshot it compiled against" is unknowable after the       ║
 * ║  fact, and a deprecation becomes undetectable drift rather than a warning. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CAPABILITY_REGISTRY_VERSION } from '@/lib/capabilities/registry'
import {
  flowDefinitionWarnings,
  validateFlowDefinition,
  type FlowDefinition,
} from '@/lib/flows/definition'

/** A minimal definition: one deterministic action, no branches, no loops. */
function definition(extra: Record<string, unknown> = {}): FlowDefinition {
  return validateFlowDefinition({
    trigger: { type: 'contact_created', config: {} },
    entryStepId: 'assign',
    steps: [
      { id: 'assign', type: 'ACTION', action: 'ASSIGN_OWNER', config: {}, next: null },
    ],
    ...extra,
  })
}

describe('the registry version is pinned on a definition', () => {
  it('accepts and preserves a version', () => {
    expect(definition({ registryVersion: 1 }).registryVersion).toBe(1)
  })

  it('accepts a definition without one, because five already exist', () => {
    /*
     * ⚠️ BACK-COMPATIBILITY IS THE POINT. Production holds five `flow_versions`
     * rows written before this field existed. A required field would make them
     * fail to PARSE — a flow a customer can currently open and repair would
     * become one that cannot be read at all.
     */
    expect(definition().registryVersion).toBeUndefined()
  })

  it('refuses a nonsense version rather than coercing it', () => {
    for (const bad of [0, -1, 1.5, 'one']) {
      expect(() => definition({ registryVersion: bad }), `accepted ${bad}`).toThrow()
    }
  })
})

describe('deprecation warns; it never refuses', () => {
  /*
   * ⚠️ THE LOOKUP IS INJECTED BECAUSE NOTHING IS DEPRECATED YET. Every registry
   * entry is `active`, so a test using the real registry could only assert the
   * empty case and would pass whether or not this branch worked at all — the
   * vacuity this project keeps finding. The stub is how the branch is exercised.
   */
  const deprecated = () => ({ id: 'flow.assign_owner' as const, status: 'deprecated' as const })
  const active = () => ({ id: 'flow.assign_owner' as const, status: 'active' as const })

  it('warns once per deprecated step, naming the step', () => {
    const warnings = flowDefinitionWarnings(definition(), { lookup: deprecated })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.kind).toBe('deprecated_capability')
    expect(warnings[0]!.stepId).toBe('assign')
    expect(warnings[0]!.message).toContain('ASSIGN_OWNER')
  })

  it('says the step still runs, because it does', () => {
    // A warning that reads like a failure gets treated as one.
    const [warning] = flowDefinitionWarnings(definition(), { lookup: deprecated })
    expect(warning!.message).toMatch(/still runs/i)
  })

  it('does NOT throw — a deprecated flow must stay openable and repairable', () => {
    /*
     * This is the whole reason warnings exist separately from errors. If
     * deprecation threw, deprecating one entry would make every flow using it
     * unopenable, undoing the registry's "deprecated, never deleted" rule.
     */
    expect(() => flowDefinitionWarnings(definition(), { lookup: deprecated })).not.toThrow()
  })

  it('stays silent when everything is current', () => {
    expect(flowDefinitionWarnings(definition(), { lookup: active })).toEqual([])
  })

  it('is silent against the real registry today, and that is checked separately', () => {
    /*
     * Asserted deliberately: it documents that nothing is deprecated right now.
     * On its own it proves nothing about the branch above — which is exactly
     * why the injected stub exists.
     */
    expect(flowDefinitionWarnings(definition())).toEqual([])
  })
})

describe('registry drift', () => {
  it('warns when a definition was compiled against an older registry', () => {
    const warnings = flowDefinitionWarnings(definition({ registryVersion: 1 }), {
      currentRegistryVersion: 3,
    })
    const drift = warnings.find((w) => w.kind === 'registry_drift')
    expect(drift, 'no drift warning').toBeDefined()
    expect(drift!.message).toContain('v1')
    expect(drift!.message).toContain('v3')
    expect(drift!.stepId).toBeNull()
  })

  it('does not warn at the current version', () => {
    const warnings = flowDefinitionWarnings(
      definition({ registryVersion: CAPABILITY_REGISTRY_VERSION }),
    )
    expect(warnings.filter((w) => w.kind === 'registry_drift')).toEqual([])
  })

  it('does not warn when no version was recorded', () => {
    /*
     * ⚠️ ABSENT IS NOT STALE. Warning here would fire on every flow written
     * before the field existed, and a guard that cries wolf on legacy rows is
     * one people learn to ignore.
     */
    const warnings = flowDefinitionWarnings(definition(), { currentRegistryVersion: 99 })
    expect(warnings.filter((w) => w.kind === 'registry_drift')).toEqual([])
  })

  it('never warns that a definition is from the future', () => {
    // A newer pin than ours means someone deployed behind; it is not drift to
    // re-check, and telling the user to "re-check the steps" would be wrong.
    const warnings = flowDefinitionWarnings(definition({ registryVersion: 9 }), {
      currentRegistryVersion: 2,
    })
    expect(warnings).toEqual([])
  })
})

/**
 * The warning has to reach a human, or "deprecated, never deleted" just means
 * the flow quietly ages.
 *
 * ⚠️ THIS FILE'S OWN REASON TO EXIST. `flowDefinitionWarnings` was a correct
 * exported function with no product caller the moment it was written — the same
 * shape as the erasure path, the webhook publisher and the notification events.
 * Computing a warning and not rendering it is the identical defect one step
 * later. `orphan-module.test.ts` cannot see it: `lib/flows/definition.ts` has
 * dozens of importers.
 */
describe('a stale flow tells its owner', () => {
  const PAGE = readFileSync(
    join(__dirname, '..', '..', 'app/(product)/flows/[id]/page.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('the flow page computes warnings', () => {
    expect(PAGE).toContain('flowDefinitionWarnings(definition)')
  })

  it('and renders them — computing without rendering is the same bug', () => {
    expect(PAGE).toMatch(/warnings\.length > 0/)
    expect(PAGE).toContain('warnings.map')
    expect(PAGE).toContain('warning.message')
  })

  it('names the step, so the owner knows which one to change', () => {
    expect(PAGE).toContain('warning.stepId')
  })
})
