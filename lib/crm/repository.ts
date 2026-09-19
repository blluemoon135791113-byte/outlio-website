import 'server-only'

/**
 * Reading and writing canonical CRM records (M2 Phase 2).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ONE REAL PERSON = ONE crm_contacts ROW PER WORKSPACE.                   ║
 * ║                                                                          ║
 * ║  Every write path — manual entry, CSV import, the API, Lead Engine       ║
 * ║  ingestion — comes through `upsertContact`. Four write paths and one     ║
 * ║  identity rule; the path that reimplements it is the one that creates    ║
 * ║  the duplicate.                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NORMALIZATION IS NOT DONE HERE. Callers pass raw values and this module
 * runs them through `lib/crm/normalize.ts`, the single implementation. Nothing
 * in this file re-derives an identity key.
 *
 * ⚠️ THE SERVICE ROLE BYPASSES RLS. Every query below is scoped by
 * `workspace_id` in code. See the banner in lib/supabase/admin.ts.
 *
 * SCOPE: single-record writes. Bulk ingestion (Phase 3) needs a set-based
 * atomic upsert in Postgres, for the reason `link_leads_to_companies`
 * documents — one statement per batch rather than three round trips per
 * contact. That function receives values normalized by this same module.
 */
import {
  normalizeCompanyLinkedInUrl,
  normalizeCompanyName,
  normalizeDomain,
} from '@/lib/companies/normalize'
import {
  normalizeContactLinkedInUrl,
  normalizeEmail,
  normalizePersonName,
  normalizePhoneNumber,
  normalizeTagName,
} from '@/lib/crm/normalize'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

type RecordSource = Database['public']['Enums']['crm_record_source']

/** Postgres unique-violation. The upsert paths below turn it into a re-read. */
const UNIQUE_VIOLATION = '23505'

export type ContactInput = {
  fullName?: string | null
  jobTitle?: string | null
  linkedInUrl?: string | null
  location?: string | null
  headline?: string | null
  emails?: (string | null | undefined)[]
  phones?: (string | null | undefined)[]
  /** Only used when a phone arrives in national format. Never inferred. */
  defaultPhoneCountry?: string | null
  ownerUserId?: string | null
  source?: RecordSource
  sourceLeadId?: string | null
}

export type CompanyInput = {
  name?: string | null
  websiteUrl?: string | null
  linkedInUrl?: string | null
  industry?: string | null
  employeeCount?: number | null
  headquarters?: string | null
  ownerUserId?: string | null
  source?: RecordSource
  sourceCompanyId?: string | null
}

/** How an existing record was recognised. `null` when it was created. */
export type MatchStrategy = 'linkedin' | 'email' | 'domain' | 'name'

export type UpsertResult = {
  id: string
  created: boolean
  matchedBy: MatchStrategy | null
}

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

/**
 * The normalized identity of a contact, derived once and reused.
 *
 * Exported so Phase 3's bulk path can build the same payload without going
 * through the single-record writes here.
 */
export type ContactIdentity = {
  fullName: string | null
  firstName: string | null
  lastName: string | null
  linkedInUrl: string | null
  linkedInIdentityKey: string | null
  emails: { address: string; identityKey: string }[]
  phones: { raw: string; e164: string | null }[]
}

export function resolveContactIdentity(input: ContactInput): ContactIdentity {
  const name = normalizePersonName(input.fullName)
  const linkedIn = normalizeContactLinkedInUrl(input.linkedInUrl)

  // Deduplicated within the row itself: an import that lists the same address
  // twice must not attempt two inserts and trip its own unique index.
  const emails: ContactIdentity['emails'] = []
  for (const raw of input.emails ?? []) {
    const email = normalizeEmail(raw)
    if (!email) continue
    if (emails.some((e) => e.identityKey === email.identityKey)) continue
    emails.push({ address: email.address, identityKey: email.identityKey })
  }

  const phones: ContactIdentity['phones'] = []
  for (const raw of input.phones ?? []) {
    const phone = normalizePhoneNumber(raw, {
      defaultCountry: input.defaultPhoneCountry ?? null,
    })
    if (!phone) continue
    // An unparseable number is still kept — see Ledger D12. Dedupe on E.164
    // where we have one, otherwise on the raw string.
    const already = phones.some((p) =>
      phone.e164 ? p.e164 === phone.e164 : p.raw === phone.raw,
    )
    if (already) continue
    phones.push({ raw: phone.raw, e164: phone.e164 })
  }

  return {
    fullName: name?.fullName ?? null,
    firstName: name?.firstName ?? null,
    lastName: name?.lastName ?? null,
    linkedInUrl: linkedIn?.canonicalUrl ?? input.linkedInUrl?.trim() ?? null,
    linkedInIdentityKey: linkedIn?.identityKey ?? null,
    emails,
    phones,
  }
}

