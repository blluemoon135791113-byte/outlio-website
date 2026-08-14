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
  | { state: 'known'; record: EvidenceRecord; conflicting: EvidenceRecord[] }
  | { state: 'unknown'; reason: 'never_researched' | 'expired' | 'unavailable' }

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
  return {
    state: 'known',
    record: winner!,
    // Only records that actually disagree are a conflict. Two providers
    // agreeing is corroboration, and reporting it as a dispute is noise.
    conflicting: rest.filter(
      (record) => JSON.stringify(record.value) !== JSON.stringify(winner!.value),
    ),
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
