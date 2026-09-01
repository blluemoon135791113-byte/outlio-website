/**
 * Every starter template must be a valid, safe flow — R9.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A TEMPLATE IS SOMEONE'S FIRST EXPERIENCE OF AUTOMATION.                 ║
 * ║                                                                           ║
 * ║  If one ships pointing at a step that does not exist, or naming an action ║
 * ║  that was later renamed, the first thing a customer ever does with flows  ║
 * ║  fails — and it fails in a way that looks like the product is broken      ║
 * ║  rather than like a typo in a constant.                                   ║
 * ║                                                                           ║
 * ║  These run the templates through the SAME validator that guards publish,  ║
 * ║  so a template cannot be less correct than a flow someone builds by hand. ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import { ACTION_TYPES, validateFlowDefinition } from '@/lib/flows/definition'
import { FLOW_TEMPLATES, flowTemplate } from '@/lib/flows/templates'

describe('the template set itself', () => {
  it('has templates to check, so the assertions below are not vacuous', () => {
    expect(FLOW_TEMPLATES.length).toBeGreaterThan(4)
  })

  it('uses a unique key for each, since the key selects one', () => {
    const keys = FLOW_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('describes each one in terms of what it does', () => {
    for (const template of FLOW_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(3)
      // A description that just repeats the name teaches nothing.
      expect(template.description.length).toBeGreaterThan(30)
      expect(template.description).not.toBe(template.name)
    }
  })

  it('returns null for a key that does not exist', () => {
    expect(flowTemplate('no-such-template')).toBeNull()
    expect(flowTemplate(FLOW_TEMPLATES[0]!.key)).not.toBeNull()
  })
})

describe('every template passes the validator that guards publish', () => {
  for (const template of FLOW_TEMPLATES) {
    it(`${template.key} is a publishable definition`, () => {
      /*
       * ⚠️ THE SAME FUNCTION `publishFlow` USES. Anything less would let a
       * template ship in a state the product refuses to publish — which is
       * the worst possible first impression: the sample does not work.
       */
      expect(() => validateFlowDefinition(template.definition)).not.toThrow()
    })

    it(`${template.key} points only at steps it actually contains`, () => {
      const ids = new Set(template.definition.steps.map((s) => s.id))
      expect(ids.has(template.definition.entryStepId)).toBe(true)

      for (const step of template.definition.steps) {
        const targets =
          step.type === 'BRANCH' ? [step.onTrue, step.onFalse] : [step.next]

        for (const target of targets) {
          if (target !== null) {
            expect(ids, `${template.key}/${step.id} points at a missing step`).toContain(
              target,
            )
          }
        }
      }
    })
  }
})

describe('no template can commit someone to spending', () => {
  for (const template of FLOW_TEMPLATES) {
    it(`${template.key} uses no credit-consuming action`, () => {
      /*
       * ⚠️ THE RULE THAT MATTERS MOST HERE. A starter someone clicks without
       * reading must not commit them to spend — and a Hubble step on a flow
       * pointed at a large list does exactly that, silently, at scale. AI
       * steps belong in a flow somebody chose deliberately.
       */
      for (const step of template.definition.steps) {
        if (step.type !== 'ACTION') continue
        expect(
          ACTION_TYPES[step.action].costsCredits,
          `${template.key} uses ${step.action}, which spends credits`,
        ).toBe(false)
      }
    })

    it(`${template.key} sends no email on its own`, () => {
      // Same reasoning: a template must never mail a customer's list because
      // someone clicked "use this" to see what it did.
      for (const step of template.definition.steps) {
        if (step.type !== 'ACTION') continue
        expect(step.action).not.toBe('SEND_EMAIL')
        expect(step.action).not.toBe('ENROLL_SEQUENCE')
      }
    })
  }
})
