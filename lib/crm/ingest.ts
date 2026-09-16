import 'server-only'

/**
 * The ingestion contract (M2 Phase 3).
 *
 *   extraction (or CSV) → lead batch → normalization → dedup → canonical
 *   contact → batch membership → optional list / setter assignment
 *
 * ⚠️ NO CSV ROUND-TRIPPING. `extracted_leads` rows go straight to
 * `crm_contacts`. The CSV export that already exists is for the USER; it is
 * never a stage in our own pipeline.
 *
 * ⚠️ NORMALIZATION HAPPENS HERE, NOT IN SQL. This module runs every value
 * through `lib/crm/normalize.ts` and hands `crm_ingest_contacts` a payload
 * that is already canonical — the same contract `link_leads_to_companies` has
 * in 0043. There is one implementation of "what is this person's identity".
 *
 * ⚠️ THE SERVICE ROLE BYPASSES RLS. Every query is scoped by `workspace_id`,
 * and `ingestExtractionJob` additionally proves the extraction's owner is a
 * member of the workspace before reading a single lead.
 */
import {
  normalizeCompanyLinkedInUrl,
  normalizeCompanyName,
  normalizeDomain,
} from '@/lib/companies/normalize'
import type { ImportPlan } from '@/lib/crm/csv-import'
import {
  normalizeContactLinkedInUrl,
  normalizeEmail,
  normalizePersonName,
  normalizePhoneNumber,
} from '@/lib/crm/normalize'
import { upsertCrmCompany, type ContactInput } from '@/lib/crm/repository'
import { emitDomainEvent } from '@/lib/events/emit'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/types/database'

type RecordSource = Database['public']['Enums']['crm_record_source']

export type IngestResult = {
  batchId: string
  rowsSeen: number
  contactsCreated: number
  contactsMatched: number
  rowsSkipped: number
  /** True when the batch already existed, so this run repaired rather than created. */
  reRun: boolean
}

/** One row as `crm_ingest_contacts` expects it: already normalized. */
type IngestPayloadRow = {
  ref: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null
  linkedin_url: string | null
  linkedin_identity_key: string | null
  location: string | null
  headline: string | null
  owner_user_id: string | null
  source: RecordSource
  source_lead_id: string | null
  company_id: string | null
  emails: { address: string; identity_key: string }[]
  phones: { raw: string; e164: string | null }[]
}

type CompanySeed = {
  name: string | null
  websiteUrl: string | null
  linkedInUrl: string | null
}

/**
 * Resolves the distinct companies a batch mentions, once each.
 *
 * THIS IS THE COST CONTROL, and it is the same one `groupLeadsByCompany`
 * applies in the Lead Engine: 500 employees of one company are one upsert, not
 * 500. Returns a key → id map the caller stamps onto each contact.
 *
 * ⚠️ Still one round trip per DISTINCT company. That is fine for the batch
 * sizes seen today (tens to low hundreds) and is the obvious candidate for a
 * set-based `crm_upsert_companies` if a batch ever mentions thousands. Recorded
 * as Ledger DR13 rather than built speculatively.
 */
async function resolveCompanies(
  workspaceId: string,
  seeds: Map<string, CompanySeed>,
  source: RecordSource,
  actorUserId: string | null,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()

  for (const [key, seed] of seeds) {
    try {
      const company = await upsertCrmCompany(
        workspaceId,
        {
          name: seed.name,
          websiteUrl: seed.websiteUrl,
          linkedInUrl: seed.linkedInUrl,
          source,
        },
        actorUserId,
      )
      resolved.set(key, company.id)
    } catch {
      // A company we cannot resolve must not cost us the PEOPLE. The contact
      // is still canonical and still ingested; it simply has no employer yet.
      continue
    }
  }

  return resolved
}

/**
 * The identity key a company seed groups by.
 *
 * Precedence matches `resolveCompanyIdentity` and the partial unique indexes:
 * domain, then LinkedIn page, then name. Name is the last resort and never
 * groups a seed that carries something stronger.
 */
