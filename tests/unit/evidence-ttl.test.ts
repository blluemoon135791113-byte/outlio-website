/**
 * Evidence freshness, conflict resolution, and validation.
 *
 * Three invariants:
 *
 *  1. Fresh evidence is reused and NEVER re-bought (spec §8).
 *  2. When sources disagree, the more authoritative and more recent one wins,
 *     and the loser is preserved rather than deleted (spec §17).
 *  3. Anything that is not well-formed evidence is REJECTED, never repaired.
 *     That is the "no evidence, no result" rule (spec acceptance Test 10).
 */
import { describe, expect, it } from 'vitest'

import {
  evidenceKey,
  indexEvidence,
  resolveConflict,
  validateEvidence,
} from '@/lib/intelligence/evidence'
import {
  FIELD_TTL_SECONDS,
  expiresAtFor,
  isFresh,
  parseTtlOverrides,
  ttlSecondsFor,
} from '@/lib/intelligence/ttl'
import { RESEARCH_FIELDS, type EvidenceRecord } from '@/lib/intelligence/types'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const NOW = new Date('2026-08-14T12:00:00.000Z')

function record(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    entityType: 'company',
    entityId: COMPANY,
    field: 'employee_count',
    value: { count: 34 },
    sourceProvider: 'stub',
    sourceUrl: null,
    sourceConfidence: 'medium',
    confidence: 0.8,
    retrievedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    researchRunId: null,
    ...over,
  }
}

describe('TTL configuration', () => {
  it('assigns a TTL to every field, so none can silently never expire', () => {
    for (const field of RESEARCH_FIELDS) {
      expect(FIELD_TTL_SECONDS, field).toHaveProperty(field)
    }
  })

  it('expires fast-moving signals sooner than slow-moving facts', () => {
    // A stale buying signal is worse than no signal.
    expect(FIELD_TTL_SECONDS.hiring_signals!).toBeLessThan(FIELD_TTL_SECONDS.industry!)
    expect(FIELD_TTL_SECONDS.recent_news!).toBeLessThan(FIELD_TTL_SECONDS.funding_round!)
    // Contact data is expensive and slow to change: do not re-buy it weekly.
    expect(FIELD_TTL_SECONDS.work_email!).toBeGreaterThan(FIELD_TTL_SECONDS.hiring_signals!)
  })

  it('computes expiry from the retrieval time', () => {
    const expiry = expiresAtFor('recent_news', NOW)
    expect(expiry).not.toBeNull()
    expect(expiry!.getTime() - NOW.getTime()).toBe(FIELD_TTL_SECONDS.recent_news! * 1000)
  })

  it('treats an expiry of exactly now as stale', () => {
    // The boundary belongs on the side that re-researches.
    expect(isFresh(NOW.toISOString(), NOW)).toBe(false)
    expect(isFresh(new Date(NOW.getTime() + 1).toISOString(), NOW)).toBe(true)
  })

  it('treats evidence with no expiry as always fresh', () => {
    expect(isFresh(null, NOW)).toBe(true)
  })

  it('treats an unparseable expiry as stale rather than trusting it', () => {
    expect(isFresh('not a date', NOW)).toBe(false)
  })

  it('applies environment overrides and ignores malformed ones', () => {
    const overrides = parseTtlOverrides('tech_stack=60,not_a_field=10,recent_news=abc,=5')
    expect(overrides).toEqual({ tech_stack: 60 })
    expect(ttlSecondsFor('tech_stack', overrides)).toBe(60)
    expect(ttlSecondsFor('recent_news', overrides)).toBe(FIELD_TTL_SECONDS.recent_news)
  })

  it('ignores an empty override string', () => {
    expect(parseTtlOverrides(undefined)).toEqual({})
    expect(parseTtlOverrides('')).toEqual({})
  })
})

