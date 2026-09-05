import 'server-only'

import type { Database } from '@/types/database'

/**
 * Evidence persistence — the "check Outlio first" half of the system (spec §8).
 *
 * ⚠️ Service role. RLS is bypassed, so every query here scopes by `userId` in
 * code. Semantics (freshness, conflicts, validation) live in `evidence.ts` and
 * are unit-tested without a database.
 */
import {
  evidenceKey,
  indexEvidence,
  validateEvidence,
  type FieldKnowledge,
} from '@/lib/intelligence/evidence'
import type {
  EntityType,
  EvidenceRecord,
  NormalizedEvidence,
  ResearchField,
} from '@/lib/intelligence/types'
import { createAdminClient } from '@/lib/supabase/admin'

/** Rows per query. Keeps a single `.in()` filter well inside URL length limits. */
const READ_BATCH_SIZE = 200

const EVIDENCE_SELECT =
  'id, entity_type, entity_id, field, value_json, source_provider, source_url, ' +
  'source_confidence, confidence, retrieved_at, expires_at, research_run_id'

type EvidenceRow = {
  id: string
  entity_type: EntityType
  entity_id: string
  field: ResearchField
  value_json: Record<string, unknown>
  source_provider: string
  source_url: string | null
  source_confidence: EvidenceRecord['sourceConfidence']
  confidence: number
  retrieved_at: string
  expires_at: string | null
  research_run_id: string | null
}

function toRecord(row: EvidenceRow): EvidenceRecord {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    field: row.field,
    value: row.value_json,
    sourceProvider: row.source_provider,
    sourceUrl: row.source_url,
    sourceConfidence: row.source_confidence,
    confidence: Number(row.confidence),
    retrievedAt: row.retrieved_at,
    expiresAt: row.expires_at,
    researchRunId: row.research_run_id,
  }
}

export type EvidenceQuery = {
  entityType: EntityType
  entityIds: readonly string[]
  fields: readonly ResearchField[]
}

/**
 * What Outlio already knows about these entities and fields.
 *
 * ⚠️ CALL THIS BEFORE ANY PAID PROVIDER. Every entry it returns is one external
 * call the router will not make (spec §8).
 *
 * Expired rows are still fetched, so the caller can distinguish "never looked"
 * from "looked, but it went stale" — the two produce different UI and different
 * cost estimates.
 */
export async function readEvidence(
  userId: string,
  queries: readonly EvidenceQuery[],
  now: Date = new Date(),
): Promise<Map<string, FieldKnowledge>> {
  if (!userId) throw new Error('readEvidence: userId is required')

  const supabase = createAdminClient()
  const records: EvidenceRecord[] = []

  for (const query of queries) {
    if (query.entityIds.length === 0 || query.fields.length === 0) continue

    for (let i = 0; i < query.entityIds.length; i += READ_BATCH_SIZE) {
      const { data, error } = await supabase
        .from('research_evidence')
        .select(EVIDENCE_SELECT)
        // Service role bypasses RLS — scoping by user_id is mandatory.
        .eq('user_id', userId)
        .eq('entity_type', query.entityType)
        .in('entity_id', query.entityIds.slice(i, i + READ_BATCH_SIZE))
        .in('field', query.fields as string[])
        .order('retrieved_at', { ascending: false })

      if (error) throw new Error(`readEvidence failed: ${error.message}`)

      for (const row of (data ?? []) as unknown as EvidenceRow[]) {
        records.push(toRecord(row))
      }
    }
  }

  return indexEvidence(records, now)
}