/**
 * Finds an existing contact by any of its blocking keys.
 *
 * PRECEDENCE: LinkedIn, then email. Both are exact blocks (M2 Phase 4); the
 * order only decides which one is reported when a record matches on both.
 *
 * Phone is deliberately absent: a switchboard is shared, so it raises a
 * candidate for a human rather than silently matching. See Ledger D14.
 */
export async function findContactByIdentity(
  workspaceId: string,
  identity: Pick<ContactIdentity, 'linkedInIdentityKey' | 'emails'>,
): Promise<{ id: string; matchedBy: MatchStrategy } | null> {
  const db = createAdminClient()

  if (identity.linkedInIdentityKey) {
    const { data, error } = await db
      .from('crm_contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('linkedin_identity_key', identity.linkedInIdentityKey)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw new Error(`findContactByIdentity failed: ${error.message}`)
    if (data) return { id: data.id, matchedBy: 'linkedin' }
  }

  if (identity.emails.length > 0) {
    const { data, error } = await db
      .from('crm_contact_emails')
      .select('contact_id')
      .eq('workspace_id', workspaceId)
      .in(
        'identity_key',
        identity.emails.map((e) => e.identityKey),
      )
      .is('deleted_at', null)
      .limit(1)

    if (error) throw new Error(`findContactByIdentity failed: ${error.message}`)
    if (data?.[0]) return { id: data[0].contact_id, matchedBy: 'email' }
  }

  return null
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Creates a contact, or returns the one that already represents this person.
 *
 * ⚠️ CONCURRENCY. Match-then-create is two statements, so two simultaneous
 * imports of one person can both find nothing and both insert. The unique
 * indexes in 0071 are what actually enforce identity: the loser gets a 23505
 * and this function re-reads instead of failing.
 *
 * That closes the race for a SHARED key. It does not close the case where one
 * caller writes a person by LinkedIn and another writes the same person by
 * email in the same instant — those collide on no index and produce two rows.
 * That is not a bug to paper over here: it is exactly the "possible duplicate"
 * M2 Phase 4's Duplicate Center exists to surface, with a human deciding.
 * Never silently merge uncertain people (M2 Phase 4).
 */
export async function upsertContact(
  workspaceId: string,
  input: ContactInput,
  actorUserId: string | null = null,
): Promise<UpsertResult> {
  const identity = resolveContactIdentity(input)

  if (!identity.fullName && !identity.linkedInIdentityKey && identity.emails.length === 0) {
    throw new Error('upsertContact: the input identifies nobody')
  }

  const existing = await findContactByIdentity(workspaceId, identity)
  if (existing) {
    // Attach anything new this sighting carried. An import that adds a second
    // address to a known person must enrich them, not be discarded.
    await attachContactEmails(workspaceId, existing.id, identity.emails, input.source)
    await attachContactPhones(workspaceId, existing.id, identity.phones, input.source)
    return { id: existing.id, created: false, matchedBy: existing.matchedBy }
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId,
      owner_user_id: input.ownerUserId ?? null,
      full_name: identity.fullName,
      first_name: identity.firstName,
      last_name: identity.lastName,
      job_title: input.jobTitle?.trim() || null,
      linkedin_url: identity.linkedInUrl,
      linkedin_identity_key: identity.linkedInIdentityKey,
      location: input.location?.trim() || null,
      headline: input.headline?.trim() || null,
      source: input.source ?? 'manual',
      source_lead_id: input.sourceLeadId ?? null,
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Lost the race on linkedin_identity_key. The winner's row is the
      // canonical one.
      const winner = await findContactByIdentity(workspaceId, identity)
      if (winner) {
        await attachContactEmails(workspaceId, winner.id, identity.emails, input.source)
        await attachContactPhones(workspaceId, winner.id, identity.phones, input.source)
        return { id: winner.id, created: false, matchedBy: winner.matchedBy }
      }
    }
    throw new Error(`upsertContact failed: ${error.message}`)
  }

  await attachContactEmails(workspaceId, data.id, identity.emails, input.source)
  await attachContactPhones(workspaceId, data.id, identity.phones, input.source)

  return { id: data.id, created: true, matchedBy: null }
}

/**
 * Attaches addresses to a contact, ignoring any that already belong to someone.
 *
 * ⚠️ A COLLISION HERE IS NOT AN ERROR. `crm_contact_emails` is unique on
 * (workspace_id, identity_key), so an address already held by ANOTHER contact
 * raises 23505. Stealing it would silently move a mailbox between people;
 * failing the whole import would lose the rest of the row. It is skipped, and
 * Phase 4 surfaces the two records as a duplicate pair.
 */
export async function attachContactEmails(
  workspaceId: string,
  contactId: string,
  /*
   * ⚠️ `evidenceId` IS THE CITATION, AND IT IS OPTIONAL FOR A REASON. A value
   * typed by hand has no citation and must not be given one — CLAUDE.md rule 4
   * forbids storing a plausible source as readily as it forbids storing a
   * plausible value. Absent means absent.
   */
  emails: { address: string; identityKey: string; evidenceId?: string | null }[],
  source: RecordSource = 'manual',
  /*
   * ⚠️ RETURNS ROWS INSERTED, NOT ROWS OFFERED, and the difference is the
   * point. This is idempotent by design — a duplicate is swallowed below — so
   * callers that reported `emails.length` were reporting the same number on
   * every re-run forever. The evidence bridge claimed "+12 emails" on every
   * tick for two days while inserting nothing.
   */
): Promise<number> {
  if (emails.length === 0) return 0
  const db = createAdminClient()
  let inserted = 0

  const { count } = await db
    .from('crm_contact_emails')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .is('deleted_at', null)

  let hasPrimary = (count ?? 0) > 0

  for (const email of emails) {
    const { error } = await db.from('crm_contact_emails').insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      address: email.address,
      identity_key: email.identityKey,
      evidence_id: email.evidenceId ?? null,
      // The first address a contact ever gets becomes primary; later ones do
      // not silently take over the address campaigns send to.
      is_primary: !hasPrimary,
      source,
    })

    if (error) {
      if (error.code === UNIQUE_VIOLATION) continue
      throw new Error(`attachContactEmails failed: ${error.message}`)
    }
    inserted += 1
    hasPrimary = true
  }

  return inserted
}

