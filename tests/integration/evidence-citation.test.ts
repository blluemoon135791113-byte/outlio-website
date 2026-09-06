/**
 * A bridged value must arrive carrying its citation.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE COLUMN EXISTING IS NOT THE CLAIM. THE BRIDGE WRITING IT IS.         ║
 * ║                                                                           ║
 * ║  Migration 0113 adds `evidence_id`; `evidence-bridge.ts` is supposed to   ║
 * ║  fill it. Those are separate facts, and this project has repeatedly found ║
 * ║  the second one missing while the first looked healthy — `actorAuthorized`║
 * ║  read by the send gate and written nowhere, `userId` read by every AI     ║
 * ║  step and written nowhere.                                                ║
 * ║                                                                           ║
 * ║  A unit test cannot settle it: the value passes through `attachContact-   ║
 * ║  Emails` into Postgres and back. Only a round trip proves the citation    ║
 * ║  survived.                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { syncContactEvidenceToCrm } from '@/lib/crm/evidence-bridge'

import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('a bridged value keeps its citation', () => {
  let userId: string
  let workspaceId: string
  let contactId: string
  let evidenceId: string

  const address = `cited-${Date.now()}@example.com`

  beforeAll(async () => {
    const db = adminClient()
    const user = await createAuthUser('citation')
    userId = user.id

    const { data: workspace } = await db
      .from('workspaces')
      .select('id')
      .eq('owner_user_id', userId)
      .single()
    workspaceId = workspace!.id

    /*
     * ⚠️ THE LEAD IS THE JOIN. `research_evidence.entity_id` points at
     * `extracted_leads`, not at a contact — which is the whole reason the
     * bridge starts from contacts and follows `source_lead_id` rather than the
     * other way round. The fixture has to reproduce that shape or it tests a
     * path the product does not have.
     */
    /*
     * ⚠️ ERRORS ARE READ, NOT DISCARDED. The first version destructured only
     * `data` — so a failed insert surfaced three statements later as "cannot
     * read properties of null", pointing at the wrong line. A fixture that
     * fails silently wastes the round trip it was written to save.
     */
    const { data: job, error: jobError } = await db
      .from('extraction_jobs')
      .insert({ user_id: userId })
      .select('id')
      .single()
    if (jobError) throw new Error(`seed extraction_job failed: ${jobError.message}`)

    const { data: lead, error: leadError } = await db
      .from('extracted_leads')
      .insert({
        user_id: userId,
        extraction_job_id: job!.id,
        full_name: 'Cited Person',
        dedupe_key: `cite-${Date.now()}`,
        // dedupe_strategy, not dedupe_mode — two enums, similar names.
        dedupe_strategy: 'row_hash',
      })
      .select('id')
      .single()
    if (leadError) throw new Error(`seed lead failed: ${leadError.message}`)

    const { data: evidence, error: evidenceError } = await db
      .from('research_evidence')
      .insert({
        user_id: userId,
        entity_type: 'person',
        entity_id: lead!.id,
        field: 'work_email',
        /*
         * ⚠️ THE KEY IS FIELD-SPECIFIC. `literalValue` reads `email` for a
         * work_email row and `phone` for a phone one — a generic `value` key
         * is silently ignored, and the bridge then reports "nothing usable"
         * rather than an error.
         */
        value_json: { email: address },
        source_provider: 'test-provider',
        source_url: 'https://example.com/team',
        source_confidence: 'high',
        // Above MIN_EVIDENCE_CONFIDENCE (0.7), or the bridge correctly skips it.
        confidence: 0.9,
        retrieved_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (evidenceError) throw new Error(`seed evidence failed: ${evidenceError.message}`)
    evidenceId = evidence!.id

    const { data: contact, error: contactError } = await db
      .from('crm_contacts')
      .insert({
        workspace_id: workspaceId,
        full_name: 'Cited Person',
        source: 'lead_engine',
        source_lead_id: lead!.id,
      })
      .select('id')
      .single()
    if (contactError) throw new Error(`seed contact failed: ${contactError.message}`)
    contactId = contact!.id
  }, 120_000)

  afterAll(async () => {
    if (userId) await deleteTestUser(userId)
  }, 120_000)

  it('the fixture is real', () => {
    // Without this, a failed insert would make every assertion below vacuous.
    expect(workspaceId).toBeTruthy()
    expect(contactId).toBeTruthy()
    expect(evidenceId).toBeTruthy()
  })

  it('the bridge writes the evidence id onto the email row', async () => {
    const result = await syncContactEvidenceToCrm(workspaceId, { contactIds: [contactId] })
    expect(result, 'the bridge reported nothing').toBeTruthy()

    const { data } = await adminClient()
      .from('crm_contact_emails')
      .select('address, evidence_id')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)

    expect(data, 'the bridge wrote no email at all').toHaveLength(1)
    expect(data![0]!.address).toBe(address)

    /*
     * ⚠️ THE ASSERTION THE COLUMN EXISTS FOR. Before 0113 the address arrived
     * and its origin did not, so the page it came from was unrecoverable —
     * which is the half of CLAUDE.md rule 4 that was never built.
     */
    expect(
      data![0]!.evidence_id,
      'the address was bridged WITHOUT its citation — rule 4 requires the evidence ' +
        'row naming the provider and URL to be kept, and re-deriving it later ' +
        'crosses the user_id/workspace_id seam',
    ).toBe(evidenceId)
  }, 120_000)

  it('the citation resolves back to a provider and URL', async () => {
    const { data } = await adminClient()
      .from('research_evidence')
      .select('source_provider, source_url')
      .eq('id', evidenceId)
      .single()

    expect(data?.source_provider).toBe('test-provider')
    expect(data?.source_url).toBe('https://example.com/team')
  })
})
