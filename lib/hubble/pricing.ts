/**
 * What AI costs — M7 Phase 22.
 *
 * ⚠️ SEPARATE FROM THE BOUNDARY, AND PURE. Pricing is the half a customer must
 * be able to see BEFORE anything runs: the brief requires expected credit usage
 * to be shown, and a quote that needed a database round trip could not be
 * rendered next to a flow step as it is being edited.
 *
 * ⚠️ THE COST IS DECLARED HERE, NOT AT THE CALL SITE. A caller that could pass
 * its own price would eventually pass the wrong one, and the same work would
 * cost different amounts depending on which screen asked for it.
 */

export const HUBBLE_TASKS = {
  icp_score: { credits: 1, label: 'Score against your ICP' },
  research: { credits: 3, label: 'Research this company' },
  classification: { credits: 1, label: 'Classify' },
  personalization: { credits: 2, label: 'Personalise this message' },
  reply_draft: { credits: 2, label: 'Draft a reply' },
  response_classification: { credits: 1, label: 'Classify this reply' },
  account_summary: { credits: 2, label: 'Summarise this account' },
} as const

export type HubbleTask = keyof typeof HUBBLE_TASKS

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
