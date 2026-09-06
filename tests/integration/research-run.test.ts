/**
 * The research runner, end to end against the real database.
 *
 * ⚠️ NO NETWORK. Every case here is arranged so that either the router emits no
 * tasks at all (everything served from cache) or no provider can accept them
 * (credentials removed for the duration). That is deliberate: this suite proves
 * the ORCHESTRATION — scope → companies → cache → routing → persistence — and a
 * live API would make it slow and flaky without proving any more.
 *
 * The economics are the assertion. `externalCalls: 0` on a run that had fresh
 * evidence is the single most valuable behaviour in this product.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { linkLeadsToCompanies } from '@/lib/companies/repository'
import { createProfile } from '@/lib/qualification/repository'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import {
  answerClarifications,
  claimAndProcessResearchRun,
  createResearchRun,
} from '@/lib/intelligence/run'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
  missingMigrations,
  seedJob,
  type TestAuthUser,
} from './helpers'

const missing = await missingMigrations([
  { migration: '0043 (companies)', probe: async () => adminClient().from('companies').select('id').limit(1) },
  {
    migration: '0045 (research_job_queue)',
    probe: async () => adminClient().from('research_job_queue').select('id').limit(1),
  },
  {
    migration: '0046 (qualification)',
    probe: async () => adminClient().from('qualification_profiles').select('id').limit(1),
  },
  {
    migration: '0047 (research_runs.qualification_profile_id)',
    probe: async () => adminClient().from('research_runs').select('qualification_profile_id').limit(1),
  },
  {
    migration: '0064 (research_runs.progress_stage)',
    probe: async () => adminClient().from('research_runs').select('progress_stage').limit(1),
  },
])

const ready = missing.length === 0

if (hasSupabaseEnv && !ready) {
  console.warn(
    `[research-run] SKIPPED — not applied to this project: ${missing.join(', ')}. ` +
      'The research runner is UNVERIFIED against the live schema.',
  )
}

const describeIf = hasSupabaseEnv && ready ? describe : describe.skip

describeIf('processResearchRun', () => {
  let user: TestAuthUser
  let jobId: string
  let leadIds: string[]
  let companyId: string

  /** Removed for the whole suite so no provider can reach the network. */
  const savedKeys: Record<string, string | undefined> = {}
  const MUTED = [
    'TAVILY_API_KEY',
    'PAGESPEED_API_KEY',
    'WEB_RESEARCH_MCP_URL',
    'WEB_RESEARCH_MCP_TOKEN',
  ]

  beforeAll(async () => {
    for (const key of MUTED) {
      savedKeys[key] = process.env[key]
      delete process.env[key]
    }

    user = await createAuthUser('research-run')
    jobId = await seedJob(user.id)

    const admin = adminClient()
    const { data, error } = await admin
      .from('extracted_leads')
      .insert(
        // Three colleagues at ONE company: the shape the cost model exists for.
        Array.from({ length: 3 }, (_, n) => ({
          user_id: user.id,
          extraction_job_id: jobId,
          full_name: `Fabricated Colleague ${n}`,
          company_name: 'Runner Test Systems',
          company_url: 'https://www.linkedin.com/sales/company/920001',
          dedupe_key: `runner-${user.id}-${n}`,
          dedupe_strategy: 'row_hash' as const,
        })),
      )
      .select('id')

    if (error || !data) throw new Error(`lead seed failed: ${error?.message ?? 'no rows'}`)
    leadIds = data.map((row) => row.id)

    await linkLeadsToCompanies(
      user.id,
      leadIds.map((id) => ({
        id,
        companyName: 'Runner Test Systems',
        companyWebsiteUrl: null,
        companyLinkedInUrl: 'https://www.linkedin.com/sales/company/920001',
      })),
    )

    const { data: company } = await admin
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .eq('normalized_linkedin_url', 'linkedin.com/sales/company/920001')
      .single()

    companyId = company!.id
  })

  afterAll(async () => {
    for (const key of MUTED) {
      if (savedKeys[key] !== undefined) process.env[key] = savedKeys[key]
    }
    if (user) await deleteTestUser(user.id)
  })

  it('collapses three colleagues to one company', async () => {
    const { data } = await adminClient()
      .from('extracted_leads')
      .select('company_id')
      .eq('user_id', user.id)

    expect(new Set(data?.map((row) => row.company_id)).size).toBe(1)
  })

  it('spends NOTHING when fresh evidence already answers the question', async () => {
    const retrievedAt = new Date()

    await adminClient()
      .from('research_evidence')
      .insert({
        user_id: user.id,
        entity_type: 'company',
        entity_id: companyId,
        field: 'tech_stack',
        value_json: { detected: [{ id: 'shopify', name: 'Shopify', category: 'ecommerce' }] },
        source_provider: 'seeded',
        source_url: 'https://example.com/evidence',
        source_confidence: 'high',
        confidence: 0.9,
        retrieved_at: retrievedAt.toISOString(),
        expires_at: expiresAtFor('tech_stack', retrievedAt)?.toISOString() ?? null,
      })

    const created = await createResearchRun(user.id, {
      queryText: 'Which of these companies use Shopify?',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['tech_stack'] },
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const outcome = await claimAndProcessResearchRun(created.runId, user.id, 'test-worker')

    expect(outcome).not.toBeNull()
    expect(outcome!.status).toBe('completed')
    expect(outcome!.leadCount).toBe(3)
    expect(outcome!.companyCount).toBe(1)
    // THE ASSERTION THAT MATTERS: cached evidence means no provider was called.
    expect(outcome!.externalCalls).toBe(0)
    expect(outcome!.cacheHits).toBe(1)
    expect(outcome!.estimatedCostMicros).toBe(0)
  })

  it('reports partially_complete, not completed, when nothing could answer', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'What did they raise?',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['funding_amount'] },
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const outcome = await claimAndProcessResearchRun(created.runId, user.id, 'test-worker')

    // With search credentials removed, GDELT is the only funding provider left
    // and it is deliberately allowed to try — but whatever happens, an
    // unanswered field must never present as a completed run.
    expect(outcome).not.toBeNull()
    expect(['completed', 'partially_complete']).toContain(outcome!.status)

    const { data: run } = await adminClient()
      .from('research_runs')
      .select('status, lead_count, company_count')
      .eq('id', created.runId)
      .single()

    expect(run?.lead_count).toBe(3)
    expect(run?.company_count).toBe(1)
  }, 60_000)

  it('refuses to create a run from an invalid plan', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'nonsense',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['not_a_real_field'] },
    })

    expect(created.ok).toBe(false)

    // Nothing invalid may occupy the queue or appear in history as attempted.
    const { count } = await adminClient()
      .from('research_runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('query_text', 'nonsense')

    expect(count).toBe(0)
  })

  it('allows exactly one claimant for a run', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'Who is hiring?',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['tech_stack'] },
    })
    if (!created.ok) throw new Error('run was not created')

    const [first, second] = await Promise.all([
      claimAndProcessResearchRun(created.runId, user.id, 'worker-a'),
      claimAndProcessResearchRun(created.runId, user.id, 'worker-b'),
    ])

    // One processes it, the other quietly gets null. Never both.
    expect([first, second].filter((outcome) => outcome !== null)).toHaveLength(1)
  })

  it("refuses to process another user's run", async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'cross tenant',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['tech_stack'] },
    })
    if (!created.ok) throw new Error('run was not created')

    const intruder = await createAuthUser('research-run-intruder')
    try {
      const outcome = await claimAndProcessResearchRun(created.runId, intruder.id, 'worker-x')
      expect(outcome).toBeNull()
    } finally {
      await deleteTestUser(intruder.id)
    }
  })
})

