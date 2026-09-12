/**
 * What AI costs — M7 Phase 22, re-based on the capability registry in Phase 12.
 *
 * ⚠️ SEPARATE FROM THE BOUNDARY, AND PURE. Pricing is the half a customer must
 * be able to see BEFORE anything runs: the brief requires expected credit usage
 * to be shown, and a quote that needed a database round trip could not be
 * rendered next to a flow step as it is being edited.
 *
 * ⚠️ THE COST IS DECLARED IN THE REGISTRY, NOT AT THE CALL SITE. A caller that
 * could pass its own price would eventually pass the wrong one, and the same
 * work would cost different amounts depending on which screen asked for it.
 * This file is a view over `lib/capabilities/registry.ts`, kept so the flow
 * editor's quote API does not change shape.
 */
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  type AiFlowCapabilityId,
} from '@/lib/capabilities/registry'

export type HubbleTask = AiFlowCapabilityId

export const HUBBLE_TASKS: Readonly<Record<HubbleTask, { credits: number; label: string }>> =
  Object.fromEntries(
    CAPABILITY_IDS.flatMap((id) => {
      const entry = CAPABILITIES[id]
      if (!entry.isAi || !('flowAction' in entry) || entry.credits === null) return []
      return [[id, { credits: entry.credits, label: entry.label }]]
    }),
  ) as Record<HubbleTask, { credits: number; label: string }>

/** What one task costs, before anyone commits to it. */
export function quoteCredits(task: HubbleTask): number {
  return HUBBLE_TASKS[task].credits
}

/**
 * The bill for running a flow over an audience.
 *
 * ⚠️ SHOWN BEFORE PUBLISH, not after. A customer pointing a flow at 10,000
 * contacts must be able to see the cost while they can still change it.
 */
export function quoteFlow(tasks: HubbleTask[], contactCount: number): {
  perContact: number
  total: number
  breakdown: { task: HubbleTask; label: string; credits: number }[]
} {
  const breakdown = tasks.map((task) => ({
    task,
    label: HUBBLE_TASKS[task].label,
    credits: HUBBLE_TASKS[task].credits,
  }))
  const perContact = breakdown.reduce((sum, t) => sum + t.credits, 0)
  return { perContact, total: perContact * Math.max(contactCount, 0), breakdown }
}