/**
 * Attaches phone numbers.
 *
 * Unlike emails these carry no cross-contact unique index (Ledger D14), so the
 * only duplication to guard is the same number twice on the SAME contact.
 */
export async function attachContactPhones(
  workspaceId: string,
  contactId: string,
  // See the note on attachContactEmails: absent citation means absent.
  phones: { raw: string; e164: string | null; evidenceId?: string | null }[],
  source: RecordSource = 'manual',
  // Rows inserted, not rows offered — see the note on attachContactEmails.
): Promise<number> {
  if (phones.length === 0) return 0
  const db = createAdminClient()
  let inserted = 0

  const { data: existing, error: readError } = await db
    .from('crm_contact_phones')
    .select('raw, e164')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .is('deleted_at', null)

  if (readError) throw new Error(`attachContactPhones failed: ${readError.message}`)

  const held = existing ?? []
  let hasPrimary = held.length > 0

  for (const phone of phones) {
    const duplicate = held.some((p) =>
      phone.e164 ? p.e164 === phone.e164 : p.raw === phone.raw,
    )
    if (duplicate) continue

    const { error } = await db.from('crm_contact_phones').insert({
      workspace_id: workspaceId,
      contact_id: contactId,
      raw: phone.raw,
      e164: phone.e164,
      evidence_id: phone.evidenceId ?? null,
      is_primary: !hasPrimary,
      source,
    })

    if (error) {
      if (error.code === UNIQUE_VIOLATION) continue
      throw new Error(`attachContactPhones failed: ${error.message}`)
    }
    held.push({ raw: phone.raw, e164: phone.e164 })
    inserted += 1
    hasPrimary = true
  }

  return inserted
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export type CompanyIdentity = {
  name: string | null
  normalizedName: string | null
  domain: string | null
  normalizedDomain: string | null
  linkedInUrl: string | null
  normalizedLinkedInUrl: string | null
}

export function resolveCrmCompanyIdentity(input: CompanyInput): CompanyIdentity {
  const normalizedDomain = normalizeDomain(input.websiteUrl)
  const normalizedLinkedInUrl = normalizeCompanyLinkedInUrl(input.linkedInUrl)

  return {
    name: input.name?.trim() || null,
    normalizedName: normalizeCompanyName(input.name),
    domain: normalizedDomain ? (input.websiteUrl?.trim() ?? null) : null,
    normalizedDomain,
    linkedInUrl: normalizedLinkedInUrl ? (input.linkedInUrl?.trim() ?? null) : null,
    normalizedLinkedInUrl,
  }
}

/**
 * Creates a CRM account, or returns the one that already represents it.
 *
 * PRECEDENCE — domain, then LinkedIn page, then name, matching
 * `resolveCompanyIdentity` in lib/companies/normalize.ts and the partial
 * unique indexes in 0071. **Name is the last resort and only matches rows that
 * carry nothing stronger**, so two unrelated companies that happen to share a
 * name are never merged.
 */
export async function upsertCrmCompany(
  workspaceId: string,
  input: CompanyInput,
  actorUserId: string | null = null,
): Promise<UpsertResult> {
  const identity = resolveCrmCompanyIdentity(input)

  if (!identity.normalizedDomain && !identity.normalizedLinkedInUrl && !identity.normalizedName) {
    throw new Error('upsertCrmCompany: the input identifies no company')
  }

  const db = createAdminClient()

  const find = async (): Promise<{ id: string; matchedBy: MatchStrategy } | null> => {
    const base = () =>
      db
        .from('crm_companies')
        .select('id')
        .eq('workspace_id', workspaceId)
        .is('deleted_at', null)

    if (identity.normalizedDomain) {
      const { data, error } = await base()
        .eq('normalized_domain', identity.normalizedDomain)
        .maybeSingle()
      if (error) throw new Error(`upsertCrmCompany failed: ${error.message}`)
      if (data) return { id: data.id, matchedBy: 'domain' }
    }

    if (identity.normalizedLinkedInUrl) {
      const { data, error } = await base()
        .eq('normalized_linkedin_url', identity.normalizedLinkedInUrl)
        .maybeSingle()
      if (error) throw new Error(`upsertCrmCompany failed: ${error.message}`)
      if (data) return { id: data.id, matchedBy: 'linkedin' }
    }

    // Only when THIS input carries nothing stronger. Matching a domain-bearing
    // input by name would collapse "Apex Systems" onto "Apex Ltd".
    if (
      identity.normalizedName &&
      !identity.normalizedDomain &&
      !identity.normalizedLinkedInUrl
    ) {
      const { data, error } = await base()
        .eq('normalized_name', identity.normalizedName)
        .is('normalized_domain', null)
        .is('normalized_linkedin_url', null)
        .maybeSingle()
      if (error) throw new Error(`upsertCrmCompany failed: ${error.message}`)
      if (data) return { id: data.id, matchedBy: 'name' }
    }

    return null
  }

  const existing = await find()
  if (existing) {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THIS USED TO RETURN IMMEDIATELY, AND THAT IS WHY THE COMPANIES    ║
     * ║  SCREEN WAS A COLUMN OF DASHES.                                       ║
     * ║                                                                       ║
     * ║  A company is almost always first created by a LEAD extraction, which ║
     * ║  observes a NAME and nothing else. Every later sighting of the same   ║
     * ║  company — an extension capture carrying the industry and headcount   ║
     * ║  off the company page, an account extraction, a CSV with a domain —   ║
     * ║  matched that row and returned here, discarding everything it knew.   ║
     * ║                                                                       ║
     * ║  So the first, thinnest observation won permanently, and no amount of ║
     * ║  richer data afterwards could ever fill the row in. `CompanyInput`    ║
     * ║  has carried `industry`, `employeeCount` and `headquarters` since     ║
     * ║  0071 and only the INSERT below had ever read them.                   ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    await fillCompanyGaps(db, workspaceId, existing.id, input)
    return { id: existing.id, created: false, matchedBy: existing.matchedBy }
  }

  const { data, error } = await db
    .from('crm_companies')
    .insert({
      workspace_id: workspaceId,
      owner_user_id: input.ownerUserId ?? null,
      name: identity.name,
      normalized_name: identity.normalizedName,
      domain: identity.domain,
      normalized_domain: identity.normalizedDomain,
      linkedin_url: identity.linkedInUrl,
      normalized_linkedin_url: identity.normalizedLinkedInUrl,
      industry: input.industry?.trim() || null,
      employee_count: input.employeeCount ?? null,
      headquarters: input.headquarters?.trim() || null,
      source: input.source ?? 'manual',
      source_company_id: input.sourceCompanyId ?? null,
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const winner = await find()
      if (winner) return { id: winner.id, created: false, matchedBy: winner.matchedBy }
    }
    throw new Error(`upsertCrmCompany failed: ${error.message}`)
  }

  return { id: data.id, created: true, matchedBy: null }
}

/**
 * Fills in facts an existing company row does not have yet.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ FILLS NULLS. NEVER OVERWRITES, NEVER NULLS ANYTHING OUT.             ║
 * ║                                                                           ║
 * ║  Two different mistakes are being avoided, and they pull in opposite      ║
 * ║  directions:                                                              ║
 * ║                                                                           ║
 * ║   1. A blind UPDATE with the whole input would ERASE a value on every     ║
 * ║      ingest that happened not to carry it — and a lead extraction carries ║
 * ║      a name and nothing else, so importing one CSV would wipe the         ║
 * ║      industry off every company in it. Silent, and invisible until        ║
 * ║      somebody noticed the screen had gone blank again.                    ║
 * ║                                                                           ║
 * ║   2. Preferring the NEWEST observation would let a thin source overwrite  ║
 * ║      a richer one, and would silently discard a value a human typed.      ║
 * ║                                                                           ║
 * ║  First observation wins; later ones may only fill a gap. Every value      ║
 * ║  stored was literally observed somewhere (CLAUDE.md rule 4) — nothing     ║
 * ║  here infers, averages or reconciles.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ IDENTITY COLUMNS ARE INCLUDED AND THEIR NORMALIZED PAIRS MOVE WITH THEM.
 * A company matched by name can later be seen with a domain, and that domain is
 * what every future match should use — but `domain` without `normalized_domain`
 * would be displayed and never matched on, which is worse than not storing it.
 */
async function fillCompanyGaps(
  db: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  companyId: string,
  input: CompanyInput,
): Promise<void> {
  const identity = resolveCrmCompanyIdentity(input)

  const { data: current } = await db
    .from('crm_companies')
    .select(
      'domain, normalized_domain, linkedin_url, normalized_linkedin_url, industry, employee_count, headquarters, source_company_id',
    )
    // The service role bypasses RLS — scoping by workspace is mandatory.
    .eq('workspace_id', workspaceId)
    .eq('id', companyId)
    .maybeSingle()

  if (!current) return

  /*
   * ⚠️ THE GENERATED UPDATE TYPE, NOT `Record<string, unknown>`. A loose index
   * signature would let a misspelled column through to PostgREST, which
   * ignores unknown keys silently — so the gap would simply never fill and
   * nothing would report why.
   */
  const patch: Database['public']['Tables']['crm_companies']['Update'] = {}

  if (!current.industry && input.industry?.trim()) {
    patch.industry = input.industry.trim()
  }
  if (current.employee_count === null && typeof input.employeeCount === 'number') {
    patch.employee_count = input.employeeCount
  }
  if (!current.headquarters && input.headquarters?.trim()) {
    patch.headquarters = input.headquarters.trim()
  }
  /*
   * ⚠️ THIS ONE MATTERS MOST FOR ROWS THAT ALREADY EXIST. Nothing had ever set
   * `source_company_id`, so every company in every workspace has it NULL — and
   * `companyDetails` early-returns on a null id, which is why funding, tech
   * stack, news and socials render empty everywhere. Filling it on the next
   * ingest is what lights those up for companies created before today, without
   * a backfill migration.
   */
  if (!current.source_company_id && input.sourceCompanyId) {
    patch.source_company_id = input.sourceCompanyId
  }
  if (!current.normalized_domain && identity.normalizedDomain && identity.domain) {
    patch.domain = identity.domain
    patch.normalized_domain = identity.normalizedDomain
  }
  if (
    !current.normalized_linkedin_url
    && identity.normalizedLinkedInUrl
    && identity.linkedInUrl
  ) {
    patch.linkedin_url = identity.linkedInUrl
    patch.normalized_linkedin_url = identity.normalizedLinkedInUrl
  }

  // Nothing new. Skipped rather than written, because every batch re-resolves
  // every company it mentions and a no-op UPDATE per company per import is a
  // write amplification nobody asked for.
  if (Object.keys(patch).length === 0) return

  /*
   * ⚠️ A FAILURE HERE MUST NOT COST THE CALLER ITS COMPANY. `resolveCompanies`
   * treats a throw as "this contact has no employer", so letting a unique
   * violation on `normalized_domain` — two name-matched rows converging on one
   * domain, which is a real race — escape would unlink people from a company
   * that resolved perfectly well. The gap simply stays a gap.
   */
  await db
    .from('crm_companies')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', companyId)
}

/**
 * Records that a contact works at a company, and projects it onto the contact.
 *
 * The relationship row is the source of truth;
 * `crm_contacts.primary_company_id` is the projection a list query reads.
 * Both are written here so they cannot diverge.
 *
 * A previous primary is marked not-current rather than deleted: "left Acme for
 * Globex last month" is a buying signal, and overwriting destroys it.
 */
export async function linkContactToCompany(
  workspaceId: string,
  contactId: string,
  companyId: string,
  options: { title?: string | null; isPrimary?: boolean } = {},
): Promise<void> {
  const db = createAdminClient()
  const isPrimary = options.isPrimary ?? true

  if (isPrimary) {
    await db
      .from('crm_contact_company_relationships')
      .update({ is_primary: false, is_current: false, ended_at: new Date().toISOString().slice(0, 10) })
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .eq('is_primary', true)
      .is('deleted_at', null)
      .neq('company_id', companyId)
  }

  const { error } = await db.from('crm_contact_company_relationships').insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    company_id: companyId,
    title: options.title?.trim() || null,
    is_primary: isPrimary,
    is_current: true,
  })

  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`linkContactToCompany failed: ${error.message}`)
  }

  if (error?.code === UNIQUE_VIOLATION) {
    // Already linked — re-assert the current state rather than duplicating.
    const { error: updateError } = await db
      .from('crm_contact_company_relationships')
      .update({
        is_primary: isPrimary,
        is_current: true,
        ended_at: null,
        title: options.title?.trim() || null,
      })
      .eq('workspace_id', workspaceId)
      .eq('contact_id', contactId)
      .eq('company_id', companyId)

    if (updateError) throw new Error(`linkContactToCompany failed: ${updateError.message}`)
  }

  if (isPrimary) {
    const { error: projectionError } = await db
      .from('crm_contacts')
      .update({ primary_company_id: companyId })
      .eq('workspace_id', workspaceId)
      .eq('id', contactId)

    if (projectionError) {
      throw new Error(`linkContactToCompany failed: ${projectionError.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Creates a tag, or returns the existing one with the same normalized name. */
export async function upsertTag(
  workspaceId: string,
  name: string,
  actorUserId: string | null = null,
): Promise<string> {
  const tag = normalizeTagName(name)
  if (!tag) throw new Error('upsertTag: that is not a usable tag name')

  const db = createAdminClient()
  const { data, error } = await db
    .from('crm_tags')
    .insert({
      workspace_id: workspaceId,
      name: tag.name,
      normalized_name: tag.normalizedName,
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const { data: existing, error: readError } = await db
        .from('crm_tags')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('normalized_name', tag.normalizedName)
        .is('deleted_at', null)
        .single()

      if (readError) throw new Error(`upsertTag failed: ${readError.message}`)
      return existing.id
    }
    throw new Error(`upsertTag failed: ${error.message}`)
  }

  return data.id
}

export async function tagContact(
  workspaceId: string,
  contactId: string,
  tagId: string,
  actorUserId: string | null = null,
): Promise<void> {
  const { error } = await createAdminClient().from('crm_contact_tags').insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    tag_id: tagId,
    created_by: actorUserId,
  })

  // Tagging twice is the same statement as tagging once.
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`tagContact failed: ${error.message}`)
  }
}