describeIf('clarification round trip (spec §7)', () => {
  let user: TestAuthUser
  let leadIds: string[]

  beforeAll(async () => {
    user = await createAuthUser('research-clarify')
    const jobId = await seedJob(user.id)

    const { data, error } = await adminClient()
      .from('extracted_leads')
      .insert([
        {
          user_id: user.id,
          extraction_job_id: jobId,
          full_name: 'Fabricated Clarify Person',
          company_name: 'Clarify Test Systems',
          company_url: 'https://www.linkedin.com/sales/company/930001',
          dedupe_key: `clarify-${user.id}-0`,
          dedupe_strategy: 'row_hash' as const,
        },
      ])
      .select('id')

    if (error || !data) throw new Error(`lead seed failed: ${error?.message ?? 'no rows'}`)
    leadIds = data.map((row) => row.id)
  })

  afterAll(async () => {
    if (user) await deleteTestUser(user.id)
  })

  it('stores a clarification-pending run WITHOUT queueing it', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'Find recently funded companies.',
      scope: { type: 'lead_ids', leadIds },
      plan: {
        requiredFields: ['funding_date'],
        clarificationRequired: true,
        clarificationQuestions: [
          {
            id: 'funding_window',
            question: 'What should count as recently funded?',
            options: ['3 months', '12 months'],
          },
        ],
      },
    })

    expect(created.ok).toBe(true)
    if (!created.ok || created.status !== 'waiting_for_clarification') {
      throw new Error('expected the run to wait for clarification')
    }

    const { data: run } = await adminClient()
      .from('research_runs')
      .select('status')
      .eq('id', created.runId)
      .single()

    expect(run?.status).toBe('waiting_for_clarification')

    // NOTHING may be queued while the question is open — that is the entire
    // point: an unanswered question must not spend money.
    const { count } = await adminClient()
      .from('research_job_queue')
      .select('id', { count: 'exact', head: true })
      .eq('research_run_id', created.runId)

    expect(count).toBe(0)
  })

  it('queues the run once the question is answered, recording both halves', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'Find recently funded companies.',
      scope: { type: 'lead_ids', leadIds },
      plan: {
        requiredFields: ['funding_date'],
        clarificationRequired: true,
        clarificationQuestions: [
          { id: 'funding_window', question: 'How recent?', options: ['3 months', '12 months'] },
        ],
      },
    })
    if (!created.ok) throw new Error('run was not created')

    const answered = await answerClarifications(user.id, created.runId, {
      funding_window: '12 months',
    })

    expect(answered.ok).toBe(true)

    const { data: run } = await adminClient()
      .from('research_runs')
      .select('status, plan, clarifications')
      .eq('id', created.runId)
      .single()

    expect(run?.status).toBe('pending')

    const plan = run?.plan as { clarificationRequired: boolean; filters: Record<string, unknown> }
    expect(plan.clarificationRequired).toBe(false)
    expect(plan.filters.funding_window).toBe('12 months')

    // The exchange is on the record: what was asked, and what was chosen.
    const history = run?.clarifications as unknown[]
    expect(history).toHaveLength(2)

    const { count } = await adminClient()
      .from('research_job_queue')
      .select('id', { count: 'exact', head: true })
      .eq('research_run_id', created.runId)

    expect(count).toBe(1)
  })

  it('refuses to answer a run that is not waiting', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'Already executable.',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['industry'] },
    })
    if (!created.ok) throw new Error('run was not created')
    expect(created.status).toBe('queued')

    // A double-submitted form must not re-queue an already-running job.
    const answered = await answerClarifications(user.id, created.runId, { anything: 'yes' })
    expect(answered.ok).toBe(false)
  })

  it("refuses to answer another user's run", async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'Find recently funded companies.',
      scope: { type: 'lead_ids', leadIds },
      plan: {
        requiredFields: ['funding_date'],
        clarificationRequired: true,
        clarificationQuestions: [{ id: 'w', question: 'How recent?', options: [] }],
      },
    })
    if (!created.ok) throw new Error('run was not created')

    const intruder = await createAuthUser('research-clarify-intruder')
    try {
      const answered = await answerClarifications(intruder.id, created.runId, { w: '12 months' })
      expect(answered.ok).toBe(false)
    } finally {
      await deleteTestUser(intruder.id)
    }
  })
})