function companyKey(seed: CompanySeed): string | null {
  const domain = normalizeDomain(seed.websiteUrl)
  if (domain) return `domain:${domain}`

  const linkedIn = normalizeCompanyLinkedInUrl(seed.linkedInUrl)
  if (linkedIn) return `linkedin:${linkedIn}`

  const name = normalizeCompanyName(seed.name)
  if (name) return `name:${name}`

  return null
}

/** Normalizes one contact into the payload shape, or `null` if it identifies nobody. */
function toPayloadRow(
  ref: string,
  input: ContactInput,
  companyId: string | null,
): IngestPayloadRow | null {
  const name = normalizePersonName(input.fullName)
  const linkedIn = normalizeContactLinkedInUrl(input.linkedInUrl)

  const emails: IngestPayloadRow['emails'] = []
  for (const raw of input.emails ?? []) {
    const email = normalizeEmail(raw)
    if (!email) continue
    if (emails.some((e) => e.identity_key === email.identityKey)) continue
    emails.push({ address: email.address, identity_key: email.identityKey })
  }

  const phones: IngestPayloadRow['phones'] = []
  for (const raw of input.phones ?? []) {
    const phone = normalizePhoneNumber(raw, {
      defaultCountry: input.defaultPhoneCountry ?? null,
    })
    // Prose is dropped; a real number we cannot regionalize is kept raw.
    if (!phone || phone.reason === 'invalid') continue
    if (phones.some((p) => (phone.e164 ? p.e164 === phone.e164 : p.raw === phone.raw))) {
      continue
    }
    phones.push({ raw: phone.raw, e164: phone.e164 })
  }

  if (!name?.fullName && !linkedIn && emails.length === 0) return null

  return {
    ref,
    full_name: name?.fullName ?? null,
    first_name: name?.firstName ?? null,
    last_name: name?.lastName ?? null,
    job_title: input.jobTitle?.trim() || null,
    linkedin_url: linkedIn?.canonicalUrl ?? input.linkedInUrl?.trim() ?? null,
    linkedin_identity_key: linkedIn?.identityKey ?? null,
    location: input.location?.trim() || null,
    headline: input.headline?.trim() || null,
    owner_user_id: input.ownerUserId ?? null,
    source: input.source ?? 'manual',
    source_lead_id: input.sourceLeadId ?? null,
    company_id: companyId,
    emails,
    phones,
  }
}

/** Chunked so one enormous batch cannot exceed the statement or payload limit. */
const INGEST_CHUNK = 200

async function runIngest(
  workspaceId: string,
  batchId: string,
  rows: IngestPayloadRow[],
): Promise<{ created: number; matched: number; returned: Map<string, string> }> {
  const db = createAdminClient()
  let created = 0
  let matched = 0
  const returned = new Map<string, string>()

  for (let i = 0; i < rows.length; i += INGEST_CHUNK) {
    const chunk = rows.slice(i, i + INGEST_CHUNK)
    const { data, error } = await db.rpc('crm_ingest_contacts', {
      p_workspace_id: workspaceId,
      p_batch_id: batchId,
      p_contacts: chunk as unknown as Json,
    })

    if (error) throw new Error(`crm_ingest_contacts failed: ${error.message}`)

    for (const row of data ?? []) {
      returned.set(row.ref, row.contact_id)
      if (row.created) created += 1
      else matched += 1
    }
  }

  return { created, matched, returned }
}

/**
 * Attaches employment relationships in bulk.
 *
 * Existing pairs are read first and filtered out rather than relying on
 * ON CONFLICT: the uniqueness is a PARTIAL index (`where deleted_at is null`),
 * which a bulk upsert cannot target, and a single conflict would otherwise
 * fail the whole insert.
 */
