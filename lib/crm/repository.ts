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
): Promise<void> {
  if (emails.length === 0) return
  const db = createAdminClient()

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
    hasPrimary = true
  }
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
): Promise<void> {
  if (phones.length === 0) return
  const db = createAdminClient()

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
    hasPrimary = true
  }
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
  if (existing) return { id: existing.id, created: false, matchedBy: existing.matchedBy }

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