export type WriteEvidenceResult = {
  written: number
  /** Provider output that failed validation. Reported, never persisted. */
  rejected: number
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function evidenceIdentity(input: {
  entityType: string
  entityId: string
  field: string
  value: unknown
  sourceProvider: string
  sourceUrl: string | null
}): string {
  return [
    input.entityType,
    input.entityId,
    input.field,
    input.sourceProvider,
    input.sourceUrl ?? '',
    canonicalJson(input.value),
  ].join('\u001f')
}

/**
 * Persists validated evidence.
 *
 * Insert-only. A newer observation sits alongside the old one rather than
 * overwriting it, so a disagreement between two providers stays inspectable
 * and `resolveConflict` can adjudicate it later.
 */
export async function writeEvidence(
  userId: string,
  researchRunId: string | null,
  items: readonly unknown[],
): Promise<WriteEvidenceResult> {
  if (!userId) throw new Error('writeEvidence: userId is required')

  const { valid, rejected } = validateEvidence(items)
  if (valid.length === 0) return { written: 0, rejected: rejected.length }

  // A provider retry must not append the same observation twice. Conflicting
  // values remain distinct because the normalized value is part of the key.
  const unique = [...new Map(valid.map((item) => [evidenceIdentity(item), item])).values()]

  const supabase = createAdminClient()

  const rows = unique.map((evidence: NormalizedEvidence) => ({
    user_id: userId,
    entity_type: evidence.entityType,
    entity_id: evidence.entityId,
    field: evidence.field,
    value_json: evidence.value,
    source_provider: evidence.sourceProvider,
    source_url: evidence.sourceUrl,
    source_confidence: evidence.sourceConfidence,
    confidence: evidence.confidence,
    retrieved_at: evidence.retrievedAt,
    expires_at: evidence.expiresAt,
    research_run_id: researchRunId,
  })) as unknown as Database['public']['Tables']['research_evidence']['Insert'][]

  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batchEvidence = unique.slice(i, i + 500)
    const batchRows = rows.slice(i, i + 500)
    const entityIds = [...new Set(batchEvidence.map((item) => item.entityId))]
    const fields = [...new Set(batchEvidence.map((item) => item.field))]
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { data: existing, error: readError } = await supabase
      .from('research_evidence')
      .select('entity_type, entity_id, field, value_json, source_provider, source_url')
      .eq('user_id', userId)
      .in('entity_id', entityIds)
      .in('field', fields as string[])
      .gte('retrieved_at', since)

    if (readError) throw new Error(`writeEvidence dedupe failed: ${readError.message}`)

    const existingKeys = new Set((existing ?? []).map((row) => evidenceIdentity({
      entityType: row.entity_type,
      entityId: row.entity_id,
      field: row.field,
      value: row.value_json,
      sourceProvider: row.source_provider,
      sourceUrl: row.source_url,
    })))
    const insertRows = batchRows.filter((_row, index) =>
      !existingKeys.has(evidenceIdentity(batchEvidence[index]!)),
    )
    if (insertRows.length === 0) continue

    const { error } = await supabase.from('research_evidence').insert(insertRows)
    if (error) throw new Error(`writeEvidence failed: ${error.message}`)
    written += insertRows.length
  }

  return { written, rejected: rejected.length }
}

/**
 * Records one external call, whatever its outcome (spec §48).
 *
 * Non-fatal by design: losing a telemetry row must never fail research that
 * otherwise succeeded.
 *
 * ⚠️ Never pass a raw provider message. `errorCode` is a catalog code.
 */
export async function recordToolCalls(
  userId: string,
  researchRunId: string | null,
  calls: readonly {
    provider: string
    tool: string
    entityType: EntityType
    entityId: string
    status: 'success' | 'not_found' | 'error' | 'timeout' | 'skipped'
    latencyMs: number
    estimatedCostMicros: number
    errorCode: string | null
  }[],
): Promise<void> {
  if (calls.length === 0) return

  try {
    const supabase = createAdminClient()
    const rows = calls.map((call) => ({
      user_id: userId,
      research_run_id: researchRunId,
      provider: call.provider,
      tool: call.tool,
      entity_type: call.entityType,
      entity_id: call.entityId,
      status: call.status,
      latency_ms: call.latencyMs,
      estimated_cost_micros: call.estimatedCostMicros,
      error_code: call.errorCode,
    }))

    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from('research_tool_calls').insert(rows.slice(i, i + 500))
    }
  } catch {
    // Observability is not worth failing a paid run over.
  }
}

export { evidenceKey }
