import type { ResearchScope } from '@/lib/intelligence/plan'

export const HUBBLE_FILTER_LIMIT = 25

/**
 * The filter bar is the research boundary.
 *
 * An explicit All-leads view may research the account. Any applied list/date
 * filter researches only the 25 IDs actually shown, never hidden rows from the
 * same extraction or date range.
 */
export function researchScopeForView(input: {
  batchId: string | null
  from: string | null
  to: string | null
  visibleLeadIds: readonly string[]
}): ResearchScope | null {
  const filtered = Boolean(input.batchId || (input.from && input.to))
  if (!filtered) return { type: 'all_leads' }

  const leadIds = [...new Set(input.visibleLeadIds)].slice(0, HUBBLE_FILTER_LIMIT)
  return leadIds.length > 0 ? { type: 'lead_ids', leadIds } : null
}
