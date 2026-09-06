/**
 * Tenant isolation for the intelligence tables (spec §56).
 *
 * The new tables carry the most commercially sensitive data in the product —
 * researched company facts a customer paid for. One customer's agent reading
 * another's evidence is the failure that ends the business, so it is proven
 * against the real project rather than reasoned about.
 *
 * Also proves the linking function is correct under concurrency, which is the
 * bug class sequential testing cannot reach (see the 0010 postmortem).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  adminClient,
  createTestUser,
  deleteTestUser,
  hasSupabaseEnv,
  seedJob,
  type TestUser,
} from './helpers'

/**
 * Migrations 0043 and 0044 are applied by hand in the Supabase SQL editor, as
 * every previous phase has been. Until that happens these tables do not exist,
 * and a hard failure here would say "the code is broken" when the truth is
 * "the migration has not been run yet".
 *
 * ⚠️ A SKIP HERE IS NOT A PASS. If this suite reports 0 tests, the schema is
 * not deployed and tenant isolation for the intelligence tables is unproven.
 */
async function intelligenceSchemaExists(): Promise<boolean> {
  if (!hasSupabaseEnv) return false
  const admin = adminClient()
  const [companies, evidence] = await Promise.all([
    admin.from('companies').select('id').limit(1),
    admin.from('research_evidence').select('id').limit(1),
  ])
  return companies.error === null && evidence.error === null
}

const schemaReady = await intelligenceSchemaExists()

if (hasSupabaseEnv && !schemaReady) {
  console.warn(
    '[companies-rls] SKIPPED — migrations 0043/0044 are not applied to this project. ' +
      'Tenant isolation for companies and research evidence is UNVERIFIED.',
  )
}

const describeIf = hasSupabaseEnv && schemaReady ? describe : describe.skip

describeIf('companies and research evidence — cross-user isolation', () => {
  let alice: TestUser
  let bob: TestUser
  let aliceCompanyId: string
  let aliceEvidenceId: string
  let aliceRunId: string

  beforeAll(async () => {
    alice = await createTestUser('companies-alice')
    bob = await createTestUser('companies-bob')
    await seedJob(alice.id)

    const admin = adminClient()

    const { data: company, error: companyError } = await admin
      .from('companies')
      .insert({
        user_id: alice.id,
        name: 'Fabricated Systems',
        normalized_name: 'fabricated systems',
        domain: 'https://fabricated.example.com',
        normalized_domain: 'fabricated.example.com',
      })
      .select('id')
      .single()

    if (companyError || !company) {
      throw new Error(`company seed failed: ${companyError?.message ?? 'no row'}`)
    }
    aliceCompanyId = company.id

    const { data: run, error: runError } = await admin
      .from('research_runs')
      .insert({
        user_id: alice.id,
        status: 'completed',
        query_text: 'Which companies raised a Series A?',
      })
      .select('id')
      .single()

    if (runError || !run) throw new Error(`run seed failed: ${runError?.message ?? 'no row'}`)
    aliceRunId = run.id

    const { data: evidence, error: evidenceError } = await admin
      .from('research_evidence')
      .insert({
        user_id: alice.id,
        entity_type: 'company',
        entity_id: aliceCompanyId,
        field: 'funding_amount',
        value_json: { amount: 8_000_000, currency: 'USD' },
        source_provider: 'fabricated-provider',
        source_url: 'https://example.com/funding',
        source_confidence: 'high',
        confidence: 0.94,
        research_run_id: aliceRunId,
      })
      .select('id')
      .single()

    if (evidenceError || !evidence) {
      throw new Error(`evidence seed failed: ${evidenceError?.message ?? 'no row'}`)
    }
    aliceEvidenceId = evidence.id
  })

  afterAll(async () => {
    if (alice) await deleteTestUser(alice.id)
    if (bob) await deleteTestUser(bob.id)
  })

  it('lets Alice read her own company', async () => {
    const { data, error } = await alice.client
      .from('companies')
      .select('id, normalized_domain')
      .eq('id', aliceCompanyId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.normalized_domain).toBe('fabricated.example.com')
  })

  it("does NOT let Bob read Alice's company", async () => {
    const { data } = await bob.client.from('companies').select('id').eq('id', aliceCompanyId)
    expect(data).toEqual([])
  })

  it("does NOT let Bob read Alice's research evidence", async () => {
    const { data } = await bob.client
      .from('research_evidence')
      .select('id, value_json')
      .eq('id', aliceEvidenceId)

    expect(data).toEqual([])
  })

  it("does NOT let Bob read Alice's research run", async () => {
    const { data } = await bob.client.from('research_runs').select('id').eq('id', aliceRunId)
    expect(data).toEqual([])
  })

  it("does NOT let Bob write into Alice's company", async () => {
    // There is no UPDATE policy on `companies`, so this is refused whether or
    // not Bob can see the row. The assertion that matters is the row itself.
    await bob.client.from('companies').update({ name: 'Owned' }).eq('id', aliceCompanyId)

    const { data } = await adminClient()
      .from('companies')
      .select('name')
      .eq('id', aliceCompanyId)
      .single()

    expect(data?.name).toBe('Fabricated Systems')
  })

  it('does NOT let Bob insert evidence at all', async () => {
    const { error } = await bob.client.from('research_evidence').insert({
      user_id: bob.id,
      entity_type: 'company',
      entity_id: aliceCompanyId,
      field: 'funding_amount',
      value_json: { amount: 1 },
      source_provider: 'forged',
      source_confidence: 'high',
      confidence: 1,
    })

    // Evidence is written by the service role only. A client cannot forge a
    // fact, which is what makes provenance mean anything.
    expect(error).not.toBeNull()
  })
})

