import 'server-only'

/**
 * Qualification profile persistence.
 *
 * ⚠️ Service role. RLS is bypassed, so every query scopes by `userId` in code.
 *
 * The scoring itself lives in `score.ts` and is pure — this file only moves
 * criteria and results in and out of the database, so the arithmetic stays
 * testable without one.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { ResearchField } from '@/lib/intelligence/types'
import type {
  Criterion,
  CriterionKind,
  CriterionOperator,
  QualificationProfile,
  QualificationResult,
} from '@/lib/qualification/score'
import type { Json } from '@/types/database'

export type StoredProfile = QualificationProfile & {
  description: string | null
  qualifyAt: number
}

function concise(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? ''
  return first.length > 160 ? `${first.slice(0, 160)}…` : first
}

export type SaveProfileInput = {
  name: string
  description?: string | null
  qualifyAt?: number
  criteria: Array<Omit<Criterion, 'id'> & { id?: string }>
}

/**
 * Creates a profile and its rules.
 *
 * Rules are inserted after the profile, and a rule the database refuses —
 * notably a criterion on a field outside the research vocabulary — takes the
 * whole profile down with it rather than leaving a half-configured ICP that
 * silently scores against fewer criteria than the user thinks.
 */
export async function createProfile(
  userId: string,
  input: SaveProfileInput,
): Promise<{ ok: true; profileId: string } | { ok: false; reason: string }> {
  const supabase = createAdminClient()

  const { data: profile, error } = await supabase
    .from('qualification_profiles')
    .insert({
      user_id: userId,
      name: input.name.trim(),
      description: input.description ?? null,
      qualify_at: input.qualifyAt ?? 60,
    })
    .select('id')
    .single()

  if (error || !profile) {
    return { ok: false, reason: concise(error?.message ?? 'profile could not be created') }
  }

  if (input.criteria.length > 0) {
    const rows = input.criteria.map((criterion, index) => ({
      user_id: userId,
      profile_id: profile.id,
      field: criterion.field,
      operator: criterion.operator,
      value: (criterion.value ?? null) as Json,
      value_path: criterion.valuePath ?? null,
      weight: criterion.weight,
      kind: criterion.kind,
      sort_order: index,
    }))

    const { error: ruleError } = await supabase.from('qualification_rules').insert(rows)

    if (ruleError) {
      // Roll back rather than keep a profile whose criteria are incomplete.
      await supabase
        .from('qualification_profiles')
        .delete()
        .eq('id', profile.id)
        .eq('user_id', userId)

      return { ok: false, reason: concise(ruleError.message) }
    }
  }

  return { ok: true, profileId: profile.id }
}

/** Loads a profile with its rules, in configured order. */
export async function getProfile(
  userId: string,
  profileId: string,
): Promise<StoredProfile | null> {
  const supabase = createAdminClient()

  const { data: profile } = await supabase
    .from('qualification_profiles')
    .select('id, name, description, qualify_at')
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!profile) return null

  const { data: rules } = await supabase
    .from('qualification_rules')
    .select('id, field, operator, value, value_path, weight, kind, sort_order')
    .eq('profile_id', profileId)
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    qualifyAt: profile.qualify_at,
    criteria: (rules ?? []).map((rule) => ({
      id: rule.id,
      field: rule.field as ResearchField,
      operator: rule.operator as CriterionOperator,
      value: rule.value ?? undefined,
      valuePath: rule.value_path ?? undefined,
      weight: rule.weight,
      kind: rule.kind as CriterionKind,
    })),
  }
}

export async function listProfiles(userId: string): Promise<StoredProfile[]> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('qualification_profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('created_at', { ascending: true })

  const profiles: StoredProfile[] = []
  for (const row of data ?? []) {
    const profile = await getProfile(userId, row.id)
    if (profile) profiles.push(profile)
  }
  return profiles
}

export async function deleteProfile(userId: string, profileId: string): Promise<void> {
  await createAdminClient()
    .from('qualification_profiles')
    .delete()
    .eq('id', profileId)
    .eq('user_id', userId)
}

/**
 * Persists scoring results for a run.
 *
 * `breakdown` carries the per-criterion outcomes, so "why qualified?" is always
 * answered from the arithmetic that produced the score rather than from prose
 * written afterwards.
 */
export async function saveResults(
  userId: string,
  researchRunId: string | null,
  profileId: string | null,
  results: readonly QualificationResult[],
): Promise<number> {
  if (results.length === 0) return 0

  const supabase = createAdminClient()

  const rows = results.map((result) => ({
    user_id: userId,
    research_run_id: researchRunId,
    profile_id: profileId,
    entity_type: result.entityType,
    entity_id: result.entityId,
    score: result.score,
    qualified: result.qualified,
    disqualified_by: result.disqualifiedBy,
    unknown_count: result.unknownCount,
    breakdown: result.results as unknown as Json,
  }))

  let written = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('qualification_results').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`saveResults failed: ${concise(error.message)}`)
    written += rows.slice(i, i + 500).length
  }

  return written
}