/**
 * Stores each contact's Sales Navigator address alongside their public one.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ IT FILLS A GAP AND NEVER OVERWRITES A VALUE.                          ║
 * ║                                                                           ║
 * ║  Ingestion is re-runnable — `ingestExtractionJob` has an explicit `reRun`  ║
 * ║  path — and the same person arrives from several sources. A blind update   ║
 * ║  would let a later batch with a thinner record replace a good Navigator    ║
 * ║  link, and nothing downstream could tell that it had happened, because     ║
 * ║  both values look equally plausible.                                      ║
 * ║                                                                           ║
 * ║  §4.5 makes that unrecoverable rather than merely annoying: the two URLs   ║
 * ║  cannot be derived from each other, so a clobbered one is gone.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
async function recordNavigatorUrls(
  workspaceId: string,
  pairs: { contactId: string; url: string }[],
): Promise<void> {
  if (pairs.length === 0) return
  const db = createAdminClient()

  const contactIds = [...new Set(pairs.map((p) => p.contactId))]

  /*
   * ⚠️ READ FIRST, AND FILTER TO THE ONES THAT ARE ACTUALLY EMPTY. The
   * alternative — one UPDATE with `.is('sales_navigator_url', null)` in the
   * predicate — would be a single round trip and is what I reached for first.
   * It cannot work here: each contact needs a DIFFERENT url, so it would be one
   * statement per contact anyway, and the version trigger would fire on every
   * one of them whether or not anything changed.
   */
  const { data: existing, error } = await db
    .from('crm_contacts')
    .select('id, sales_navigator_url')
    // Service role bypasses RLS — scoping by workspace is mandatory.
    .eq('workspace_id', workspaceId)
    .in('id', contactIds)
    .is('deleted_at', null)

  if (error) throw new Error(`recordNavigatorUrls failed: ${error.message}`)

  const empty = new Set(
    (existing ?? []).filter((row) => !row.sales_navigator_url).map((row) => row.id),
  )

  const seen = new Set<string>()
  for (const pair of pairs) {
    if (!empty.has(pair.contactId) || seen.has(pair.contactId)) continue
    seen.add(pair.contactId)

    const { error: updateError } = await db
      .from('crm_contacts')
      .update({ sales_navigator_url: pair.url })
      .eq('workspace_id', workspaceId)
      .eq('id', pair.contactId)
      /*
       * ⚠️ THE NULL CHECK IS REPEATED IN THE WHERE CLAUSE, not just relied on
       * from the read above. Two ingests running at once both see it empty;
       * only the predicate stops the second from overwriting the first.
       */
      .is('sales_navigator_url', null)

    /*
     * ⚠️ A FAILURE HERE DOES NOT COST US THE PEOPLE, matching `resolveCompanies`
     * directly below: the contact is ingested and canonical either way. A
     * missing second URL is a degraded record; a thrown error would discard a
     * whole successful batch over a supplementary field.
     */
    if (updateError) {
      console.error('recordNavigatorUrls: update failed', {
        contactId: pair.contactId,
        error: updateError.message,
      })
    }
  }
}

async function linkCompanies(
  workspaceId: string,
  pairs: { contactId: string; companyId: string }[],
): Promise<void> {
  if (pairs.length === 0) return
  const db = createAdminClient()

  const contactIds = [...new Set(pairs.map((p) => p.contactId))]
  const { data: existing, error } = await db
    .from('crm_contact_company_relationships')
    .select('contact_id, company_id')
    .eq('workspace_id', workspaceId)
    .in('contact_id', contactIds)
    .is('deleted_at', null)

  if (error) throw new Error(`linkCompanies failed: ${error.message}`)

  const held = new Set((existing ?? []).map((r) => `${r.contact_id}:${r.company_id}`))
  const fresh = pairs.filter((p) => !held.has(`${p.contactId}:${p.companyId}`))
  if (fresh.length === 0) return

  const { error: insertError } = await db
    .from('crm_contact_company_relationships')
    .insert(
      fresh.map((p) => ({
        workspace_id: workspaceId,
        contact_id: p.contactId,
        company_id: p.companyId,
        // Not primary when the contact already had a relationship: ingestion
        // must not silently move someone's current employer.
        is_primary: !held.has(p.contactId),
        is_current: true,
      })),
    )

  if (insertError) throw new Error(`linkCompanies failed: ${insertError.message}`)
}