describe('resolveConflict', () => {
  it('reports unknown when nothing was ever researched', () => {
    expect(resolveConflict([], NOW)).toEqual({
      state: 'unknown',
      reason: 'never_researched',
    })
  })

  it('distinguishes expired from never researched', () => {
    const stale = record({ expiresAt: new Date(NOW.getTime() - 1000).toISOString() })
    expect(resolveConflict([stale], NOW)).toEqual({ state: 'unknown', reason: 'expired' })
  })

  it('prefers the more authoritative source', () => {
    const low = record({ id: 'a', sourceConfidence: 'low', value: { count: 10 } })
    const high = record({ id: 'b', sourceConfidence: 'high', value: { count: 34 } })

    const result = resolveConflict([low, high], NOW)
    expect(result.state).toBe('known')
    if (result.state !== 'known') return
    expect(result.record.id).toBe('b')
    expect(result.conflicting.map((r) => r.id)).toEqual(['a'])
  })

  it('breaks a tie on source with per-record confidence, then recency', () => {
    const older = record({
      id: 'a',
      confidence: 0.9,
      retrievedAt: new Date(NOW.getTime() - 10_000).toISOString(),
      value: { count: 10 },
    })
    const newer = record({
      id: 'b',
      confidence: 0.9,
      retrievedAt: NOW.toISOString(),
      value: { count: 34 },
    })

    const result = resolveConflict([older, newer], NOW)
    if (result.state !== 'known') throw new Error('expected known')
    expect(result.record.id).toBe('b')
  })

  it('never lets a stale authoritative record beat a fresh weaker one', () => {
    // Otherwise TTLs would be decorative.
    const staleHigh = record({
      id: 'a',
      sourceConfidence: 'high',
      expiresAt: new Date(NOW.getTime() - 1).toISOString(),
      value: { count: 10 },
    })
    const freshLow = record({ id: 'b', sourceConfidence: 'low', value: { count: 34 } })

    const result = resolveConflict([staleHigh, freshLow], NOW)
    if (result.state !== 'known') throw new Error('expected known')
    expect(result.record.id).toBe('b')
  })

  it('treats agreement as corroboration, not conflict', () => {
    const a = record({ id: 'a', sourceProvider: 'one', value: { count: 34 } })
    const b = record({ id: 'b', sourceProvider: 'two', value: { count: 34 } })

    const result = resolveConflict([a, b], NOW)
    if (result.state !== 'known') throw new Error('expected known')
    expect(result.conflicting).toHaveLength(0)
  })
})

describe('indexEvidence', () => {
  it('resolves each entity and field independently', () => {
    const index = indexEvidence(
      [
        record({ field: 'employee_count' }),
        record({ field: 'industry', value: { industry: 'B2B SaaS' } }),
        record({ entityId: '33333333-3333-4333-8333-333333333333', field: 'employee_count' }),
      ],
      NOW,
    )

    expect(index.size).toBe(3)
    expect(index.get(evidenceKey('company', COMPANY, 'industry'))?.state).toBe('known')
  })
})

describe('validateEvidence', () => {
  const good = {
    field: 'employee_count',
    entityType: 'company',
    entityId: COMPANY,
    value: { count: 34 },
    sourceProvider: 'stub',
    sourceUrl: 'https://example.com/about',
    sourceConfidence: 'high',
    confidence: 0.94,
    retrievedAt: NOW.toISOString(),
    expiresAt: null,
  }

  it('accepts well-formed evidence', () => {
    const { valid, rejected } = validateEvidence([good])
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(0)
  })

  it('rejects a field the system does not know', () => {
    const { valid } = validateEvidence([{ ...good, field: 'astrological_sign' }])
    expect(valid).toHaveLength(0)
  })

  it('rejects a bare scalar value, so units can never be ambiguous', () => {
    expect(validateEvidence([{ ...good, value: 34 }]).valid).toHaveLength(0)
  })

  it('rejects a confidence outside 0–1 instead of clamping it', () => {
    expect(validateEvidence([{ ...good, confidence: 1.5 }]).valid).toHaveLength(0)
    expect(validateEvidence([{ ...good, confidence: -1 }]).valid).toHaveLength(0)
  })

  it('rejects an unrecognised source confidence', () => {
    expect(validateEvidence([{ ...good, sourceConfidence: 'certain' }]).valid).toHaveLength(0)
  })

  it('rejects an entity id that is not a uuid', () => {
    expect(validateEvidence([{ ...good, entityId: 'acme.com' }]).valid).toHaveLength(0)
  })

  it('rejects a source url that is not a url', () => {
    expect(validateEvidence([{ ...good, sourceUrl: 'javascript:alert(1)' }]).valid).toHaveLength(0)
  })

  it('rejects garbage without throwing', () => {
    const { valid, rejected } = validateEvidence([null, undefined, 'text', 42, {}])
    expect(valid).toHaveLength(0)
    expect(rejected).toHaveLength(5)
  })

  it('keeps the good items when one item in a batch is bad', () => {
    const { valid, rejected } = validateEvidence([good, { ...good, confidence: 9 }])
    expect(valid).toHaveLength(1)
    expect(rejected).toHaveLength(1)
  })

  it('does not put the rejected value into the reason', () => {
    // Rejection reasons reach logs. A lead's name must never ride along.
    const { rejected } = validateEvidence([
      { ...good, confidence: 9, value: { name: 'Jordan Rivera' } },
    ])
    expect(rejected[0]!.reason).not.toContain('Jordan')
  })
})
