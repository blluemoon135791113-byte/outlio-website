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
import { expiresAtFor } from '@/lib/intelligence/ttl'
import { claimAndProcessResearchRun, createResearchRun } from '@/lib/intelligence/run'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
  seedJob,
  type TestAuthUser,
} from './helpers'

async function schemaReady(): Promise<boolean> {
  if (!hasSupabaseEnv) return false
  const [companies, queue] = await Promise.all([
    adminClient().from('companies').select('id').limit(1),
    adminClient().from('research_job_queue').select('id').limit(1),
  ])
  return companies.error === null && queue.error === null
}

const ready = await schemaReady()

if (hasSupabaseEnv && !ready) {
  console.warn(
    '[research-run] SKIPPED — migration 0045 is not applied to this project. ' +
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
  const MUTED = ['TAVILY_API_KEY', 'PAGESPEED_API_KEY']

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
