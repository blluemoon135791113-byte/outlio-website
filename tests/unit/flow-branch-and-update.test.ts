/**
 * Branch conditions and UPDATE_FIELD: two editors, two silent failures.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  BOTH OF THESE FAIL BY DOING NOTHING, WHICH IS THE WORST KIND.           ║
 * ║                                                                           ║
 * ║  `in` / `not_in` are guarded by `Array.isArray(expected) && …`, so a      ║
 * ║  STRING there does not error — it returns false, for every contact,       ║
 * ║  forever. Typing `founder, ceo` into the JSON box produced exactly a      ║
 * ║  branch that never matched.                                               ║
 * ║                                                                           ║
 * ║  `updateField` refuses anything outside its allow-list with               ║
 * ║  FIELD_NOT_ALLOWED, so a field name the editor invented would move the    ║
 * ║  failure from publish to run, one contact at a time.                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateCondition } from '@/lib/flows/engine'

const ROOT = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const BUILDER = read('components/flows/FlowBuilder.tsx')
const ENGINE = read('lib/flows/engine.ts')
const CRM_ACTIONS = read('lib/flows/actions/crm.ts')

describe('the list operators need a real array', () => {
  const facts = { 'contact.job_title': 'Founder' }

  it('matches when the value is an array', () => {
    expect(
      evaluateCondition(
        { field: 'contact.job_title', operator: 'in', value: ['Founder', 'CEO'] } as never,
        facts,
      ),
    ).toBe(true)
  })

  it('silently never matches when it is a string — the bug the editor prevents', () => {
    /*
     * ⚠️ THIS IS THE BEHAVIOUR, NOT A COMPLAINT ABOUT IT. Documenting it in a
     * test is what stops someone "simplifying" the editor into storing a
     * comma-joined string, which would look identical in the JSON and never
     * match again.
     */
    expect(
      evaluateCondition(
        { field: 'contact.job_title', operator: 'in', value: 'Founder, CEO' } as never,
        facts,
      ),
    ).toBe(false)
  })

  it('the editor stores an array for those operators', () => {
    expect(BUILDER).toContain("const LIST_OPERATORS = new Set(['in', 'not_in'])")
    // Split into parts, trimmed, empties dropped — a real array.
    expect(BUILDER).toContain("raw.split(',').map((part) => part.trim()).filter(Boolean)")
  })

  it('reshapes the value when the operator changes shape', () => {
    /*
     * Switching `contains` → `in` must turn the text into an array, and
     * `in` → `contains` must turn it back. Leaving the old shape behind is the
     * same silent no-match by another route.
     */
    expect(BUILDER).toContain('const changeOperator')
    expect(BUILDER).toContain('value = Array.isArray(value) ? value : []')
    expect(BUILDER).toContain("value = value.join(', ')")
  })
})

