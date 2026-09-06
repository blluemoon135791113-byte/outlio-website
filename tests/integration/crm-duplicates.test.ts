/**
 * Duplicate detection and merging — M2 Phase 4.
 *
 * M2 ACCEPTANCE CRITERION 3: "Merge preserves 100% of child records and
 * historical attribution; a concurrent merge attempt on the same pair fails
 * safely."
 * M2 ACCEPTANCE CRITERION 4: "Duplicate Center shows reasons + confidence for
 * every flagged pair."
 *
 * Scoring is unit-tested; what needs a database is whether detection finds the
 * right pairs at all, whether a merge actually moves every child table, and
 * what happens when two people click Merge at the same moment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ignoreCandidate,
  listDuplicateCandidates,
  mergeContacts,
  MergeConflictError,
  resolveContactId,
  scanWorkspaceForDuplicates,
} from '@/lib/crm/duplicates'
import {
  linkContactToCompany,
  tagContact,
  upsertContact,
  upsertCrmCompany,
  upsertTag,
} from '@/lib/crm/repository'
import {
  adminClient,
  createAuthUser,
  deleteTestUser,
  hasSupabaseEnv,
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

describeIf('duplicate detection and merging', () => {
  let owner: TestAuthUser
  let ws: string
  let acmeId: string

  // The pair detection should find: one person, entered twice.
  let samA: string
  let samB: string
  // A colleague at the same company with the same switchboard — NOT a duplicate.
  let colleague: string

  beforeAll(async () => {
    owner = await createAuthUser('dupe-owner')
    ws = await workspaceOf(owner.id)

    acmeId = (
      await upsertCrmCompany(ws, {
        name: 'Acme Ltd',
        websiteUrl: `acme-${RUN}.example.com`,
      })
    ).id

    samA = (
      await upsertContact(ws, {
        fullName: 'Samuel Ellis',
        jobTitle: 'VP Sales',
        emails: [`samuel.ellis-${RUN}@acme-${RUN}.example.com`],
        phones: ['+1 415 555 0100'],
      })
    ).id

    samB = (
      await upsertContact(ws, {
        // Same person, entered by someone else with a typo and a nickname.
        fullName: 'Samual Ellis',
        emails: [`sam.e-${RUN}@acme-${RUN}.example.com`],
        phones: ['+1 415 555 0100'],
      })
    ).id

    colleague = (
      await upsertContact(ws, {
        fullName: 'Gertrude Okonkwo',
        emails: [`gertrude-${RUN}@acme-${RUN}.example.com`],
        phones: ['+1 415 555 0100'],
      })
    ).id

    for (const id of [samA, samB, colleague]) {
      await linkContactToCompany(ws, id, acmeId)
    }
  })

  afterAll(async () => {
    if (owner) await deleteTestUser(owner.id)
  })

  // -------------------------------------------------------------------------
  // Detection
  // -------------------------------------------------------------------------

  describe('scanning', () => {
    it('finds the real duplicate', async () => {
      const result = await scanWorkspaceForDuplicates(ws)

      expect(result.contactsScanned).toBe(3)
      expect(result.pairsCompared).toBeGreaterThan(0)
      expect(result.candidatesWritten).toBeGreaterThan(0)

      const open = await listDuplicateCandidates(ws, 'possible')
      const pair = open.find(
        (c) =>
          (c.recordAId === samA && c.recordBId === samB) ||
          (c.recordAId === samB && c.recordBId === samA),
      )
      expect(pair).toBeDefined()
    })

    it('does NOT flag the colleague who shares a company and a switchboard', async () => {
      // The single most important assertion in this file. Score those signals
      // additively and every pair of colleagues becomes a "duplicate".
      const open = await listDuplicateCandidates(ws, 'possible')
      const flagged = open.filter(
        (c) => c.recordAId === colleague || c.recordBId === colleague,
      )
      expect(flagged).toEqual([])
    })

    it('gives every flagged pair a confidence, a score and readable reasons', async () => {
      const open = await listDuplicateCandidates(ws, 'possible')
      expect(open.length).toBeGreaterThan(0)

      for (const candidate of open) {
        expect(['exact', 'possible']).toContain(candidate.confidence)
        expect(candidate.score).toBeGreaterThanOrEqual(60)
        expect(candidate.signals.length).toBeGreaterThan(0)
        expect(candidate.summary).toContain(`${candidate.score}%`)
        // A reason a person can read without knowing the schema.
        for (const signal of candidate.signals) {
          expect(signal.reason).not.toMatch(/_id|identity_key/)
        }
      }
    })

    it('is re-runnable without duplicating candidate rows', async () => {
      const before = await listDuplicateCandidates(ws, 'possible')
      await scanWorkspaceForDuplicates(ws)
      const after = await listDuplicateCandidates(ws, 'possible')

      expect(after.length).toBe(before.length)
    })
  })

  // -------------------------------------------------------------------------
  // Ignoring
  // -------------------------------------------------------------------------

  describe('a rejected pair stays rejected', () => {
    let ignoredA: string
    let ignoredB: string

    it('moves an ignored pair out of the open tabs', async () => {
      // Two genuinely different people who happen to look alike.
      ignoredA = (
        await upsertContact(ws, {
          fullName: 'Chris Taylor',
          emails: [`chris.taylor-${RUN}@acme-${RUN}.example.com`],
        })
      ).id
      ignoredB = (
        await upsertContact(ws, {
          fullName: 'Chris Taylor',
          emails: [`c.taylor-${RUN}@acme-${RUN}.example.com`],
        })
      ).id
      for (const id of [ignoredA, ignoredB]) await linkContactToCompany(ws, id, acmeId)

      await scanWorkspaceForDuplicates(ws)

      const open = await listDuplicateCandidates(ws, 'possible')
      const pair = open.find(
        (c) =>
          [c.recordAId, c.recordBId].includes(ignoredA) &&
          [c.recordAId, c.recordBId].includes(ignoredB),
      )
      expect(pair).toBeDefined()

      await ignoreCandidate(ws, pair!.id, owner.id)

      const stillOpen = await listDuplicateCandidates(ws, 'possible')
      expect(stillOpen.some((c) => c.id === pair!.id)).toBe(false)

      const ignored = await listDuplicateCandidates(ws, 'ignored')
      expect(ignored.some((c) => c.id === pair!.id)).toBe(true)
    })

    it('is NOT re-flagged by a later scan', async () => {
      // Without this, a rejected pair reappears on every scan and the Center
      // becomes a list of questions the user has already answered.
      await scanWorkspaceForDuplicates(ws)

      const open = await listDuplicateCandidates(ws, 'possible')
      const reflagged = open.find(
        (c) =>
          [c.recordAId, c.recordBId].includes(ignoredA) &&
          [c.recordAId, c.recordBId].includes(ignoredB),
      )
      expect(reflagged).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // Acceptance criterion 3
  // -------------------------------------------------------------------------

  describe('merging preserves everything', () => {
    let survivor: string
    let loser: string
    let tagId: string

    beforeAll(async () => {
      survivor = (
        await upsertContact(ws, {
          fullName: 'Merge Survivor',
          emails: [`survivor-${RUN}@example.com`],
          phones: ['+1 415 555 0111'],
        })
      ).id

      loser = (
        await upsertContact(ws, {
          fullName: 'Merge Loser',
          // Deliberately richer than the survivor, so the merge has real work.
          jobTitle: 'Head of Everything',
          linkedInUrl: `https://www.linkedin.com/in/merge-loser-${RUN}`,
          emails: [`loser-${RUN}@example.com`],
          phones: ['+1 415 555 0111', '+1 415 555 0222'],
        })
      ).id

      tagId = await upsertTag(ws, `Merge Tag ${RUN}`)
      await tagContact(ws, survivor, tagId)
      await tagContact(ws, loser, tagId)
      await linkContactToCompany(ws, loser, acmeId)
    })

    it('moves every child record onto the survivor', async () => {
      const result = await mergeContacts(ws, survivor, loser, owner.id)

      expect(result.survivingId).toBe(survivor)
      expect(result.mergedId).toBe(loser)

      const [emails, phones, tags, employment] = await Promise.all([
        countChildren('crm_contact_emails', survivor),
        countChildren('crm_contact_phones', survivor),
        countChildren('crm_contact_tags', survivor),
        countChildren('crm_contact_company_relationships', survivor),
      ])

      // Both addresses. Two distinct phones — the shared +0111 is one number,
      // not two. One tag, because both carried the same one.
      expect(emails).toBe(2)
      expect(phones).toBe(2)
      expect(tags).toBe(1)
      expect(employment).toBe(1)
    })

    it('leaves nothing behind on the merged contact', async () => {
      for (const table of [
        'crm_contact_emails',
        'crm_contact_phones',
        'crm_contact_tags',
        'crm_contact_company_relationships',
      ] as const) {
        expect(await countChildren(table, loser)).toBe(0)
      }
    })

    it('fills gaps on the survivor without overwriting its own values', async () => {
      const { data } = await adminClient()
        .from('crm_contacts')
        .select('full_name, job_title, linkedin_identity_key')
        .eq('id', survivor)
        .single()

      // A merge enriches; it never overwrites a value someone chose.
      expect(data?.full_name).toBe('Merge Survivor')
      // The survivor had neither of these, so it inherits them.
      expect(data?.job_title).toBe('Head of Everything')
      expect(data?.linkedin_identity_key).toBe(`li:in:merge-loser-${RUN}`)
    })

    it('retires the merged contact and points it at the survivor', async () => {
      const { data } = await adminClient()
        .from('crm_contacts')
        .select('deleted_at, merged_into_id, linkedin_identity_key')
        .eq('id', loser)
        .single()

      expect(data?.deleted_at).not.toBeNull()
      expect(data?.merged_into_id).toBe(survivor)
      // Released, or the survivor could not have claimed it above.
      expect(data?.linkedin_identity_key).toBeNull()
    })

    it('records the merge with a snapshot of what was lost', async () => {
      const { data } = await adminClient()
        .from('crm_merge_events')
        .select('surviving_id, merged_id, performed_by, snapshot')
        .eq('workspace_id', ws)
        .eq('merged_id', loser)
        .single()

      expect(data?.surviving_id).toBe(survivor)
      expect(data?.performed_by).toBe(owner.id)

      const snapshot = data?.snapshot as Record<string, unknown>
      // A merge destroys a record's separate existence; the snapshot is the
      // only way to answer afterwards what the loser looked like.
      expect(snapshot.merged_contact).toBeDefined()
      expect(snapshot.moved).toBeDefined()
    })

    it('lets a stale id follow the merge forward', async () => {
      // A bookmark, a webhook payload or an export holding the old id must not
      // become a dead end.
      expect(await resolveContactId(ws, loser)).toBe(survivor)
      expect(await resolveContactId(ws, survivor)).toBe(survivor)
    })

    it('FAILS SAFELY when the same pair is merged twice', async () => {
      // Two people can open the same pair in the Duplicate Center and both
      // click Merge. The second must be told, not half-applied.
      await expect(mergeContacts(ws, survivor, loser, owner.id)).rejects.toBeInstanceOf(
        MergeConflictError,
      )
    })

    it('refuses to merge a contact into itself', async () => {
      await expect(mergeContacts(ws, survivor, survivor, owner.id)).rejects.toThrow()
    })
  })

  async function countChildren(
    table:
      | 'crm_contact_emails'
      | 'crm_contact_phones'
      | 'crm_contact_tags'
      | 'crm_contact_company_relationships',
    contactId: string,
  ): Promise<number> {
    const { count, error } = await adminClient()
      .from(table)
      .select('contact_id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .eq('contact_id', contactId)

    if (error) throw new Error(`countChildren(${table}) failed: ${error.message}`)
    return count ?? 0
  }
})
