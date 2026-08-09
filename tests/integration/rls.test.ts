/**
 * RLS and privilege-escalation tests — Phase 3 acceptance criteria.
 *
 * Spec §7.4:
 *   - a test proves user A cannot read user B's rows in any table via anon
 *   - a test proves a non-admin cannot escalate their own profiles.role
 *
 * These run against the real Supabase project and are skipped when the
 * environment is not configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUser,
  hasSupabaseEnv,
  seedJob,
  seedLead,
  type TestUser,
} from './helpers'

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('RLS — cross-user isolation', () => {
  let alice: TestUser
  let bob: TestUser
  let aliceJobId: string
  let aliceLeadId: string

  beforeAll(async () => {
    alice = await createTestUser('alice')
    bob = await createTestUser('bob')
    aliceJobId = await seedJob(alice.id)
    aliceLeadId = await seedLead(alice.id, aliceJobId, 'Alice Fabricated')
  })

  afterAll(async () => {
    if (alice) await deleteTestUser(alice.id)
    if (bob) await deleteTestUser(bob.id)
  })

  it('lets Alice read her own lead', async () => {
    const { data, error } = await alice.client
      .from('extracted_leads')
      .select('id, full_name')
      .eq('id', aliceLeadId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.full_name).toBe('Alice Fabricated')
  })

  it("does NOT let Bob read Alice's lead", async () => {
    const { data, error } = await bob.client
      .from('extracted_leads')
      .select('id')
      .eq('id', aliceLeadId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("does NOT let Bob read Alice's extraction job", async () => {
    const { data } = await bob.client
      .from('extraction_jobs')
      .select('id')
      .eq('id', aliceJobId)

    expect(data).toEqual([])
  })

  it("does NOT let Bob read Alice's profile", async () => {
    const { data } = await bob.client
      .from('profiles')
      .select('id, email')
      .eq('id', alice.id)

    expect(data).toEqual([])
  })

  it("does NOT let Bob delete Alice's lead", async () => {
    await bob.client.from('extracted_leads').delete().eq('id', aliceLeadId)

    // Verify with the service role that the row still exists.
    const { data } = await adminClient()
      .from('extracted_leads')
      .select('id')
      .eq('id', aliceLeadId)

    expect(data).toHaveLength(1)
  })

  it("does NOT let Bob insert a lead owned by Alice", async () => {
    const { error } = await bob.client.from('extracted_leads').insert({
      user_id: alice.id,
      extraction_job_id: aliceJobId,
      full_name: 'Injected By Bob',
      dedupe_key: 'li:lead:injected',
      dedupe_strategy: 'linkedin_url_canonical',
    })

    expect(error).not.toBeNull()
  })

  it('denies an unauthenticated client entirely', async () => {
    const { data } = await anonClient()
      .from('extracted_leads')
      .select('id')
      .eq('id', aliceLeadId)

    expect(data ?? []).toEqual([])
  })

  it('denies all access to job_queue (RLS enabled, no policies)', async () => {
    const { data } = await alice.client.from('job_queue').select('id')
    expect(data ?? []).toEqual([])
  })
})

describeIf('Privilege escalation', () => {
  let mallory: TestUser

  beforeAll(async () => {
    mallory = await createTestUser('mallory')
  })

  afterAll(async () => {
    if (mallory) await deleteTestUser(mallory.id)
  })

  it('starts as registered_user', async () => {
    const { data } = await adminClient()
      .from('profiles')
      .select('role')
      .eq('id', mallory.id)
      .single()

    expect(data?.role).toBe('registered_user')
  })

  it('does NOT let a user promote themselves to admin', async () => {
    await mallory.client
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', mallory.id)

    const { data } = await adminClient()
      .from('profiles')
      .select('role')
      .eq('id', mallory.id)
      .single()

    expect(data?.role).toBe('registered_user')
  })

  it('does NOT let a user grant themselves access_expires_at', async () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString()

    await mallory.client
      .from('profiles')
      .update({ access_expires_at: farFuture })
      .eq('id', mallory.id)

    const { data } = await adminClient()
      .from('profiles')
      .select('access_expires_at')
      .eq('id', mallory.id)
      .single()

    expect(data?.access_expires_at).toBeNull()
  })

  it('DOES let a user update their own full_name', async () => {
    const { error } = await mallory.client
      .from('profiles')
      .update({ full_name: 'Mallory Fabricated' })
      .eq('id', mallory.id)

    expect(error).toBeNull()

    const { data } = await adminClient()
      .from('profiles')
      .select('full_name')
      .eq('id', mallory.id)
      .single()

    expect(data?.full_name).toBe('Mallory Fabricated')
  })

  it('does NOT let a user modify another user\'s role', async () => {
    const victim = await createTestUser('victim')
    try {
      await mallory.client
        .from('profiles')
        .update({ role: 'suspended_user' })
        .eq('id', victim.id)

      const { data } = await adminClient()
        .from('profiles')
        .select('role')
        .eq('id', victim.id)
        .single()

      expect(data?.role).toBe('registered_user')
    } finally {
      await deleteTestUser(victim.id)
    }
  })
})

describeIf('Audit logs are append-only', () => {
  it('rejects UPDATE and DELETE even with the service role', async () => {
    const admin = adminClient()

    const { data: inserted, error: insertError } = await admin
      .from('admin_audit_logs')
      .insert({ action: 'test.append_only_check' })
      .select('id')
      .single()

    expect(insertError).toBeNull()
    expect(inserted?.id).toBeTruthy()

    const { error: updateError } = await admin
      .from('admin_audit_logs')
      .update({ action: 'tampered' })
      .eq('id', inserted!.id)
    expect(updateError).not.toBeNull()

    const { error: deleteError } = await admin
      .from('admin_audit_logs')
      .delete()
      .eq('id', inserted!.id)
    expect(deleteError).not.toBeNull()
  })
})
