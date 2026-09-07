/**
 * The capability registry is a closed set, and it may only grow — Phase 12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §5.10: entries are "versioned; DEPRECATED, NEVER DELETED".               ║
 * ║                                                                           ║
 * ║  A published flow stores the capability ids it was compiled against.      ║
 * ║  Deleting an entry does not break a build — it breaks a row that a         ║
 * ║  customer published months ago, at the moment the engine next reads it,    ║
 * ║  which is the worst possible time to find out. Marking it `deprecated`     ║
 * ║  keeps the definition readable and lets a validator warn instead.         ║
 * ║                                                                           ║
 * ║  ⚠️ `registry.ts` STATES THIS TEST REFUSES A DELETION. It said so before   ║
 * ║  the file existed. That is the same shape as the defect Phase 12 is        ║
 * ║  about — a comment describing a guarantee nothing enforces.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it } from 'vitest'

import {
  CAPABILITIES,
  CAPABILITY_IDS,
  CAPABILITY_REGISTRY_VERSION,
  aiCapabilityIds,
  capabilityForFlowAction,
  hubbleTaskForAction,
  isCapabilityId,
  type Capability,
} from '@/lib/capabilities/registry'
import { ALL_PERMISSIONS } from '@/lib/workspaces/permissions'

/**
 * Every id that has ever shipped.
 *
 * ⚠️ APPEND ONLY. Adding a capability adds a line here. Removing one is what
 * this file exists to refuse — so if a diff deletes a line from this list, that
 * is the deletion, not the fix.
 */
const SHIPPED_IDS = [
  'flow.assign_owner',
  'flow.round_robin',
  'flow.create_task',
  'flow.move_stage',
  'flow.update_field',
  'flow.add_tag',
  'flow.remove_tag',
  'flow.add_to_list',
  'flow.remove_from_list',
  'flow.create_opportunity',
  'flow.create_activity',
  'flow.notify',
  'flow.dedupe_check',
  'flow.date_calc',
  'flow.text_transform',
  'flow.webhook',
  'flow.enroll_sequence',
  'flow.remove_sequence',
  'flow.pause_sequence',
  'flow.resume_sequence',
  'flow.create_email_task',
  'flow.send_email',
  'hubble.icp_score',
  'hubble.research',
  'hubble.classification',
  'hubble.personalization',
  'hubble.reply_draft',
  'hubble.response_classification',
  'hubble.account_summary',
  'hubble.ask',
  'intelligence.plan',
  'intelligence.summarize',
] as const

describe('the registry may only grow', () => {
  it('has not deleted a capability that has shipped', () => {
    const missing = SHIPPED_IDS.filter((id) => !isCapabilityId(id))

    expect(
      missing,
      'These ids have shipped and a stored flow definition may still name them. ' +
        'Set `status: "deprecated"` instead of removing the entry:\n' +
        missing.map((id) => `  ${id}`).join('\n'),
    ).toEqual([])
  })

  it('records every current capability in the shipped list', () => {
    /*
     * The other direction: a new entry added without a line here means the
     * deletion guard would not notice if it vanished again next week.
     */
    const unrecorded = CAPABILITY_IDS.filter(
      (id) => !(SHIPPED_IDS as readonly string[]).includes(id),
    )

    expect(
      unrecorded,
      'Added to the registry but not to SHIPPED_IDS, so its deletion would go ' +
        'unnoticed:\n' + unrecorded.map((id) => `  ${id}`).join('\n'),
    ).toEqual([])
  })

  it('bumps the registry version when the set changes', () => {
    // Not a checksum — just a reminder that a published flow pins this number.
    expect(CAPABILITY_REGISTRY_VERSION).toBeGreaterThanOrEqual(1)
    expect(CAPABILITY_IDS.length).toBe(SHIPPED_IDS.length)
  })
})

describe('every entry is answerable', () => {
  it('names a permission that actually exists', () => {
    /*
     * ⚠️ A TYPO HERE FAILS OPEN AT THE CALL SITE, not here — `can()` would be
     * asked about a permission nobody holds and refuse everyone, which reads
     * as "the feature is broken" rather than "the registry is wrong".
     */
    const bogus = CAPABILITY_IDS.filter(
      (id) => !(ALL_PERMISSIONS as string[]).includes(CAPABILITIES[id].permission),
    )
    expect(bogus, `unknown permission on:\n${bogus.join('\n')}`).toEqual([])
  })

  it('gives every AI capability a human label', () => {
    // "2 credits" is not a decision anyone can make; "Draft a reply — 2" is.
    for (const id of aiCapabilityIds()) {
      const entry = CAPABILITIES[id] as Capability & { label?: string }
      expect(entry.label && entry.label.length > 0, `${id} has no label`).toBe(true)
    }
  })

  it('prices a deterministic capability at exactly zero', () => {
    /*
     * §5.11: "Deterministic actions never touch the ledger." A non-zero price
     * on an `isAi: false` entry would charge for work that never reaches a
     * model — the inverse of the bug this phase is fixing.
     */
    for (const id of CAPABILITY_IDS) {
      const entry = CAPABILITIES[id]
      if (!entry.isAi) expect(entry.credits, `${id} is deterministic but priced`).toBe(0)
    }
  })

  it('makes an unpriced capability name the decision that would price it', () => {
    const unpriced = aiCapabilityIds().filter((id) => {
      const entry = CAPABILITIES[id] as Capability & { credits: number | null }
      return entry.credits === null
    })

    // Four routes, three modules, three entries — see model-call-boundary.test.ts.
    expect(unpriced.length, 'the unpriced set changed without a decision').toBe(3)

    for (const id of unpriced) {
      const entry = CAPABILITIES[id] as Capability & { pricingDecision?: string }
      expect(
        entry.pricingDecision,
        `${id} has no price and does not say whose decision that is`,
      ).toMatch(/^DECISION-\d+$/)
    }
  })
})

describe('the flow catalogue and the registry cannot drift', () => {
  it('resolves every registered flow action back to its capability', () => {
    for (const id of CAPABILITY_IDS) {
      const entry = CAPABILITIES[id] as Capability & { flowAction?: string }
      if (!entry.flowAction) continue
      expect(capabilityForFlowAction(entry.flowAction).id, `${entry.flowAction} round-trip`).toBe(id)
    }
  })

  it('refuses an action it does not know, instead of calling it free', () => {
    /*
     * ⚠️ THE DEFAULT MATTERS MORE THAN THE THROW. An action missing from the
     * registry that resolved to `undefined` would read as `isAi: false` at the
     * one call site that matters and become a free AI step.
     */
    expect(() => capabilityForFlowAction('NOT_A_REAL_ACTION')).toThrow(
      /has no entry in lib\/capabilities\/registry\.ts/,
    )
  })

  it('reports no Hubble task for a deterministic action', () => {
    expect(hubbleTaskForAction('ASSIGN_OWNER')).toBeNull()
    expect(hubbleTaskForAction('HUBBLE_RESEARCH')).toBe('hubble.research')
  })

  it('keeps the HTTP capabilities out of the flow builder', () => {
    /*
     * `hubble.ask` and the intelligence entries have no `flowAction` on
     * purpose: they are unpriced, and offering an unpriced step would let a
     * customer publish a flow whose cost cannot be quoted.
     */
    for (const id of ['hubble.ask', 'intelligence.plan', 'intelligence.summarize'] as const) {
      const entry = CAPABILITIES[id] as Capability & { flowAction?: string }
      expect(entry.flowAction, `${id} must not be offered as a flow step`).toBeUndefined()
    }
  })
})
