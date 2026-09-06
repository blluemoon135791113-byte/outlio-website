/**
 * Credit quoting — M7 Phase 22.
 *
 * ⚠️ THE BRIEF REQUIRES EXPECTED CREDIT USAGE TO BE SHOWN BEFORE A RUN. A
 * customer pointing a flow at 10,000 contacts must be able to see the bill
 * before pressing publish — not discover it on an invoice.
 */
import { describe, expect, it } from 'vitest'

import { HUBBLE_TASKS, quoteCredits, quoteFlow, type HubbleTask } from '@/lib/hubble/pricing'

describe('every task has a declared price', () => {
  it('prices every task the brief names', () => {
    for (const task of [
      'icp_score', 'research', 'classification', 'personalization',
      'reply_draft', 'response_classification', 'account_summary',
    ] as HubbleTask[]) {
      expect(quoteCredits(task)).toBeGreaterThan(0)
    }
  })

  it('gives every task a human label, not just a number', () => {
    // "2 credits" means nothing on its own; "Personalise this message — 2
    // credits" is a decision someone can make.
    for (const task of Object.keys(HUBBLE_TASKS) as HubbleTask[]) {
      expect(HUBBLE_TASKS[task].label.length).toBeGreaterThan(0)
    }
  })

  it('prices research above a simple classification', () => {
    // Research is several model calls and a fetch; classification is one.
    expect(quoteCredits('research')).toBeGreaterThan(quoteCredits('classification'))
  })
})

describe('quoting a whole flow', () => {
  it('multiplies per-contact cost by the audience', () => {
    const quote = quoteFlow(['icp_score', 'personalization'], 10_000)
    // 1 + 2 per contact.
    expect(quote.perContact).toBe(3)
    expect(quote.total).toBe(30_000)
  })

  it('breaks the cost down per step, so the expensive one is visible', () => {
    const quote = quoteFlow(['research', 'classification'], 100)
    expect(quote.breakdown).toHaveLength(2)
    expect(quote.breakdown[0]!.credits).toBe(quoteCredits('research'))
    expect(quote.breakdown[0]!.label).toContain('Research')
  })

  it('quotes zero for a flow with no AI steps', () => {
    // A fully deterministic flow must read as free, not as "unknown".
    const quote = quoteFlow([], 10_000)
    expect(quote.perContact).toBe(0)
    expect(quote.total).toBe(0)
  })

  it('never returns a negative total for a nonsense audience size', () => {
    expect(quoteFlow(['icp_score'], -5).total).toBe(0)
  })
})