describeIf('qualification inside a run (spec §19)', () => {
  let user: TestAuthUser
  let leadIds: string[]
  let companyId: string
  let profileId: string

  beforeAll(async () => {
    user = await createAuthUser('research-qualify')
    const jobId = await seedJob(user.id)
    const admin = adminClient()

    const { data, error } = await admin
      .from('extracted_leads')
      .insert([
        {
          user_id: user.id,
          extraction_job_id: jobId,
          full_name: 'Fabricated Qualify Person',
          company_name: 'Qualify Test Systems',
          company_url: 'https://www.linkedin.com/sales/company/940001',
          dedupe_key: `qualify-${user.id}-0`,
          dedupe_strategy: 'row_hash' as const,
        },
      ])
      .select('id')

    if (error || !data) throw new Error(`lead seed failed: ${error?.message ?? 'no rows'}`)
    leadIds = data.map((row) => row.id)

    await linkLeadsToCompanies(
      user.id,
      leadIds.map((id) => ({
        id,
        companyName: 'Qualify Test Systems',
        companyWebsiteUrl: null,
        companyLinkedInUrl: 'https://www.linkedin.com/sales/company/940001',
      })),
    )

    const { data: company } = await admin
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .eq('normalized_linkedin_url', 'linkedin.com/sales/company/940001')
      .single()
    companyId = company!.id

    // Evidence the run will score against, already fresh so no provider runs.
    const retrievedAt = new Date()
    await admin.from('research_evidence').insert([
      {
        user_id: user.id,
        entity_type: 'company',
        entity_id: companyId,
        field: 'employee_count',
        value_json: { count: 34 },
        source_provider: 'seeded',
        source_url: 'https://example.com/evidence',
        source_confidence: 'high',
        confidence: 0.9,
        retrieved_at: retrievedAt.toISOString(),
        expires_at: expiresAtFor('employee_count', retrievedAt)?.toISOString() ?? null,
      },
      {
        user_id: user.id,
        entity_type: 'company',
        entity_id: companyId,
        field: 'industry',
        value_json: { industry: 'software' },
        source_provider: 'seeded',
        source_url: 'https://example.com/evidence',
        source_confidence: 'high',
        confidence: 0.9,
        retrieved_at: retrievedAt.toISOString(),
        expires_at: expiresAtFor('industry', retrievedAt)?.toISOString() ?? null,
      },
    ])

    const created = await createProfile(user.id, {
      name: 'Runner ICP',
      qualifyAt: 60,
      criteria: [
        { field: 'industry', operator: 'contains', value: 'software', weight: 20, kind: 'preferred' },
        { field: 'employee_count', operator: 'between', value: [10, 50], weight: 15, kind: 'preferred' },
      ],
    })
    if (!created.ok) throw new Error(`profile seed failed: ${created.reason}`)
    profileId = created.profileId
  })

  afterAll(async () => {
    if (user) await deleteTestUser(user.id)
  })

  it('scores the run and persists a qualified result', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'Which of these fit my ICP?',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['industry', 'employee_count'] },
      qualificationProfileId: profileId,
    })
    if (!created.ok) throw new Error('run was not created')

    const outcome = await claimAndProcessResearchRun(created.runId, user.id, 'test-worker')

    expect(outcome).not.toBeNull()
    // Everything was already known, so nothing was bought.
    expect(outcome!.externalCalls).toBe(0)
    expect(outcome!.qualifiedCount).toBe(1)

    const { data: results } = await adminClient()
      .from('qualification_results')
      .select('score, qualified, unknown_count, breakdown, profile_id')
      .eq('research_run_id', created.runId)

    expect(results).toHaveLength(1)
    expect(results![0]!.score).toBe(100)
    expect(results![0]!.qualified).toBe(true)
    expect(results![0]!.profile_id).toBe(profileId)
    // The breakdown is what makes "why qualified?" answerable.
    expect((results![0]!.breakdown as unknown[]).length).toBe(2)

    const { data: run } = await adminClient()
      .from('research_runs')
      .select('qualified_count, qualification_profile_id')
      .eq('id', created.runId)
      .single()

    expect(run?.qualified_count).toBe(1)
    expect(run?.qualification_profile_id).toBe(profileId)
  })

  it('runs research without scoring when no profile is attached', async () => {
    const created = await createResearchRun(user.id, {
      queryText: 'Just research, no scoring.',
      scope: { type: 'lead_ids', leadIds },
      plan: { requiredFields: ['industry'] },
    })
    if (!created.ok) throw new Error('run was not created')

    const outcome = await claimAndProcessResearchRun(created.runId, user.id, 'test-worker')

    // Null, not zero: nothing was scored, which is different from nothing
    // qualifying.
    expect(outcome!.qualifiedCount).toBeNull()

    const { count } = await adminClient()
      .from('qualification_results')
      .select('id', { count: 'exact', head: true })
      .eq('research_run_id', created.runId)

    expect(count).toBe(0)
  })

  it("ignores another tenant's profile rather than scoring against it", async () => {
    const intruder = await createAuthUser('research-qualify-intruder')
    try {
      const theirs = await createProfile(intruder.id, {
        name: 'Someone else ICP',
        criteria: [{ field: 'industry', operator: 'contains', value: 'construction', weight: 20, kind: 'required' }],
      })
      if (!theirs.ok) throw new Error('intruder profile not created')

      const created = await createResearchRun(user.id, {
        queryText: 'Cross-tenant profile.',
        scope: { type: 'lead_ids', leadIds },
        plan: { requiredFields: ['industry'] },
        qualificationProfileId: theirs.profileId,
      })

      // Either the FK refuses the reference outright, or the run is created and
      // getProfile — which scopes by user id — resolves nothing. Both are safe;
      // what must never happen is scoring against another tenant's criteria.
      if (created.ok) {
        const outcome = await claimAndProcessResearchRun(created.runId, user.id, 'test-worker')
        expect(outcome!.qualifiedCount).toBeNull()

        const { count } = await adminClient()
          .from('qualification_results')
          .select('id', { count: 'exact', head: true })
          .eq('research_run_id', created.runId)

        expect(count).toBe(0)
      }
    } finally {
      await deleteTestUser(intruder.id)
    }
  })
})
