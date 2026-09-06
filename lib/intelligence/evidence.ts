/**
 * Evidence semantics.
 *
 * PURE — no I/O, so every branch is unit-tested without a database. The
 * database half lives in `evidence-store.ts`, exactly as `lib/auth/decide.ts`
 * splits from `lib/auth/access.ts`.
 *
 * The rule that shapes this file: **absence of evidence is `unknown`, never
 * `false`** (spec §49). "This company does not use HubSpot" and "we could not
 * find out" are different answers, and collapsing them produces confidently
 * wrong lists.
 */
import {
  SOURCE_CONFIDENCE_RANK,
  normalizedEvidenceSchema,
  type EntityType,
  type EvidenceRecord,
  type NormalizedEvidence,
  type ResearchField,
} from '@/lib/intelligence/types'
import { isFresh } from '@/lib/intelligence/ttl'

/** Lookup key for one fact about one entity. */
export function evidenceKey(
  entityType: EntityType,
  entityId: string,
  field: ResearchField,
): string {
  return `${entityType}:${entityId}:${field}`
}

/**
 * What the system knows about one field.
 *
 * `unknown` is a first-class answer with a reason attached, so a result table
 * can honestly say "provider unavailable" instead of showing a blank cell that
 * reads as "no".
 */
export type FieldKnowledge =
  | {
      state: 'known'
      record: EvidenceRecord
      conflicting: EvidenceRecord[]
      /**
       * Fresh records from OTHER providers that reached the same value.
       * Previously these were computed, discarded, and never seen again — so
       * "three independent sources agree" looked identical to "one source
       * said so".
       */
      corroborating: EvidenceRecord[]
      /**
       * The confidence of the ANSWER, which is not the confidence of the
       * winning record. Agreement raises it, dissent lowers it. Kept separate
       * from `record.confidence` because that is what the provider claimed and
       * rewriting it would misreport the provider.
       */
      confidence: number
    }
  | { state: 'unknown'; reason: 'never_researched' | 'expired' | 'unavailable' }

/**
 * Certainty is not available from web research, so the engine cannot express
 * it. A cell that reads 100% invites a trust the method cannot support.
 */
const CONFIDENCE_CEILING = 0.97

/** Contested evidence is still evidence. Never let a haircut read as "nothing". */
const CONFIDENCE_FLOOR = 0.05

/** Each independent corroborator closes this much of the gap to the ceiling. */
const CORROBORATION_GAIN = 0.3

/** How hard the strongest dissenting provider cuts the answer. */
const DISSENT_PENALTY = 0.4

function sameValue(a: EvidenceRecord, b: EvidenceRecord): boolean {
  return JSON.stringify(a.value) === JSON.stringify(b.value)
}

/**
 * Scores the ANSWER, given the winner and everyone else who was fresh.
 *
 * ⚠️ INDEPENDENCE IS BY PROVIDER, NOT BY RECORD. The same provider returning
 * the same value on two URLs is ONE source agreeing with itself — a systematic
 * error in that provider produces both rows, so counting them twice would
 * manufacture confidence out of a single point of failure. Only a provider the
 * winner did not come from can corroborate it.
 *
 * Diminishing returns are deliberate: the second independent source is worth
 * far more than the fifth.
 */
export function scoreConfidence(
  winner: EvidenceRecord,
  corroborating: readonly EvidenceRecord[],
  conflicting: readonly EvidenceRecord[],
): number {
  let confidence = Math.min(winner.confidence, CONFIDENCE_CEILING)

  const agreeing = new Set(corroborating.map((record) => record.sourceProvider))
  agreeing.delete(winner.sourceProvider)
  for (let index = 0; index < agreeing.size; index += 1) {
    confidence += (CONFIDENCE_CEILING - confidence) * CORROBORATION_GAIN
  }

  /*
   * Dissent is scaled by the STRONGEST dissenter, not by how many there are.
   * One authoritative source saying otherwise is the alarming case; five weak
   * scrapers repeating each other is not five times the doubt.
   */
  const dissenters = conflicting.filter(
    (record) => record.sourceProvider !== winner.sourceProvider,
  )
  if (dissenters.length > 0) {
    const strongest = Math.max(...dissenters.map((record) => record.confidence))
    confidence *= 1 - DISSENT_PENALTY * strongest
  }

  return Math.min(CONFIDENCE_CEILING, Math.max(CONFIDENCE_FLOOR, confidence))
}

