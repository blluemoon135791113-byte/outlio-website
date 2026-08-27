import { describe, expect, it } from 'vitest'

import { resolveConflict, scoreConfidence } from '@/lib/intelligence/evidence'
import type { EvidenceRecord, SourceConfidence } from '@/lib/intelligence/types'

let counter = 0

function record(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  counter += 1
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    entityType: 'company',
    entityId: '11111111-1111-4111-8111-111111111111',
    field: 'industry',
    value: { industry: 'Software' },
    sourceProvider: `provider-${counter}`,
    sourceUrl: 'https://example.com/a',
    sourceConfidence: 'medium' as SourceConfidence,
    confidence: 0.7,
    retrievedAt: new Date('2026-08-28T00:00:00Z').toISOString(),
    expiresAt: null,
    researchRunId: null,
    ...over,
  }
}

describe('scoreConfidence — agreement', () => {
  it('leaves a lone record at its own confidence', () => {
    const winner = record({ confidence: 0.7 })
    expect(scoreConfidence(winner, [], [])).toBeCloseTo(0.7, 5)
  })

  it('raises confidence when an independent provider agrees', () => {
    const winner = record({ sourceProvider: 'apollo', confidence: 0.7 })
    const other = record({ sourceProvider: 'wikidata', confidence: 0.6 })

    expect(scoreConfidence(winner, [other], [])).toBeGreaterThan(0.7)
  })

  it('⚠️ does NOT count a provider agreeing with itself', () => {
    /*
     * The same provider on two URLs is one source. A systematic error in that
     * provider produces both rows, so counting them twice would manufacture
     * confidence out of a single point of failure.
     */
    const winner = record({ sourceProvider: 'apollo', sourceUrl: 'https://a.example' })
    const same = record({ sourceProvider: 'apollo', sourceUrl: 'https://b.example' })

    expect(scoreConfidence(winner, [same], [])).toBeCloseTo(winner.confidence, 5)
  })

  it('applies diminishing returns — the fifth source is worth less than the second', () => {
    const winner = record({ sourceProvider: 'apollo', confidence: 0.7 })
    const agreeing = (n: number) =>
      Array.from({ length: n }, (_, index) => record({ sourceProvider: `p${index}` }))

    const first = scoreConfidence(winner, agreeing(1), [])
    const second = scoreConfidence(winner, agreeing(2), [])
    const fourth = scoreConfidence(winner, agreeing(4), [])
    const fifth = scoreConfidence(winner, agreeing(5), [])

    // Like for like: what the 2nd source added, against what the 5th added.
    expect(second - first).toBeGreaterThan(fifth - fourth)
  })

  it('never reaches certainty, however many sources agree', () => {
    // A cell reading 100% invites a trust that web research cannot support.
    const winner = record({ sourceProvider: 'apollo', confidence: 0.95 })
    const many = Array.from({ length: 50 }, (_, index) => record({ sourceProvider: `p${index}` }))

    expect(scoreConfidence(winner, many, [])).toBeLessThanOrEqual(0.97)
  })
})

describe('scoreConfidence — dissent', () => {
  it('lowers confidence when another provider disagrees', () => {
    const winner = record({ sourceProvider: 'apollo', confidence: 0.8 })
    const dissenter = record({ sourceProvider: 'wikidata', confidence: 0.7 })

    expect(scoreConfidence(winner, [], [dissenter])).toBeLessThan(0.8)
  })

  it('scales the cut by the STRONGEST dissenter, not the count', () => {
    /*
     * One authoritative source saying otherwise is the alarming case. Five weak
     * scrapers repeating each other is not five times the doubt.
     */
    const winner = record({ sourceProvider: 'apollo', confidence: 0.8 })
    const strong = [record({ sourceProvider: 'sec', confidence: 0.95 })]
    const manyWeak = Array.from({ length: 5 }, (_, index) =>
      record({ sourceProvider: `weak${index}`, confidence: 0.3 }),
    )

    expect(scoreConfidence(winner, [], strong)).toBeLessThan(
      scoreConfidence(winner, [], manyWeak),
    )
  })

  it('never lets a haircut read as "no evidence"', () => {
    // Contested evidence is still evidence.
    const winner = record({ sourceProvider: 'apollo', confidence: 0.1 })
    const dissenter = record({ sourceProvider: 'sec', confidence: 1 })

    expect(scoreConfidence(winner, [], [dissenter])).toBeGreaterThanOrEqual(0.05)
  })

  it('ignores a "dissenter" that is the winner’s own provider', () => {
    const winner = record({ sourceProvider: 'apollo', confidence: 0.8 })
    const itself = record({ sourceProvider: 'apollo', confidence: 0.9 })

    expect(scoreConfidence(winner, [], [itself])).toBeCloseTo(0.8, 5)
  })
})

describe('resolveConflict surfaces corroboration', () => {
  it('separates agreement from dispute', () => {
    const winner = record({
      sourceProvider: 'apollo',
      sourceConfidence: 'high',
      confidence: 0.8,
    })
    const agrees = record({ sourceProvider: 'wikidata', value: { industry: 'Software' } })
    const disagrees = record({ sourceProvider: 'gdelt', value: { industry: 'Retail' } })

    const knowledge = resolveConflict([winner, agrees, disagrees])

    expect(knowledge.state).toBe('known')
    if (knowledge.state !== 'known') return
    expect(knowledge.record.sourceProvider).toBe('apollo')
    expect(knowledge.corroborating.map((r) => r.sourceProvider)).toEqual(['wikidata'])
    expect(knowledge.conflicting.map((r) => r.sourceProvider)).toEqual(['gdelt'])
  })

  it('reports an answer confidence distinct from the winning record’s own', () => {
    /*
     * `record.confidence` is what the PROVIDER claimed; rewriting it would
     * misreport the provider. The answer's confidence is a separate number.
     */
    const winner = record({ sourceProvider: 'apollo', sourceConfidence: 'high', confidence: 0.7 })
    const agrees = record({ sourceProvider: 'wikidata' })

    const knowledge = resolveConflict([winner, agrees])
    if (knowledge.state !== 'known') throw new Error('expected known')

    expect(knowledge.record.confidence).toBe(0.7)
    expect(knowledge.confidence).toBeGreaterThan(0.7)
  })

  it('does not change which record wins', () => {
    // Winner selection is unchanged by this phase: source tier, then
    // confidence, then recency.
    const low = record({ sourceProvider: 'a', sourceConfidence: 'low', confidence: 0.99 })
    const high = record({ sourceProvider: 'b', sourceConfidence: 'high', confidence: 0.4, value: { industry: 'Retail' } })

    const knowledge = resolveConflict([low, high])
    if (knowledge.state !== 'known') throw new Error('expected known')

    expect(knowledge.record.sourceProvider).toBe('b')
  })

  it('leaves unknown states untouched', () => {
    expect(resolveConflict([])).toEqual({ state: 'unknown', reason: 'never_researched' })
  })
})
