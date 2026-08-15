/**
 * Qualification persistence, against the real database.
 *
 * The case that matters most here is the last one: spec §44 is enforced by a
 * CHECK constraint, and a constraint is only real if it holds on the project
 * that actually stores customer data — not merely on a throwaway cluster.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { evidenceKey, type FieldKnowledge } from '@/lib/intelligence/evidence'
import type { EvidenceRecord } from '@/lib/intelligence/types'
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  saveResults,
} from '@/lib/qualification/repository'
import { scoreEntity } from '@/lib/qualification/score'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv, type TestAuthUser } from './helpers'

async function schemaReady(): Promise<boolean> {
  if (!hasSupabaseEnv) return false
  const { error } = await adminClient().from('qualification_profiles').select('id').limit(1)
  return error === null
}

const ready = await schemaReady()

if (hasSupabaseEnv && !ready) {
  console.warn('[qualification] SKIPPED — migration 0046 is not applied to this project.')
}

const describeIf = hasSupabaseEnv && ready ? describe : describe.skip

const COMPANY_ID = '00000000-0000-4000-8000-0000000000aa'

function known(field: EvidenceRecord['field'], value: Record<string, unknown>): [string, FieldKnowledge] {
  const record: EvidenceRecord = {
    id: `e-${field}`,
    entityType: 'company',
    entityId: COMPANY_ID,
    field,
    value,
    sourceProvider: 'test',
    sourceUrl: 'https://example.com/source',
    sourceConfidence: 'high',
    confidence: 0.9,
    retrievedAt: new Date().toISOString(),
    expiresAt: null,
    researchRunId: null,
  }
  return [evidenceKey('company', COMPANY_ID, field), { state: 'known', record, conflicting: [] }]
}

describeIf('qualification profiles', () => {
  let user: TestAuthUser

  beforeAll(async () => {
    user = await createAuthUser('qualification')
  })

  afterAll(async () => {
    if (user) await deleteTestUser(user.id)
  })

  it('round-trips a profile with its rules, in order', async () => {
    const created = await createProfile(user.id, {
      name: 'Seed SaaS ICP',
      description: 'B2B SaaS, 10-50 people, Seed or Series A',
      qualifyAt: 60,
      criteria: [
        { field: 'industry', operator: 'contains', value: 'software', weight: 20, kind: 'required' },
        { field: 'employee_count', operator: 'between', value: [10, 50], weight: 15, kind: 'preferred' },
        { field: 'funding_round', operator: 'in', value: ['Seed', 'Series A'], weight: 15, kind: 'preferred' },
        { field: 'tech_stack', operator: 'contains', value: 'salesforce', weight: 0, kind: 'excluded', valuePath: 'detected' },
      ],
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const loaded = await getProfile(user.id, created.profileId)

    expect(loaded?.name).toBe('Seed SaaS ICP')
    expect(loaded?.qualifyAt).toBe(60)
    expect(loaded?.criteria.map((c) => c.field)).toEqual([
      'industry',
      'employee_count',
      'funding_round',
      'tech_stack',
    ])
    expect(loaded?.criteria[3]?.kind).toBe('excluded')
    expect(loaded?.criteria[3]?.valuePath).toBe('detected')
    expect(loaded?.criteria[1]?.value).toEqual([10, 50])
  })

  it('scores real evidence against a stored profile', async () => {
    const created = await createProfile(user.id, {
      name: 'Scoring profile',
      criteria: [
        { field: 'industry', operator: 'contains', value: 'software', weight: 20, kind: 'preferred' },
        { field: 'employee_count', operator: 'between', value: [10, 50], weight: 15, kind: 'preferred' },
      ],
    })
    if (!created.ok) throw new Error('profile was not created')

    const profile = await getProfile(user.id, created.profileId)
    expect(profile).not.toBeNull()

    const result = scoreEntity(
      profile!,
      { id: COMPANY_ID, type: 'company' },
      new Map([known('industry', { industry: 'software' }), known('employee_count', { count: 34 })]),
      { qualifyAtOrAbove: profile!.qualifyAt },
    )

    expect(result.score).toBe(100)
    expect(result.qualified).toBe(true)

    const written = await saveResults(user.id, null, created.profileId, [result])
    expect(written).toBe(1)

    const { data } = await adminClient()
      .from('qualification_results')
      .select('score, qualified, unknown_count, breakdown')
      .eq('user_id', user.id)
      .eq('entity_id', COMPANY_ID)
      .single()

    expect(data?.score).toBe(100)
    expect(data?.qualified).toBe(true)
    // The per-criterion breakdown is stored, so "why qualified?" is answerable
    // from the arithmetic rather than reconstructed later.
    expect(Array.isArray(data?.breakdown)).toBe(true)
    expect((data?.breakdown as unknown[]).length).toBe(2)
  })

  it('REFUSES a criterion on a protected characteristic', async () => {
    // Spec §44, enforced by CHECK constraint on the live project.
    const created = await createProfile(user.id, {
      name: 'Non-compliant profile',
      criteria: [
        { field: 'religion' as never, operator: 'equals', value: 'x', weight: 10, kind: 'required' },
      ],
    })

    expect(created.ok).toBe(false)

    // And the half-built profile must not survive the rejection.
    const remaining = await listProfiles(user.id)
    expect(remaining.some((profile) => profile.name === 'Non-compliant profile')).toBe(false)
  })

  it('rolls the profile back when any rule is rejected', async () => {
    const created = await createProfile(user.id, {
      name: 'Partially valid profile',
      criteria: [
        { field: 'industry', operator: 'contains', value: 'software', weight: 20, kind: 'preferred' },
        { field: 'ethnicity' as never, operator: 'equals', value: 'x', weight: 10, kind: 'preferred' },
      ],
    })

    expect(created.ok).toBe(false)

    // A profile scoring on only the criteria that happened to be legal would be
    // worse than none at all — it would silently mean something different.
    const remaining = await listProfiles(user.id)
    expect(remaining.some((profile) => profile.name === 'Partially valid profile')).toBe(false)
  })

  it("does not let one user read another's profile", async () => {
    const created = await createProfile(user.id, {
      name: 'Private ICP',
      criteria: [{ field: 'industry', operator: 'exists', weight: 10, kind: 'preferred' }],
    })
    if (!created.ok) throw new Error('profile was not created')

    const intruder = await createAuthUser('qualification-intruder')
    try {
      expect(await getProfile(intruder.id, created.profileId)).toBeNull()
      expect(await listProfiles(intruder.id)).toHaveLength(0)

      // A delete scoped to the wrong user must be a no-op, not a deletion.
      await deleteProfile(intruder.id, created.profileId)
      expect(await getProfile(user.id, created.profileId)).not.toBeNull()
    } finally {
      await deleteTestUser(intruder.id)
    }
  })

  it('rejects a weight outside 0-100 and a threshold outside 0-100', async () => {
    expect(
      (
        await createProfile(user.id, {
          name: 'Bad weight',
          criteria: [{ field: 'industry', operator: 'exists', weight: 500, kind: 'preferred' }],
        })
      ).ok,
    ).toBe(false)

    expect(
      (
        await createProfile(user.id, {
          name: 'Bad threshold',
          qualifyAt: 900,
          criteria: [],
        })
      ).ok,
    ).toBe(false)
  })
})
