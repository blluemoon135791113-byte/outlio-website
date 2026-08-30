/**
 * Lead Engine → CRM ingestion — M2 Phase 3.
 *
 * M2 ACCEPTANCE CRITERION 1: "Importing the same file/batch twice produces zero
 * new contacts (idempotent ingestion)." That claim is about the interaction of
 * a unique index, a set-based SQL function and a re-run, so it cannot be
 * checked anywhere but against a real database.
 *
 * Also covers undo, which must delete the people an import brought in and
 * nobody else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildImportPlan, parseCsv, suggestMapping } from '@/lib/crm/csv-import'
import { ingestExtractionJob, runCsvImport, undoBatch } from '@/lib/crm/ingest'
import { upsertContact } from '@/lib/crm/repository'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
  seedJob,
  type TestAuthUser,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

const RUN = Date.now().toString(36)

async function workspaceOf(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', userId)
    .single()
  if (error) throw new Error(`workspaceOf failed: ${error.message}`)
  return data.workspace_id
}

/** Fabricated leads only — never a real person (CLAUDE.md test-fixture rule). */
async function seedLeads(
  userId: string,
  jobId: string,
  leads: {
    name: string
    slug: string
    email?: string | null
    phone?: string | null
    company?: string | null
    domain?: string | null
  }[],
): Promise<void> {
  const { error } = await adminClient()
    .from('extracted_leads')
    .insert(
      leads.map((lead, index) => ({
        user_id: userId,
        extraction_job_id: jobId,
        full_name: lead.name,
        linkedin_url: `https://www.linkedin.com/in/${lead.slug}`,
        sales_navigator_url: `https://www.linkedin.com/sales/lead/fabricated-${lead.slug}`,
        dedupe_key: `li:lead:fabricated-${lead.slug}`,
        dedupe_strategy: 'linkedin_url_canonical' as const,
        job_title: 'Fabricated Title',
        work_email: lead.email ?? null,
        mobile_phone: lead.phone ?? null,
        company_name: lead.company ?? null,
        company_website_url: lead.domain ?? null,
        source_row_index: index,
      })),
    )

  if (error) throw new Error(`seedLeads failed: ${error.message}`)
}