// ---------------------------------------------------------------------------
// Extraction → CRM
// ---------------------------------------------------------------------------

/**
 * Ingests one completed extraction job into the CRM.
 *
 * IDEMPOTENT, WHICH IS M2 ACCEPTANCE CRITERION 1. The batch is unique per
 * `(workspace_id, source_extraction_job_id)`, so a second call reuses the same
 * batch, and `crm_ingest_contacts` then matches every person instead of
 * creating them. Zero new contacts, and a partially failed first run is
 * repaired rather than duplicated.
 */
export async function ingestExtractionJob(
  workspaceId: string,
  extractionJobId: string,
  options: { ownerUserId?: string | null; actorUserId?: string | null; name?: string } = {},
): Promise<IngestResult> {
  const db = createAdminClient()

  // ---- tenancy ------------------------------------------------------------
  const { data: job, error: jobError } = await db
    .from('extraction_jobs')
    .select('id, user_id, created_at')
    .eq('id', extractionJobId)
    .maybeSingle()

  if (jobError) throw new Error(`ingestExtractionJob failed: ${jobError.message}`)
  if (!job) throw new Error('ingestExtractionJob: no such extraction job')

  // The extraction belongs to a USER; the CRM belongs to a WORKSPACE. Ingesting
  // across that boundary without checking would move one tenant's leads into
  // another's CRM — the service role would happily do it.
  const { data: membership, error: memberError } = await db
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', job.user_id)
    .maybeSingle()

  if (memberError) throw new Error(`ingestExtractionJob failed: ${memberError.message}`)
  if (!membership) {
    throw new Error('ingestExtractionJob: that extraction does not belong to this workspace')
  }

  // ---- batch --------------------------------------------------------------
  const name = options.name ?? `Extraction ${new Date(job.created_at).toISOString().slice(0, 10)}`

  let batchId: string
  let reRun = false

  const { data: inserted, error: batchError } = await db
    .from('crm_lead_batches')
    .insert({
      workspace_id: workspaceId,
      name,
      source: 'lead_engine',
      source_extraction_job_id: extractionJobId,
      created_by: options.actorUserId ?? null,
    })
    .select('id')
    .single()

  if (batchError) {
    if (batchError.code !== '23505') {
      throw new Error(`ingestExtractionJob failed: ${batchError.message}`)
    }
    const { data: existing, error: readError } = await db
      .from('crm_lead_batches')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('source_extraction_job_id', extractionJobId)
      .is('deleted_at', null)
      .single()

    if (readError) throw new Error(`ingestExtractionJob failed: ${readError.message}`)
    batchId = existing.id
    reRun = true
  } else {
    batchId = inserted.id
  }

  // ---- leads --------------------------------------------------------------
  const { data: leads, error: leadsError } = await db
    .from('extracted_leads')
    // ⚠️ ONE STRING LITERAL, NOT A CONCATENATION. supabase-js parses this at
    // the TYPE level to infer the row shape; `'a, b' + 'c'` is not a literal
    // type, so every column silently degrades to GenericStringError.
    .select('id, full_name, job_title, linkedin_url, sales_navigator_url, location, person_blurb, work_email, mobile_phone, company_name, company_website_url, company_url, company_public_linkedin_url')
    .eq('extraction_job_id', extractionJobId)
    .eq('user_id', job.user_id)
    .eq('is_duplicate', false)

  if (leadsError) throw new Error(`ingestExtractionJob failed: ${leadsError.message}`)

  const rowsSeen = leads?.length ?? 0

  // ---- companies, once each ----------------------------------------------
  const seeds = new Map<string, CompanySeed>()
  const leadCompanyKey = new Map<string, string>()

  for (const lead of leads ?? []) {
    const seed: CompanySeed = {
      name: lead.company_name,
      websiteUrl: lead.company_website_url,
      linkedInUrl: lead.company_public_linkedin_url ?? lead.company_url,
    }
    const key = companyKey(seed)
    if (!key) continue
    if (!seeds.has(key)) seeds.set(key, seed)
    leadCompanyKey.set(lead.id, key)
  }

  const companies = await resolveCompanies(
    workspaceId,
    seeds,
    'lead_engine',
    options.actorUserId ?? null,
  )

  // ---- contacts -----------------------------------------------------------
  const payload: IngestPayloadRow[] = []
  for (const lead of leads ?? []) {
    const key = leadCompanyKey.get(lead.id)
    const row = toPayloadRow(
      lead.id,
      {
        fullName: lead.full_name,
        jobTitle: lead.job_title,
        /*
         * ⚠️ THE COALESCE IS FOR IDENTITY ONLY, AND IT USED TO BE FOR STORAGE
         * TOO — which is the defect 0138 fixes.
         *
         * `linkedin_url` feeds `linkedin_identity_key`, the column the ingest
         * RPC matches people on, and either address resolves into that key
         * space. So preferring the public URL here is correct for MATCHING.
         *
         * What was wrong was that the loser of this `??` then vanished:
         * `crm_contacts` had one column, so a Sales Navigator save — where
         * `linkedin_url` is usually NULL because Navigator does not expose the
         * public slug — stored a `/sales/lead/…` address under `linkedin_url`
         * and discarded nothing only because there was nothing else to keep.
         * The reverse case silently dropped the Navigator link entirely.
         *
         * §4.5 forbids deriving one from the other, so the lost one was lost for
         * good. Both are now carried; see `navigatorUrls` below.
         */
        linkedInUrl: lead.linkedin_url ?? lead.sales_navigator_url,
        location: lead.location,
        headline: lead.person_blurb,
        emails: [lead.work_email],
        phones: [lead.mobile_phone],
        ownerUserId: options.ownerUserId ?? null,
        source: 'lead_engine',
        sourceLeadId: lead.id,
      },
      (key ? companies.get(key) : null) ?? null,
    )
    if (row) payload.push(row)
  }

  const { created, matched, returned } = await runIngest(workspaceId, batchId, payload)

  await linkCompanies(
    workspaceId,
    payload
      .filter((row) => row.company_id && returned.has(row.ref))
      .map((row) => ({ contactId: returned.get(row.ref)!, companyId: row.company_id! })),
  )

  /*
   * ⚠️ AFTER THE RPC RATHER THAN INSIDE IT, DELIBERATELY. `crm_ingest_contacts`
   * is "one implementation of what is this person's identity" — it matches,
   * creates and merges. A Sales Navigator URL is an ATTRIBUTE, not an identity:
   * it never decides who somebody is. Widening a 200-line identity function to
   * carry it would put attribute handling inside the one place that must stay
   * about matching, and `linkCompanies` directly above already establishes the
   * post-ingest attribute write against the same `returned` map.
   */
  await recordNavigatorUrls(
    workspaceId,
    (leads ?? [])
      .filter((lead) => lead.sales_navigator_url && returned.has(lead.id))
      .map((lead) => ({
        contactId: returned.get(lead.id)!,
        url: lead.sales_navigator_url!,
      })),
  )

  const result: IngestResult = {
    batchId,
    rowsSeen,
    contactsCreated: created,
    contactsMatched: matched,
    rowsSkipped: rowsSeen - payload.length,
    reRun,
  }

  await db
    .from('crm_lead_batches')
    .update({
      rows_seen: result.rowsSeen,
      contacts_created: result.contactsCreated,
      contacts_matched: result.contactsMatched,
      rows_skipped: result.rowsSkipped,
    })
    .eq('id', batchId)
    .eq('workspace_id', workspaceId)

  return result
}