describe('the branch editor offers only facts that exist', () => {
  it('every offered field is one gatherFacts produces', () => {
    /*
     * ⚠️ `facts[condition.field]` IS A PLAIN LOOKUP. A field the fact set does
     * not contain reads as `undefined`, which makes most operators false — so
     * every contact takes the same path and the branch looks configured while
     * branching nothing.
     */
    const offered = [...BUILDER.matchAll(/\{ key: '(contact\.[a-z_]+)', label:/g)].map(
      (m) => m[1]!,
    )
    expect(offered.length).toBeGreaterThanOrEqual(8)

    for (const key of offered) {
      expect(ENGINE, `${key} is not produced by gatherFacts`).toContain(`'${key}':`)
    }
  })

  it('offers every operator the evaluator implements', () => {
    // An operator missing from the picker is a feature nobody can reach; one
    // that the evaluator lacks falls through to `default: return false`.
    for (const op of [
      'equals', 'not_equals', 'contains', 'not_contains', 'is_empty',
      'is_not_empty', 'greater_than', 'less_than', 'in', 'not_in',
    ]) {
      expect(BUILDER, `${op} missing from the picker`).toContain(`key: '${op}'`)
      expect(ENGINE, `${op} missing from the evaluator`).toContain(`case '${op}'`)
    }
  })

  it('will not let the last condition be removed', () => {
    // The schema requires `min(1)`; removing it makes the flow unpublishable —
    // a dead end reached by clicking a button that looked available.
    expect(BUILDER).toContain('disabled={conditions.length <= 1}')
  })

  it('no longer sends anyone to the JSON view', () => {
    /*
     * This assertion has moved twice, and the movement is the point. First the
     * whole branch was "edited in the JSON view". Then conditions arrived and
     * only ROUTING was. Now routing has pickers too, so neither sentence
     * should survive — a stale pointer to a JSON escape hatch is worse than
     * none, because it sends someone to hand-edit something the UI can do.
     */
    expect(BUILDER).not.toContain('Branch conditions are edited in the JSON view')
    expect(BUILDER).not.toContain('Which step each path goes to is still set in the JSON editor')
  })
})

describe('branch routing', () => {
  it('routes both paths from the builder', () => {
    expect(BUILDER).toContain('branch-true')
    expect(BUILDER).toContain('branch-false')
    expect(BUILDER).toContain('onChange({ onTrue: event.target.value || null })')
    expect(BUILDER).toContain('onChange({ onFalse: event.target.value || null })')
  })

  it('offers "End the flow" as a real destination', () => {
    /*
     * `null` means the run finishes on that path — the common shape, "only do
     * the rest if this holds". A blank option would read as unset rather than
     * as the deliberate choice it is.
     */
    expect(BUILDER).toContain('End the flow')
  })

  it('never offers the branch itself as a target', () => {
    // A branch routing to itself is a cycle with no wait, which the validator
    // rejects — so it must not be selectable in the first place.
    expect(BUILDER).toContain('targets.filter((t) => t.id !== step.id)')
  })

  it('can add a branch at all', () => {
    /*
     * ⚠️ THERE WAS NO WAY TO. `addStep` made only ACTIONs and `addWait` only
     * WAITs, so a condition could reach a flow only through the JSON editor —
     * which meant the condition editor had nothing to edit for anyone who had
     * not hand-written one.
     */
    expect(BUILDER).toContain('const addBranch =')
    expect(BUILDER).toContain('onBranch={() => addBranch(')
    expect(BUILDER).toContain('Only if…')
  })

  it('creates it with a condition already present', () => {
    // The schema requires `min(1)`; an empty branch is unpublishable the
    // instant it is created.
    const add = BUILDER.slice(BUILDER.indexOf('const addBranch ='), BUILDER.indexOf('const addWait ='))
    expect(add).toContain("conditions: [{ field: 'contact.job_title', operator: 'is_not_empty' }]")
  })

  it('inserting a branch wires onTrue, never next', () => {
    /*
     * ⚠️ A BRANCH HAS NO `next`. Writing one produces an object the schema
     * strips on validate, so the rest of the flow silently detaches: the
     * branch points nowhere and every step after it becomes unreachable.
     */
    const builderLib = read('lib/flows/builder.ts')
    expect(builderLib).toContain('const pointAt =')
    expect(builderLib).toContain("candidate.type === 'BRANCH'")
    expect(builderLib).toContain('onTrue: successor, onFalse: null')
  })
})

describe('update-field offers only what the handler accepts', () => {
  it('matches the handler’s allow-list exactly', () => {
    /*
     * ⚠️ VERIFIED NON-VACUOUS: adding a fifth option to the editor fails this,
     * because `updateField` would refuse it at run time with FIELD_NOT_ALLOWED.
     */
    const allowed = CRM_ACTIONS.match(/const UPDATABLE_FIELDS = \[([^\]]*)\]/)
    expect(allowed, 'the handler allow-list is gone').not.toBeNull()
    const handlerFields = [...allowed![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)

    const offered = [...BUILDER.matchAll(/\{ key: '([a-z_]+)', label: '(?:Job title|Headline|Location|Full name)'/g)]
      .map((m) => m[1]!)

    expect(offered.sort()).toEqual(handlerFields.sort())
  })

  it('keeps clearing distinct from setting an empty string', () => {
    /*
     * ⚠️ TWO DIFFERENT WRITES. The handler accepts `null` to clear and refuses
     * any non-string otherwise, so "" writes an empty string and `null`
     * removes the value. Collapsing them makes one unreachable — and "clear
     * this field" is the one people actually want.
     */
    expect(CRM_ACTIONS).toContain("if (value !== null && typeof value !== 'string')")
    expect(BUILDER).toContain('const clearing = config.value === null')
    expect(BUILDER).toContain('Clear the field instead')
    expect(BUILDER).toContain('value: event.target.checked ? null : ')
  })

  it('requires the field but not the value', () => {
    /*
     * `value: null` is legitimate — it is how a flow clears a field — and the
     * publish check treats null as missing, so requiring it would make
     * clearing unpublishable.
     */
    const definition = read('lib/flows/definition.ts')
    const table = definition.slice(
      definition.indexOf('const REQUIRED_ACTION_CONFIG'),
      definition.indexOf('}', definition.indexOf('const REQUIRED_ACTION_CONFIG')),
    )
    expect(table).toContain("UPDATE_FIELD: ['field']")
    expect(table).not.toMatch(/UPDATE_FIELD: \[[^\]]*'value'/)
  })
})

describe('both editors patch rather than replace', () => {
  it('update-field keeps the rest of the config', () => {
    expect(BUILDER).toContain('onChange({ ...config, field: event.target.value })')
  })

  it('the branch editor patches each part independently', () => {
    /*
     * ⚠️ EVERY FIELD IS OPTIONAL IN THE PATCH TYPE, and that is what makes
     * `onChange({ match })` safe: `updateStep` merges, so sending only the
     * changed key leaves conditions and both routes alone. A patch type with
     * required fields would force every caller to resend everything, and the
     * first one to forget would silently clear a route.
     */
    const patchType = BUILDER.slice(
      BUILDER.indexOf('onChange: (patch: {'),
      BUILDER.indexOf('}) => void', BUILDER.indexOf('onChange: (patch: {')),
    )
    for (const key of ['conditions?', 'match?', 'onTrue?', 'onFalse?']) {
      expect(patchType, `${key} is not optional in the branch patch`).toContain(key)
    }

    expect(BUILDER).toContain('onChange({ match:')
    expect(BUILDER).toContain('onChange({ onTrue:')
    expect(BUILDER).toContain('onChange({ onFalse:')
  })
})