describeIf('link_leads_to_companies — concurrency and identity', () => {
  let alice: TestUser
  let jobId: string

  beforeAll(async () => {
    alice = await createTestUser('companies-link')
    jobId = await seedJob(alice.id)
  })

  afterAll(async () => {
    if (alice) await deleteTestUser(alice.id)
  })

  async function seedLeads(count: number): Promise<string[]> {
    const admin = adminClient()
    const rows = Array.from({ length: count }, (_, i) => ({
      user_id: alice.id,
      extraction_job_id: jobId,
      full_name: `Fabricated Person ${i}`,
      company_name: 'Fabricated Systems',
      dedupe_key: `link-test-${Date.now()}-${i}-${Math.random()}`,
      dedupe_strategy: 'row_hash' as const,
    }))

    const { data, error } = await admin.from('extracted_leads').insert(rows).select('id')
    if (error || !data) throw new Error(`lead seed failed: ${error?.message ?? 'no rows'}`)
    return data.map((row) => row.id)
  }

  it('maps many leads at one company onto a single company row', async () => {
    const leadIds = await seedLeads(25)
    const admin = adminClient()

    const { error } = await admin.rpc('link_leads_to_companies', {
      p_user_id: alice.id,
      p_leads: leadIds.map((id) => ({
        lead_id: id,
        name: 'Fabricated Systems',
        normalized_name: 'fabricated systems',
        domain: 'https://link.example.com',
        normalized_domain: 'link.example.com',
      })),
    })

    expect(error).toBeNull()

    const { data: companies } = await admin
      .from('companies')
      .select('id')
      .eq('user_id', alice.id)
      .eq('normalized_domain', 'link.example.com')

    expect(companies).toHaveLength(1)

    const { data: leads } = await admin
      .from('extracted_leads')
      .select('company_id, company_match_strategy')
      .eq('user_id', alice.id)
      .in('id', leadIds)

    expect(leads).toHaveLength(25)
    expect(new Set(leads?.map((l) => l.company_id)).size).toBe(1)
    expect(leads?.every((l) => l.company_match_strategy === 'domain')).toBe(true)
  })

  it('creates exactly one company when parallel callers race for the same domain', async () => {
    const leadIds = await seedLeads(8)
    const admin = adminClient()
    const domain = `race-${Date.now()}.example.com`

    // Genuinely parallel RPCs. A read-then-write in application code would
    // create up to eight duplicate companies here.
    const results = await Promise.all(
      leadIds.map((id) =>
        admin.rpc('link_leads_to_companies', {
          p_user_id: alice.id,
          p_leads: [
            {
              lead_id: id,
              name: 'Race Condition Co',
              normalized_name: 'race condition',
              domain: `https://${domain}`,
              normalized_domain: domain,
            },
          ],
        }),
      ),
    )

    expect(results.every((r) => r.error === null)).toBe(true)

    const { data: companies } = await admin
      .from('companies')
      .select('id')
      .eq('user_id', alice.id)
      .eq('normalized_domain', domain)

    expect(companies).toHaveLength(1)

    const { data: leads } = await admin
      .from('extracted_leads')
      .select('company_id')
      .eq('user_id', alice.id)
      .in('id', leadIds)

    expect(new Set(leads?.map((l) => l.company_id)).size).toBe(1)
  })

  it('leaves a lead unlinked rather than inventing a company', async () => {
    const [leadId] = await seedLeads(1)
    const admin = adminClient()

    await admin.rpc('link_leads_to_companies', {
      p_user_id: alice.id,
      p_leads: [{ lead_id: leadId }],
    })

    const { data } = await admin
      .from('extracted_leads')
      .select('company_id')
      .eq('id', leadId!)
      .single()

    expect(data?.company_id).toBeNull()
  })

  it('refuses to link a lead belonging to another user', async () => {
    const bob = await createTestUser('companies-link-bob')
    try {
      const [leadId] = await seedLeads(1)
      const admin = adminClient()

      // Bob's id with Alice's lead: the function scopes both sides, so nothing
      // should change hands.
      await admin.rpc('link_leads_to_companies', {
        p_user_id: bob.id,
        p_leads: [
          {
            lead_id: leadId,
            name: 'Cross Tenant',
            normalized_name: 'cross tenant',
            domain: 'https://cross.example.com',
            normalized_domain: 'cross.example.com',
          },
        ],
      })

      const { data } = await admin
        .from('extracted_leads')
        .select('company_id, user_id')
        .eq('id', leadId!)
        .single()

      expect(data?.company_id).toBeNull()
      expect(data?.user_id).toBe(alice.id)
    } finally {
      await deleteTestUser(bob.id)
    }
  })
})