// ---------------------------------------------------------------------------
// CSV → CRM
// ---------------------------------------------------------------------------

/**
 * Runs a validated import plan.
 *
 * The plan is what the user approved in the preview, so what runs and what was
 * shown cannot diverge — that is the whole reason `buildImportPlan` produces a
 * plan rather than importing directly.
 */
export async function runCsvImport(
  workspaceId: string,
  importJobId: string,
  plan: ImportPlan,
  options: { actorUserId?: string | null; name?: string } = {},
): Promise<IngestResult> {
  const db = createAdminClient()

  const { data: job, error: jobError } = await db
    .from('crm_import_jobs')
    .select('id, filename, batch_id')
    .eq('id', importJobId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (jobError) throw new Error(`runCsvImport failed: ${jobError.message}`)
  if (!job) throw new Error('runCsvImport: no such import job in this workspace')

  let batchId = job.batch_id
  const reRun = Boolean(batchId)

  if (!batchId) {
    const { data: batch, error: batchError } = await db
      .from('crm_lead_batches')
      .insert({
        workspace_id: workspaceId,
        name: options.name ?? job.filename,
        source: 'csv_import',
        source_import_job_id: importJobId,
        created_by: options.actorUserId ?? null,
      })
      .select('id')
      .single()

    if (batchError) throw new Error(`runCsvImport failed: ${batchError.message}`)
    batchId = batch.id
  }

  await db
    .from('crm_import_jobs')
    .update({ status: 'importing', batch_id: batchId })
    .eq('id', importJobId)
    .eq('workspace_id', workspaceId)

  // Companies, once each, keyed the same way as an extraction.
  const seeds = new Map<string, CompanySeed>()
  const rowCompanyKey = new Map<string, string>()

  for (const row of plan.rows) {
    if (!row.company) continue
    const key = companyKey(row.company)
    if (!key) continue
    if (!seeds.has(key)) seeds.set(key, row.company)
    rowCompanyKey.set(String(row.line), key)
  }

  const companies = await resolveCompanies(
    workspaceId,
    seeds,
    'csv_import',
    options.actorUserId ?? null,
  )

  const payload: IngestPayloadRow[] = []
  for (const row of plan.rows) {
    const key = rowCompanyKey.get(String(row.line))
    // `ref` is the spreadsheet line, so a result can be traced back to the row
    // the user can actually see.
    const built = toPayloadRow(String(row.line), row.contact, (key ? companies.get(key) : null) ?? null)
    if (built) payload.push(built)
  }

  const { created, matched, returned } = await runIngest(workspaceId, batchId, payload)

  await linkCompanies(
    workspaceId,
    payload
      .filter((row) => row.company_id && returned.has(row.ref))
      .map((row) => ({ contactId: returned.get(row.ref)!, companyId: row.company_id! })),
  )

  const rowsSkipped = plan.rowsTotal - payload.length

  await db
    .from('crm_lead_batches')
    .update({
      rows_seen: plan.rowsTotal,
      contacts_created: created,
      contacts_matched: matched,
      rows_skipped: rowsSkipped,
    })
    .eq('id', batchId)
    .eq('workspace_id', workspaceId)

  await db
    .from('crm_import_jobs')
    .update({
      // A file with some bad rows is `partially_completed`, not `failed`:
      // 4,991 of 5,000 people did import, and calling that a failure hides it.
      status: plan.errors.length > 0 ? 'partially_completed' : 'completed',
      rows_total: plan.rowsTotal,
      rows_imported: created + matched,
      rows_skipped: rowsSkipped,
      errors: plan.errors as unknown as Json,
    })
    .eq('id', importJobId)
    .eq('workspace_id', workspaceId)

  return {
    batchId,
    rowsSeen: plan.rowsTotal,
    contactsCreated: created,
    contactsMatched: matched,
    rowsSkipped,
    reRun,
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Rolls a batch back.
 *
 * Soft-deletes the contacts this batch CREATED and removes membership for the
 * ones it merely matched. See Ledger D16 — undoing an import that recognised
 * an existing person must never delete that person.
 */
export async function undoBatch(
  workspaceId: string,
  batchId: string,
): Promise<{ contactsDeleted: number; membershipsRemoved: number }> {
  const db = createAdminClient()

  const { data, error } = await db.rpc('crm_undo_batch', {
    p_workspace_id: workspaceId,
    p_batch_id: batchId,
  })

  if (error) throw new Error(`undoBatch failed: ${error.message}`)

  const row = data?.[0]

  await db
    .from('crm_import_jobs')
    .update({ status: 'undone', undone_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('batch_id', batchId)

  return {
    contactsDeleted: row?.contacts_deleted ?? 0,
    membershipsRemoved: row?.memberships_removed ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Manual contact creation — R2
// ---------------------------------------------------------------------------

/**
 * Adds one contact by hand.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS GOES THROUGH `crm_ingest_contacts`, NOT A PLAIN INSERT.         ║
 * ║                                                                           ║
 * ║  A "+ Contact" button that inserts a row directly would bypass every      ║
 * ║  identity rule M2 exists to enforce: normalization, email and LinkedIn    ║
 * ║  matching, and the canonical-contact guarantee. Someone typing in a       ║
 * ║  person who is already in the CRM would silently create a second copy —   ║
 * ║  and manual entry is the single most likely way that happens, because it  ║
 * ║  is what people reach for when they cannot find someone.                  ║
 * ║                                                                           ║
 * ║  So the manual path is the import path with one row, and it reports       ║
 * ║  whether it created or matched.                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function createContactManually(
  workspaceId: string,
  input: ContactInput,
  actorUserId: string | null = null,
): Promise<{ contactId: string; created: boolean; ownerUserId: string | null }> {
  const db = createAdminClient()

  /*
   * One batch per workspace collects everything typed in by hand, so a manual
   * contact still has a provenance in the funnel rather than appearing from
   * nowhere. Found or created — not one batch per contact, which would make
   * the batch report useless.
   */
  const { data: existing } = await db
    .from('crm_lead_batches')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('source', 'manual')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  let batchId = existing?.id ?? null

  if (!batchId) {
    const { data: batch, error } = await db
      .from('crm_lead_batches')
      .insert({
        workspace_id: workspaceId,
        name: 'Added manually',
        source: 'manual',
        created_by: actorUserId,
      })
      .select('id')
      .single()

    if (error || !batch) {
      throw new Error(`createContactManually failed: ${error?.message ?? 'no batch'}`)
    }
    batchId = batch.id
  }

  const row = toPayloadRow('manual-1', input, null)
  if (!row) {
    // The normalizer rejects a row with no usable identity. Saying so plainly
    // beats storing a nameless, unreachable contact.
    throw new Error('createContactManually: a contact needs a name or an email')
  }

  const outcome = await runIngest(workspaceId, batchId, [row])
  const contactId = outcome.returned.get('manual-1')

  if (!contactId) throw new Error('createContactManually: the contact was not returned')

  /*
   * ⚠️ ONLY WHEN THE CONTACT IS NEW. A matched contact is someone the CRM
   * already had, and firing `contact_created` for them would re-run assignment
   * and re-task a person who has been worked for months.
   */
  if (outcome.created > 0) {
    await emitDomainEvent({
      workspaceId,
      triggerType: 'contact_created',
      contactId,
      // The contact id IS the occurrence: one creation, one dispatch, however
      // many times this is retried.
      idempotencyKey: `contact_created:${contactId}`,
    })
  }

  const created = outcome.created > 0

  /*
   * ⚠️ THE OWNER IS RETURNED SO THE CALLER CAN DECIDE WHETHER TO SAY ANYTHING.
   *
   * A match is somebody the workspace already had, and the caller may be a
   * setter who cannot see that person. Handing back only `{ contactId, created }`
   * left the action with no way to tell "already yours" from "already someone
   * else's", so it said "already in your CRM" either way — disclosing the
   * existence and the id of a record the requester is not permitted to read.
   *
   * Read only on the match path: a created contact is owned by whoever asked
   * for it, which the input already says, so the happy path keeps its one
   * round trip.
   */
  let ownerUserId: string | null = input.ownerUserId ?? null
  if (!created) {
    const { data: matched } = await db
      .from('crm_contacts')
      .select('owner_user_id')
      .eq('workspace_id', workspaceId)
      .eq('id', contactId)
      .maybeSingle()

    ownerUserId = matched?.owner_user_id ?? null
  }

  return { contactId, created, ownerUserId }
}
