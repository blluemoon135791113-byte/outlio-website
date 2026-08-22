import { describe, expect, it } from 'vitest'

import { HUBBLE_FILTER_LIMIT, researchScopeForView } from '@/lib/intelligence/view-scope'

const ids = Array.from(
  { length: 40 },
  (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
)

describe('researchScopeForView', () => {
  it('allows the explicit All-leads state to cover the account', () => {
    expect(
      researchScopeForView({ batchId: null, from: null, to: null, visibleLeadIds: ids }),
    ).toEqual({ type: 'all_leads' })
  })

  it('caps a selected extraction at the 25 visible leads', () => {
    expect(
      researchScopeForView({
        batchId: '00000000-0000-4000-8000-000000000999',
        from: null,
        to: null,
        visibleLeadIds: ids,
      }),
    ).toEqual({ type: 'lead_ids', leadIds: ids.slice(0, HUBBLE_FILTER_LIMIT) })
  })

  it('caps a date-filtered view even without one selected extraction', () => {
    const scope = researchScopeForView({
      batchId: null,
      from: '2026-08-01',
      to: '2026-08-22',
      visibleLeadIds: ids,
    })
    expect(scope?.type).toBe('lead_ids')
    if (scope?.type === 'lead_ids') expect(scope.leadIds).toHaveLength(25)
  })

  it('does not fall back to hidden rows when a filtered view is empty', () => {
    expect(
      researchScopeForView({
        batchId: '00000000-0000-4000-8000-000000000999',
        from: null,
        to: null,
        visibleLeadIds: [],
      }),
    ).toBeNull()
  })
})
