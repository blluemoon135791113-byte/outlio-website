/**
 * CRM core identity — M2 Phase 2.
 *
 * The claim under test is the Constitution's A3 invariant: ONE REAL PERSON =
 * ONE CONTACT PER WORKSPACE. It cannot be checked without a database, because
 * what enforces it is a set of partial unique indexes and the way
 * `upsertContact` reacts to them.
 *
 * Also covers cross-workspace isolation on the ten new tables: two workspaces
 * holding the same person must hold TWO rows, and neither may read the other's.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  attachContactEmails,
  findContactByIdentity,
  linkContactToCompany,
  resolveContactIdentity,
  tagContact,
  upsertContact,
  upsertCrmCompany,
  upsertTag,
} from '@/lib/crm/repository'
import {
  adminClient,
  createTestUser,
  deleteTestUser,
  hasSupabaseEnv,
  type TestUser,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

/** Unique per run, so a re-run never collides with its own leftovers. */
const RUN = Date.now().toString(36)
const slug = (label: string) => `${label}-${RUN}`

async function workspaceOf(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', userId)
    .single()
  if (error) throw new Error(`workspaceOf failed: ${error.message}`)
  return data.workspace_id
}

describeIf('CRM core identity', () => {
  let alice: TestUser
  let bob: TestUser
  let aliceWs: string
  let bobWs: string

  beforeAll(async () => {
    alice = await createTestUser('crm-alice')
    bob = await createTestUser('crm-bob')
    aliceWs = await workspaceOf(alice.id)
    bobWs = await workspaceOf(bob.id)
  })

  afterAll(async () => {
    // Everything cascades from workspaces, which cascade from auth.users.
    if (alice) await deleteTestUser(alice.id)
    if (bob) await deleteTestUser(bob.id)
  })

  // -------------------------------------------------------------------------
  // One person, one row
  // -------------------------------------------------------------------------

  describe('one real person = one contact per workspace', () => {
    it('creates a contact on first sight', async () => {
      const result = await upsertContact(aliceWs, {
        fullName: 'Dana Fabricated',
        linkedInUrl: `https://www.linkedin.com/in/${slug('dana')}`,
        emails: [`dana-${RUN}@example.com`],
        source: 'manual',
      })

      expect(result.created).toBe(true)
      expect(result.matchedBy).toBeNull()
    })

    it('recognises the same person by LinkedIn, whatever the URL looks like', async () => {
      const result = await upsertContact(aliceWs, {
        // Different casing, no scheme, trailing slash, tracking query.
        fullName: 'Dana Fabricated',
        linkedInUrl: `LINKEDIN.com/in/${slug('DANA')}/?trk=nav`,
      })

      expect(result.created).toBe(false)
      expect(result.matchedBy).toBe('linkedin')
    })

    it('recognises the same person by email alone', async () => {
      const result = await upsertContact(aliceWs, {
        fullName: 'D. Fabricated',
        emails: [`dana-${RUN}@example.com`],
      })

      expect(result.created).toBe(false)
      expect(result.matchedBy).toBe('email')
    })

    it('recognises a folded Gmail address as the same mailbox', async () => {
      const first = await upsertContact(aliceWs, {
        fullName: 'Gmail Person',
        emails: [`gmailperson.${RUN}@gmail.com`],
      })
      expect(first.created).toBe(true)

      const again = await upsertContact(aliceWs, {
        fullName: 'Gmail Person',
        // Dots and a +tag: the same mailbox at Google.
        emails: [`g.mail.person.${RUN}+newsletter@googlemail.com`],
      })
      expect(again.created).toBe(false)
      expect(again.matchedBy).toBe('email')
      expect(again.id).toBe(first.id)
    })

    it('leaves exactly one row behind for that person', async () => {
      const { count } = await adminClient()
        .from('crm_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', aliceWs)
        .eq('linkedin_identity_key', `li:in:${slug('dana').toLowerCase()}`)
        .is('deleted_at', null)

      expect(count).toBe(1)
    })

    it('treats two different people as two contacts', async () => {
      const other = await upsertContact(aliceWs, {
        fullName: 'Different Person',
        emails: [`different-${RUN}@example.com`],
      })
      expect(other.created).toBe(true)
    })

    it('refuses input that identifies nobody', async () => {
      await expect(upsertContact(aliceWs, { jobTitle: 'CTO' })).rejects.toThrow(
        /identifies nobody/i,
      )
    })
  })

  describe('enrichment on re-sighting', () => {
    it('adds a newly seen address to a known person', async () => {
      await upsertContact(aliceWs, {
        fullName: 'Dana Fabricated',
        linkedInUrl: `https://www.linkedin.com/in/${slug('dana')}`,
        emails: [`dana.work-${RUN}@acme.example.com`],
      })

      const found = await findContactByIdentity(aliceWs, {
        linkedInIdentityKey: `li:in:${slug('dana').toLowerCase()}`,
        emails: [],
      })

      const { data } = await adminClient()
        .from('crm_contact_emails')
        .select('address, is_primary')
        .eq('workspace_id', aliceWs)
        .eq('contact_id', found!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })

      expect(data?.map((r) => r.address)).toEqual([
        `dana-${RUN}@example.com`,
        `dana.work-${RUN}@acme.example.com`,
      ])
      // The first address stays primary: a later sighting must not silently
      // change where campaigns send.
      expect(data?.map((r) => r.is_primary)).toEqual([true, false])
    })

    it('does NOT steal an address that belongs to someone else', async () => {
      const owner = await upsertContact(aliceWs, {
        fullName: 'Address Owner',
        emails: [`shared-${RUN}@example.com`],
      })
      const other = await upsertContact(aliceWs, {
        fullName: 'Someone Else',
        linkedInUrl: `https://www.linkedin.com/in/${slug('someone-else')}`,
      })

      // Attaching a taken address must be a no-op, not a theft and not a crash.
      await attachContactEmails(aliceWs, other.id, [
        { address: `shared-${RUN}@example.com`, identityKey: `shared-${RUN}@example.com` },
      ])

      const { data } = await adminClient()
        .from('crm_contact_emails')
        .select('contact_id')
        .eq('workspace_id', aliceWs)
        .eq('identity_key', `shared-${RUN}@example.com`)
        .is('deleted_at', null)

      expect(data).toHaveLength(1)
      expect(data?.[0]?.contact_id).toBe(owner.id)
    })
  })

  // -------------------------------------------------------------------------
  // Phones
  // -------------------------------------------------------------------------

  describe('phones are a candidate, never a block', () => {
    it('lets two colleagues share a switchboard number', async () => {
      const shared = '+1 415 555 0100'
      const first = await upsertContact(aliceWs, {
        fullName: 'Colleague One',
        emails: [`colleague1-${RUN}@example.com`],
        phones: [shared],
      })
      const second = await upsertContact(aliceWs, {
        fullName: 'Colleague Two',
        emails: [`colleague2-${RUN}@example.com`],
        phones: [shared],
      })

      // Two people. A unique index on the number would have refused the second.
      expect(second.created).toBe(true)
      expect(second.id).not.toBe(first.id)

      const { count } = await adminClient()
        .from('crm_contact_phones')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', aliceWs)
        .eq('e164', '+14155550100')

      expect(count).toBe(2)
    })

    it('stores an ambiguous national number without an E.164', async () => {
      const contact = await upsertContact(aliceWs, {
        fullName: 'Ambiguous Phone',
        emails: [`ambiguous-${RUN}@example.com`],
        phones: ['07400 123456'], // no country supplied
      })

      const { data } = await adminClient()
        .from('crm_contact_phones')
        .select('raw, e164')
        .eq('workspace_id', aliceWs)
        .eq('contact_id', contact.id)
        .single()

      // Kept and readable by a human, but not dialable with confidence.
      expect(data?.raw).toBe('07400 123456')
      expect(data?.e164).toBeNull()
    })

    it('resolves the same number to E.164 when a country is supplied', async () => {
      const contact = await upsertContact(aliceWs, {
        fullName: 'Known Country Phone',
        emails: [`country-${RUN}@example.com`],
        phones: ['07400 123456'],
        defaultPhoneCountry: 'GB',
      })

      const { data } = await adminClient()
        .from('crm_contact_phones')
        .select('e164')
        .eq('workspace_id', aliceWs)
        .eq('contact_id', contact.id)
        .single()

      expect(data?.e164).toBe('+447400123456')
    })
  })

  // -------------------------------------------------------------------------
  // Companies
  // -------------------------------------------------------------------------

  describe('companies', () => {
    it('matches on domain, ignoring www and scheme', async () => {
      const first = await upsertCrmCompany(aliceWs, {
        name: 'Acme Ltd',
        websiteUrl: `https://www.acme-${RUN}.example.com/pricing`,
      })
      expect(first.created).toBe(true)

      const again = await upsertCrmCompany(aliceWs, {
        name: 'ACME',
        websiteUrl: `acme-${RUN}.example.com`,
      })
      expect(again.created).toBe(false)
      expect(again.matchedBy).toBe('domain')
      expect(again.id).toBe(first.id)
    })

    it('matches a name only when nothing stronger exists', async () => {
      const byName = await upsertCrmCompany(aliceWs, { name: `Nameonly ${RUN}` })
      expect(byName.created).toBe(true)

      const sameName = await upsertCrmCompany(aliceWs, { name: `Nameonly ${RUN} Inc` })
      // "Inc" is a legal suffix, stripped by normalizeCompanyName.
      expect(sameName.created).toBe(false)
      expect(sameName.matchedBy).toBe('name')

      // The same name WITH a domain is a different company, not a match: two
      // unrelated firms share a name far more often than they share a domain.
      const withDomain = await upsertCrmCompany(aliceWs, {
        name: `Nameonly ${RUN}`,
        websiteUrl: `nameonly-${RUN}.example.com`,
      })
      expect(withDomain.created).toBe(true)
      expect(withDomain.id).not.toBe(byName.id)
    })

    it('links a contact to a company and projects it onto the contact', async () => {
      const contact = await upsertContact(aliceWs, {
        fullName: 'Employed Person',
        emails: [`employed-${RUN}@example.com`],
      })
      const company = await upsertCrmCompany(aliceWs, {
        name: 'Employer',
        websiteUrl: `employer-${RUN}.example.com`,
      })

      await linkContactToCompany(aliceWs, contact.id, company.id, { title: 'Head of Ops' })

      const { data: row } = await adminClient()
        .from('crm_contacts')
        .select('primary_company_id')
        .eq('id', contact.id)
        .single()
      expect(row?.primary_company_id).toBe(company.id)

      const { data: rel } = await adminClient()
        .from('crm_contact_company_relationships')
        .select('title, is_primary, is_current')
        .eq('workspace_id', aliceWs)
        .eq('contact_id', contact.id)
        .eq('company_id', company.id)
        .single()
      expect(rel).toMatchObject({ title: 'Head of Ops', is_primary: true, is_current: true })
    })

    it('keeps employment history when someone changes job', async () => {
      const contact = await upsertContact(aliceWs, {
        fullName: 'Job Changer',
        emails: [`changer-${RUN}@example.com`],
      })
      const oldJob = await upsertCrmCompany(aliceWs, {
        name: 'Old Co',
        websiteUrl: `oldco-${RUN}.example.com`,
      })
      const newJob = await upsertCrmCompany(aliceWs, {
        name: 'New Co',
        websiteUrl: `newco-${RUN}.example.com`,
      })

      await linkContactToCompany(aliceWs, contact.id, oldJob.id)
      await linkContactToCompany(aliceWs, contact.id, newJob.id)

      const { data } = await adminClient()
        .from('crm_contact_company_relationships')
        .select('company_id, is_primary, is_current, ended_at')
        .eq('workspace_id', aliceWs)
        .eq('contact_id', contact.id)

      // BOTH rows survive: "left Old Co for New Co" is a buying signal, and
      // overwriting the row destroys it.
      expect(data).toHaveLength(2)
      const previous = data?.find((r) => r.company_id === oldJob.id)
      const current = data?.find((r) => r.company_id === newJob.id)
      expect(previous).toMatchObject({ is_primary: false, is_current: false })
      expect(previous?.ended_at).not.toBeNull()
      expect(current).toMatchObject({ is_primary: true, is_current: true })
    })
  })

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  describe('tags', () => {
    it('makes casing and spacing variants one tag', async () => {
      const a = await upsertTag(aliceWs, `Hot Lead ${RUN}`)
      const b = await upsertTag(aliceWs, `  hot   lead ${RUN} `)
      expect(b).toBe(a)
    })

    it('is idempotent when applied twice', async () => {
      const contact = await upsertContact(aliceWs, {
        fullName: 'Tagged Person',
        emails: [`tagged-${RUN}@example.com`],
      })
      const tag = await upsertTag(aliceWs, `Priority ${RUN}`)

      await tagContact(aliceWs, contact.id, tag)
      await tagContact(aliceWs, contact.id, tag)

      const { count } = await adminClient()
        .from('crm_contact_tags')
        .select('contact_id', { count: 'exact', head: true })
        .eq('contact_id', contact.id)
        .eq('tag_id', tag)

      expect(count).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // Tenancy
  // -------------------------------------------------------------------------

  describe('workspace isolation', () => {
    it('gives two workspaces two rows for the same real person', async () => {
      const inAlice = await findContactByIdentity(aliceWs, {
        linkedInIdentityKey: `li:in:${slug('dana').toLowerCase()}`,
        emails: [],
      })

      const inBob = await upsertContact(bobWs, {
        fullName: 'Dana Fabricated',
        linkedInUrl: `https://www.linkedin.com/in/${slug('dana')}`,
      })

      // Canonical PER WORKSPACE, not globally. Bob must not inherit Alice's
      // record, and the shared identity key must not collide across tenants.
      expect(inBob.created).toBe(true)
      expect(inBob.id).not.toBe(inAlice!.id)
    })

    it("does not let Alice read Bob's contacts", async () => {
      const { data, error } = await alice.client
        .from('crm_contacts')
        .select('id')
        .eq('workspace_id', bobWs)

      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it("does not let Alice read Bob's contact emails", async () => {
      const { data } = await alice.client
        .from('crm_contact_emails')
        .select('address')
        .eq('workspace_id', bobWs)

      expect(data).toEqual([])
    })

    it('lets Alice read her own contacts', async () => {
      // Positive control: without this the assertions above could pass because
      // the table is simply unreadable.
      const { data } = await alice.client
        .from('crm_contacts')
        .select('id')
        .eq('workspace_id', aliceWs)
        .limit(1)

      expect(data?.length).toBe(1)
    })

    it('does not let Alice write a contact directly', async () => {
      const { error } = await alice.client
        .from('crm_contacts')
        .insert({ workspace_id: aliceWs, full_name: 'Smuggled In' })

      // No INSERT grant for `authenticated`: writes go through the service
      // role behind the policy layer.
      expect(error).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Pure identity resolution, no database
  // -------------------------------------------------------------------------

  describe('resolveContactIdentity', () => {
    it('deduplicates addresses within one input row', () => {
      const identity = resolveContactIdentity({
        fullName: 'Someone',
        emails: ['Sam@Example.com', 'sam@example.com', ' SAM@EXAMPLE.COM '],
      })
      // Three spellings, one address — otherwise the row trips its own index.
      expect(identity.emails).toHaveLength(1)
    })

    it('deduplicates phones within one input row', () => {
      const identity = resolveContactIdentity({
        fullName: 'Someone',
        phones: ['+1 415 555 0132', '+14155550132', '(415) 555-0132'],
      })
      // The last has no country code and stays separate: it is not the same
      // known number, it is an unresolved one.
      expect(identity.phones.filter((p) => p.e164 === '+14155550132')).toHaveLength(1)
    })
  })
})
