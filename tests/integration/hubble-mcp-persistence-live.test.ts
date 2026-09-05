/**
 * Opt-in live gate for the consolidated Hubble → MCP → evidence path.
 *
 * It creates an isolated test tenant, researches one public company, proves
 * sourced facts and cleaned pages reached Hubble's canonical tables, and then
 * deletes the tenant. It is never part of the default no-network suite.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { linkLeadsToCompanies } from '@/lib/companies/repository'
import { webResearchMcpConfig } from '@/lib/hubble/providers/mcp-web-research'
import { claimAndProcessResearchRun, createResearchRun } from '@/lib/intelligence/run'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
  seedJob,
  type TestAuthUser,
} from './helpers'

const enabled = process.env.RUN_HUBBLE_MCP_LIVE === '1' && hasSupabaseEnv && Boolean(webResearchMcpConfig())
const describeIf = enabled ? describe : describe.skip

describeIf('Hubble-owned MCP persistence', () => {
  let user: TestAuthUser

  beforeAll(async () => {
    user = await createAuthUser('hubble-mcp-live')
  })

  afterAll(async () => {
    if (user) await deleteTestUser(user.id)
  })

  it('stores sourced MCP facts and cleaned pages under one Hubble run', async () => {
    const jobId = await seedJob(user.id)
    const admin = adminClient()
    const { data: lead, error } = await admin
      .from('extracted_leads')
      .insert({
        user_id: user.id,
        extraction_job_id: jobId,
        full_name: 'Delaney Thompson',
        company_name: 'Caddie AI',
        company_website_url: 'caddie.app',
        dedupe_key: `hubble-mcp-live-${user.id}`,
        dedupe_strategy: 'row_hash',
      })
      .select('id')
      .single()
    if (error || !lead) throw new Error(`lead seed failed: ${error?.message ?? 'no row'}`)

    await linkLeadsToCompanies(user.id, [{
      id: lead.id,
      companyName: 'Caddie AI',
      companyWebsiteUrl: 'caddie.app',
      companyLinkedInUrl: null,
    }])

    const created = await createResearchRun(user.id, {
      queryText: 'Find Delaney Thompson work email and Caddie AI industry with sources',
      scope: { type: 'lead_ids', leadIds: [lead.id] },
      plan: {
        entityScope: 'people',
        requiredFields: ['work_email', 'industry'],
        outputFields: ['work_email', 'industry'],
        filters: {},
        clarificationRequired: false,
        clarificationQuestions: [],
      },
    })
    if (!created.ok) throw new Error(created.reason)

    const outcome = await claimAndProcessResearchRun(created.runId, user.id, 'hubble-mcp-live-test')
    expect(outcome).not.toBeNull()
    expect(outcome?.externalCalls).toBeGreaterThanOrEqual(1)

    const { data: evidence } = await admin
      .from('research_evidence')
      .select('field, source_url')
      .eq('user_id', user.id)
      .eq('research_run_id', created.runId)
      .eq('source_provider', 'web-research-mcp')
    expect(evidence?.length ?? 0).toBeGreaterThan(0)
    expect(evidence?.every((row) => row.source_url?.startsWith('http'))).toBe(true)

    const { data: pages } = await admin
      .from('hubble_pages')
      .select('content, structured')
      .eq('user_id', user.id)
    expect(pages?.length ?? 0).toBeGreaterThan(0)
    expect(pages?.every((page) => !/<html|<body/i.test(page.content))).toBe(true)
    expect(pages?.every((page) =>
      page.structured &&
      typeof page.structured === 'object' &&
      !Array.isArray(page.structured) &&
      typeof (page.structured as Record<string, unknown>).contentHash === 'string',
    )).toBe(true)
  }, 180_000)
})