describeIf('Lead Engine → CRM ingestion', () => {
  let owner: TestAuthUser
  let stranger: TestAuthUser
  let workspaceId: string
  let jobId: string

  beforeAll(async () => {
    owner = await createAuthUser('ing-owner')
    stranger = await createAuthUser('ing-stranger')
    workspaceId = await workspaceOf(owner.id)
    jobId = await seedJob(owner.id)

    await seedLeads(owner.id, jobId, [
      {
        name: 'Ingest One',
        slug: `ingest-one-${RUN}`,
        email: `ingest.one-${RUN}@acme.example.com`,
        company: 'Acme Ltd',
        domain: `acme-${RUN}.example.com`,
      },
      {
        name: 'Ingest Two',
        slug: `ingest-two-${RUN}`,
        email: `ingest.two-${RUN}@acme.example.com`,
        company: 'Acme Limited',
        domain: `www.acme-${RUN}.example.com`,
      },
      {
        name: 'Ingest Three',
        slug: `ingest-three-${RUN}`,
        phone: '+1 415 555 0177',
        company: 'Globex',
        domain: `globex-${RUN}.example.com`,
      },
    ])
  })

  afterAll(async () => {
    if (owner) await deleteTestUser(owner.id)
    if (stranger) await deleteTestUser(stranger.id)
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 1
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    let firstBatchId: string

    it('creates a batch and canonical contacts on the first run', async () => {
      const result = await ingestExtractionJob(workspaceId, jobId)
      firstBatchId = result.batchId

      expect(result.reRun).toBe(false)
      expect(result.rowsSeen).toBe(3)
      expect(result.contactsCreated).toBe(3)
      expect(result.contactsMatched).toBe(0)
    })

    it('IMPORTS THE SAME BATCH TWICE FOR ZERO NEW CONTACTS', async () => {
      const before = await countContacts()

      const result = await ingestExtractionJob(workspaceId, jobId)

      expect(result.reRun).toBe(true)
      expect(result.batchId).toBe(firstBatchId)
      expect(result.contactsCreated).toBe(0)
      expect(result.contactsMatched).toBe(3)
      expect(await countContacts()).toBe(before)
    })

    it('does not create a second batch for the same extraction', async () => {
      const { count } = await adminClient()
        .from('crm_lead_batches')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('source_extraction_job_id', jobId)

      expect(count).toBe(1)
    })

    it('does not duplicate batch membership', async () => {
      const { count } = await adminClient()
        .from('crm_batch_members')
        .select('contact_id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('batch_id', firstBatchId)

      expect(count).toBe(3)
    })

    it('records which contacts it created, for undo', async () => {
      const { data } = await adminClient()
        .from('crm_batch_members')
        .select('created_contact')
        .eq('workspace_id', workspaceId)
        .eq('batch_id', firstBatchId)

      // All three were new on the first run; the re-run must not have flipped
      // them to false, or undo would refuse to clean up after itself.
      expect(data?.every((r) => r.created_contact)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // What ingestion actually produced
  // -------------------------------------------------------------------------

  describe('the records it produced', () => {
    it('carries the email through, normalized', async () => {
      const { data } = await adminClient()
        .from('crm_contact_emails')
        .select('address, is_primary')
        .eq('workspace_id', workspaceId)
        .eq('identity_key', `ingest.one-${RUN}@acme.example.com`)
        .single()

      expect(data?.address).toBe(`ingest.one-${RUN}@acme.example.com`)
      expect(data?.is_primary).toBe(true)
    })

    it('collapses two spellings of one company into one account', async () => {
      // "Acme Ltd" at acme.example.com and "Acme Limited" at
      // www.acme.example.com are one company; www and the legal suffix are not
      // identity.
      const { count } = await adminClient()
        .from('crm_companies')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('normalized_domain', `acme-${RUN}.example.com`)

      expect(count).toBe(1)
    })

    it('links contacts to their employer and projects it', async () => {
      const { data: contact } = await adminClient()
        .from('crm_contacts')
        .select('id, primary_company_id')
        .eq('workspace_id', workspaceId)
        .eq('linkedin_identity_key', `li:in:ingest-one-${RUN}`)
        .single()

      expect(contact?.primary_company_id).not.toBeNull()

      const { count } = await adminClient()
        .from('crm_contact_company_relationships')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('contact_id', contact!.id)

      // Re-running ingestion must not add a second employment row.
      expect(count).toBe(1)
    })

    it('marks every contact as lead_engine, for the funnel', async () => {
      const { data } = await adminClient()
        .from('crm_contacts')
        .select('source')
        .eq('workspace_id', workspaceId)
        .eq('linkedin_identity_key', `li:in:ingest-two-${RUN}`)
        .single()

      expect(data?.source).toBe('lead_engine')
    })

    it('keeps a link back to the immutable extraction row', async () => {
      const { data } = await adminClient()
        .from('crm_contacts')
        .select('source_lead_id')
        .eq('workspace_id', workspaceId)
        .eq('linkedin_identity_key', `li:in:ingest-three-${RUN}`)
        .single()

      expect(data?.source_lead_id).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Tenancy
  // -------------------------------------------------------------------------

  describe('tenancy', () => {
    it("refuses to ingest an extraction into someone else's workspace", async () => {
      const strangerWs = await workspaceOf(stranger.id)

      // The service role would happily do this. The membership check is the
      // only thing standing between a mistyped id and a cross-tenant move.
      await expect(ingestExtractionJob(strangerWs, jobId)).rejects.toThrow(
        /does not belong to this workspace/i,
      )
    })

    it('refuses an extraction that does not exist', async () => {
      await expect(
        ingestExtractionJob(workspaceId, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(/no such extraction job/i)
    })
  })

  // -------------------------------------------------------------------------
  // CSV
  // -------------------------------------------------------------------------

  describe('CSV import', () => {
    const FILE = [
      'Full Name,Email,Company Name,Job Title',
      `CSV One,csv.one-${RUN}@example.com,Csvco,VP Sales`,
      `CSV Two,csv.two-${RUN}@example.com,Csvco,SDR`,
      'Broken Row,not-an-email,,',
    ].join('\n')

    let importJobId: string
    let csvBatchId: string

    it('imports the valid rows and reports the broken one', async () => {
      const parsed = parseCsv(FILE)
      const plan = buildImportPlan(parsed, suggestMapping(parsed.headers))

      const { data: job, error } = await adminClient()
        .from('crm_import_jobs')
        .insert({
          workspace_id: workspaceId,
          filename: `people-${RUN}.csv`,
          content_hash: `hash-${RUN}`,
          mapping: suggestMapping(parsed.headers),
        })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      importJobId = job.id

      const result = await runCsvImport(workspaceId, importJobId, plan)
      csvBatchId = result.batchId

      expect(result.rowsSeen).toBe(3)
      expect(result.contactsCreated).toBe(2)
      expect(result.rowsSkipped).toBe(1)
    })

    it('records a partial success as partial, not as failure', async () => {
      const { data } = await adminClient()
        .from('crm_import_jobs')
        .select('status, rows_total, rows_imported, rows_skipped, errors')
        .eq('id', importJobId)
        .single()

      // Two of three people did import. Calling that "failed" hides them.
      expect(data?.status).toBe('partially_completed')
      expect(data?.rows_imported).toBe(2)
      expect(data?.rows_skipped).toBe(1)
      expect((data?.errors as unknown[])?.length).toBe(1)
    })

    it('is idempotent when the same file is imported again', async () => {
      const parsed = parseCsv(FILE)
      const plan = buildImportPlan(parsed, suggestMapping(parsed.headers))
      const before = await countContacts()

      const result = await runCsvImport(workspaceId, importJobId, plan)

      expect(result.contactsCreated).toBe(0)
      expect(result.contactsMatched).toBe(2)
      expect(await countContacts()).toBe(before)
    })

    // -----------------------------------------------------------------------
    // Undo
    // -----------------------------------------------------------------------

    describe('undo', () => {
      let preExisting: string

      it('deletes the people the import created', async () => {
        // A person who already existed and was merely MATCHED by the import.
        const existing = await upsertContact(workspaceId, {
          fullName: 'Already Here',
          emails: [`already-${RUN}@example.com`],
        })
        preExisting = existing.id

        const parsed = parseCsv(
          ['Full Name,Email', `Already Here,already-${RUN}@example.com`].join('\n'),
        )
        const plan = buildImportPlan(parsed, suggestMapping(parsed.headers))

        const { data: job } = await adminClient()
          .from('crm_import_jobs')
          .insert({
            workspace_id: workspaceId,
            filename: `mixed-${RUN}.csv`,
            content_hash: `hash-mixed-${RUN}`,
          })
          .select('id')
          .single()

        const mixed = await runCsvImport(workspaceId, job!.id, plan)
        expect(mixed.contactsMatched).toBe(1)

        const result = await undoBatch(workspaceId, mixed.batchId)

        // It created nobody, so it deletes nobody.
        expect(result.contactsDeleted).toBe(0)
        expect(result.membershipsRemoved).toBe(1)
      })

      it('NEVER deletes a contact it only matched', async () => {
        const { data } = await adminClient()
          .from('crm_contacts')
          .select('deleted_at')
          .eq('id', preExisting)
          .single()

        // They may since have been emailed, assigned or moved through a
        // pipeline. Undoing an import that merely recognised them must not
        // destroy work nobody asked to undo.
        expect(data?.deleted_at).toBeNull()
      })

      it('soft-deletes contacts the batch did create, and frees their addresses', async () => {
        const result = await undoBatch(workspaceId, csvBatchId)
        expect(result.contactsDeleted).toBe(2)

        const { data } = await adminClient()
          .from('crm_contacts')
          .select('deleted_at')
          .eq('workspace_id', workspaceId)
          .eq('full_name', 'CSV One')
          .single()
        expect(data?.deleted_at).not.toBeNull()

        // The address must be released, or the same person could never be
        // re-imported — the unique index would still hold their mailbox.
        const reimport = await upsertContact(workspaceId, {
          fullName: 'CSV One',
          emails: [`csv.one-${RUN}@example.com`],
        })
        expect(reimport.created).toBe(true)
      })

      it('marks the import job undone', async () => {
        const { data } = await adminClient()
          .from('crm_import_jobs')
          .select('status, undone_at')
          .eq('id', importJobId)
          .single()

        expect(data?.status).toBe('undone')
        expect(data?.undone_at).not.toBeNull()
      })
    })
  })

  async function countContacts(): Promise<number> {
    const { count, error } = await adminClient()
      .from('crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)

    if (error) throw new Error(`countContacts failed: ${error.message}`)
    return count ?? 0
  }
})