/**
 * Picks the authoritative record when sources disagree (spec §17).
 *
 * Order: higher source confidence, then higher per-record confidence, then more
 * recent. Losers are returned rather than discarded — a conflict is information,
 * and a user inspecting a surprising result deserves to see both claims.
 *
 * Only FRESH records are eligible. A stale high-confidence record must not beat
 * a fresh medium-confidence one; that would make TTLs meaningless.
 */
export function resolveConflict(
  records: readonly EvidenceRecord[],
  now: Date = new Date(),
): FieldKnowledge {
  if (records.length === 0) {
    return { state: 'unknown', reason: 'never_researched' }
  }

  const fresh = records.filter((record) => isFresh(record.expiresAt, now))
  if (fresh.length === 0) {
    return { state: 'unknown', reason: 'expired' }
  }

  const ranked = [...fresh].sort((a, b) => {
    const bySource =
      SOURCE_CONFIDENCE_RANK[b.sourceConfidence] - SOURCE_CONFIDENCE_RANK[a.sourceConfidence]
    if (bySource !== 0) return bySource

    const byConfidence = b.confidence - a.confidence
    if (byConfidence !== 0) return byConfidence

    return Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt)
  })

  const [winner, ...rest] = ranked
  // Only records that actually disagree are a conflict. Two providers agreeing
  // is corroboration, and reporting it as a dispute is noise.
  const conflicting = rest.filter((record) => !sameValue(record, winner!))
  const corroborating = rest.filter((record) => sameValue(record, winner!))

  return {
    state: 'known',
    record: winner!,
    conflicting,
    corroborating,
    confidence: scoreConfidence(winner!, corroborating, conflicting),
  }
}

/**
 * Collapses a flat list of records into one answer per entity+field.
 *
 * This is what the router consults to decide what still needs buying.
 */
export function indexEvidence(
  records: readonly EvidenceRecord[],
  now: Date = new Date(),
): Map<string, FieldKnowledge> {
  const grouped = new Map<string, EvidenceRecord[]>()

  for (const record of records) {
    const key = evidenceKey(record.entityType, record.entityId, record.field)
    const bucket = grouped.get(key)
    if (bucket) bucket.push(record)
    else grouped.set(key, [record])
  }

  const resolved = new Map<string, FieldKnowledge>()
  for (const [key, bucket] of grouped) {
    resolved.set(key, resolveConflict(bucket, now))
  }

  return resolved
}

export type EvidenceValidation = {
  valid: NormalizedEvidence[]
  /** Rejected items, with the reason. These are never persisted. */
  rejected: Array<{ reason: string }>
}

/**
 * Gate every provider output before it can become a stored fact.
 *
 * ⚠️ THIS IS THE "no evidence, no result" ENFORCEMENT POINT (spec acceptance
 * Test 10). Anything that fails validation is dropped and reported — never
 * repaired, never defaulted, never persisted. A provider returning a shape we
 * do not recognise is a provider whose claim we cannot stand behind.
 */
export function validateEvidence(items: readonly unknown[]): EvidenceValidation {
  const valid: NormalizedEvidence[] = []
  const rejected: Array<{ reason: string }> = []

  for (const item of items) {
    const parsed = normalizedEvidenceSchema.safeParse(item)
    if (parsed.success) {
      valid.push(parsed.data)
    } else {
      // The issue text describes the SHAPE, not the value, so a rejected
      // payload cannot leak lead data into a log.
      rejected.push({
        reason: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
          .join('; '),
      })
    }
  }

  return { valid, rejected }
}
