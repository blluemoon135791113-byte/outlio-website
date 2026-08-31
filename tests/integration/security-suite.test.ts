/**
 * The pen-style security suite — M9 Phase 28.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M9 CRITERION 1: "pen-style suite passes: NO CROSS-TENANT ACCESS, NO      ║
 * ║  SECRET EXPOSURE, NO UNSIGNED WEBHOOK ACCEPTED."                          ║
 * ║                                                                           ║
 * ║  This asks a different question from the policy matrix in                 ║
 * ║  `tests/unit/workspace-permissions.test.ts`. That one asks "what does the ║
 * ║  policy SAY?". This asks "what does the database actually DO when someone ║
 * ║  who is signed in asks for data that is not theirs?" -- with a real JWT,  ║
 * ║  against the real RLS policies, table by table.                           ║
 * ║                                                                           ║
 * ║  ⚠️ IT USES THE ANON CLIENT, NOT THE SERVICE ROLE. A test written with    ║
 * ║  the service role would pass no matter how broken RLS is, because the     ║
 * ║  service role bypasses it entirely. That mistake makes a security suite   ║
 * ║  worse than none: it certifies an isolation that was never checked.       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { encryptIntegrationSecret } from '@/lib/integrations/crypto'
import { generateApiKey } from '@/lib/api/signing'
import {
  signCalendlyPayload,
  verifyCalendlySignature,
} from '@/lib/integrations/calendly/signature'
import {
  adminClient,
  createTestUser,
  deleteTestUser,
  hasSupabaseEnv,
  type TestUser,
} from './helpers'

const RUN = Date.now().toString(36)

let alice: TestUser | null = null
let bob: TestUser | null = null
let aliceWorkspace = ''
let bobWorkspace = ''
let aliceContact = ''
let aliceAccount = ''

const describeIf = hasSupabaseEnv ? describe : describe.skip

beforeAll(async () => {
  if (!hasSupabaseEnv) return

  /*
   * ⚠️ EXACTLY TWO SIGNED-IN USERS. Supabase rate-limits the token endpoint
   * per IP, and a suite that creates a fresh signed-in user per test blocks
   * itself part-way through and reports security failures that are really
   * rate-limit failures (Ledger KI7, which does exactly this).
   */
  alice = await createTestUser(`sec-alice-${RUN}`)
  bob = await createTestUser(`sec-bob-${RUN}`)

  const db = adminClient()
  const ws = async (userId: string) => {
    const { data } = await db
      .from('workspace_memberships').select('workspace_id').eq('user_id', userId).single()
    return data!.workspace_id as string
  }
  aliceWorkspace = await ws(alice.id)
  bobWorkspace = await ws(bob.id)

  // Alice's workspace gets one row in each sensitive table. Bob must reach none.
  const { data: contact } = await db
    .from('crm_contacts')
    .insert({ workspace_id: aliceWorkspace, full_name: `Alice Contact ${RUN}` })
    .select('id').single()
  aliceContact = contact!.id

  const { data: account } = await db
    .from('email_accounts')
    .insert({
      workspace_id: aliceWorkspace, provider: 'smtp', scope: 'workspace',
      owner_user_id: alice.id, display_name: 'Alice mailbox',
      from_email: 'alice@acme.example', from_domain: 'acme.example',
      status: 'ramping', configuration: { smtpHost: 'localhost', smtpPort: 2525 },
    })
    .select('id, secret_reference').single()
  aliceAccount = account!.id

  await db.from('email_account_secrets').insert({
    id: account!.secret_reference,
    account_id: account!.id,
    encrypted_payload: encryptIntegrationSecret({
      smtpUsername: 'alice',
      smtpPassword: 'THE-PLAINTEXT-NOBODY-MAY-READ',
    }),
  })

  const key = generateApiKey()
  await db.from('api_keys').insert({
    workspace_id: aliceWorkspace, name: `Alice key ${RUN}`,
    key_hash: key.hash, key_prefix: key.prefix,
    scopes: ['contacts:read'] as never, created_by: alice.id,
  })

  await db.from('webhook_subscriptions').insert({
    workspace_id: aliceWorkspace, name: `Alice hook ${RUN}`,
    url: 'https://example.com/hook',
    signing_secret: 'whsec_THE-SECRET-NOBODY-MAY-READ',
    events: [], created_by: alice.id,
  })

  await db.from('notification_channels').insert({
    workspace_id: aliceWorkspace, name: `Alice slack ${RUN}`, provider: 'slack',
    url: 'https://hooks.slack.com/services/THE-URL-NOBODY-MAY-READ',
    events: [], created_by: alice.id,
  })

  await db.rpc('email_record_inbound', {
    p_workspace_id: aliceWorkspace,
    p_account_id: aliceAccount,
    p_provider_thread_key: `sec-thread-${RUN}`,
    p_provider_message_id: `sec-msg-${RUN}`,
    p_from_email: 'prospect@buyer.example',
    p_subject: 'Alice private reply',
    p_body_text: 'Confidential contents.',
  })
}, 120_000)

afterAll(async () => {
  if (!hasSupabaseEnv) return
  const db = adminClient()
  if (aliceWorkspace) await db.from('workspaces').delete().eq('id', aliceWorkspace)
  if (bobWorkspace) await db.from('workspaces').delete().eq('id', bobWorkspace)
  if (alice) await deleteTestUser(alice.id)
  if (bob) await deleteTestUser(bob.id)
})

// ---------------------------------------------------------------------------
// No cross-tenant access
// ---------------------------------------------------------------------------

/*
 * ⚠️ THE CONTROL THAT KEEPS THE REST HONEST. Every assertion below is "Bob
 * sees nothing" — which passes just as well if Bob is not signed in at all, or
 * if the client is misconfigured, or if RLS denies everyone everything. A
 * suite that can pass while proving nothing is worse than no suite, because it
 * certifies an isolation nobody checked. These two tests establish that the
 * clients WORK before the negative tests claim anything.
 */
describeIf('the test clients are genuinely authenticated', () => {
  it('lets Bob read his OWN workspace', async () => {
    const { data, error } = await bob!.client
      .from('workspace_memberships').select('workspace_id').eq('user_id', bob!.id)

    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    expect(data![0]!.workspace_id).toBe(bobWorkspace)
  }, 30_000)

  it('lets Alice read her OWN contact — the same row Bob cannot', async () => {
    const { data, error } = await alice!.client
      .from('crm_contacts').select('id, full_name').eq('id', aliceContact)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]!.full_name).toBe(`Alice Contact ${RUN}`)
  }, 30_000)
})

describeIf('NO CROSS-TENANT ACCESS', () => {
  /**
   * Every table a signed-in member can select from. Bob is signed in and
   * legitimate — he simply asks for Alice's workspace.
   */
  const TENANT_TABLES = [
    'crm_contacts',
    'crm_companies',
    'crm_opportunities',
    'crm_activities',
    'crm_tasks',
    'crm_notes',
    'email_accounts',
    'email_messages',
    'email_campaigns',
    'email_enrollments',
    'email_events',
    'email_suppressions',
    'email_threads',
    'email_inbound_messages',
    'flows',
    'flow_runs',
    'meeting_bookings',
    'workspace_memberships',
  ] as const

  for (const table of TENANT_TABLES) {
    it(`returns nothing from ${table} for a member of another workspace`, async () => {
      const { data, error } = await bob!.client
        .from(table)
        .select('*')
        .eq('workspace_id', aliceWorkspace)

      /*
       * ⚠️ ZERO ROWS, NOT AN ERROR, IS THE CORRECT ANSWER. RLS filters rather
       * than refuses, so a leak looks like data rather than a 403 — which is
       * exactly why it has to be asserted per table rather than assumed from
       * one spot check.
       */
      expect(error).toBeNull()
      expect(data).toEqual([])
    }, 30_000)
  }

  it('cannot read a specific row of Alice’s by id', async () => {
    const { data } = await bob!.client
      .from('crm_contacts').select('*').eq('id', aliceContact)
    expect(data).toEqual([])
  }, 30_000)

  it('cannot WRITE into another workspace', async () => {
    // Reads are the famous half. A tenant who can INSERT into someone else's
    // workspace can plant data that a real user will act on.
    const { error } = await bob!.client
      .from('crm_contacts')
      .insert({ workspace_id: aliceWorkspace, full_name: 'Injected by Bob' })

    expect(error).not.toBeNull()

    const { count } = await adminClient()
      .from('crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', aliceWorkspace)
      .eq('full_name', 'Injected by Bob')
    expect(count).toBe(0)
  }, 30_000)

  it('cannot UPDATE or DELETE another workspace’s row', async () => {
    await bob!.client
      .from('crm_contacts').update({ full_name: 'Renamed by Bob' }).eq('id', aliceContact)
    await bob!.client.from('crm_contacts').delete().eq('id', aliceContact)

    const { data } = await adminClient()
      .from('crm_contacts').select('full_name, deleted_at').eq('id', aliceContact).single()

    expect(data!.full_name).toBe(`Alice Contact ${RUN}`)
    expect(data!.deleted_at).toBeNull()
  }, 30_000)

  it('cannot add itself to another workspace', async () => {
    /*
     * The privilege-escalation route that makes every other check moot: if Bob
     * can insert his own membership row into Alice's workspace, every table
     * above starts returning her data legitimately.
     */
    const { error } = await bob!.client
      .from('workspace_memberships')
      .insert({ workspace_id: aliceWorkspace, user_id: bob!.id, role: 'owner' })

    expect(error).not.toBeNull()

    const { count } = await adminClient()
      .from('workspace_memberships')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', aliceWorkspace)
      .eq('user_id', bob!.id)
    expect(count).toBe(0)
  }, 30_000)
})

// ---------------------------------------------------------------------------
// No secret exposure
// ---------------------------------------------------------------------------

describeIf('NO SECRET EXPOSURE', () => {
  /**
   * ⚠️ TESTED AS ALICE, THE LEGITIMATE OWNER — not as Bob. That a stranger
   * cannot read a secret is the easy half. The claim these tables make is
   * stronger: NOBODY reads them over the API, including the person they belong
   * to, because the only thing that ever needs the value is a server-side
   * worker holding the service role.
   */
  const SECRET_TABLES = [
    'email_account_secrets',
    'api_keys',
    'webhook_subscriptions',
    'notification_channels',
  ] as const

  it('is not passing merely because Alice can read nothing', async () => {
    /*
     * The same control, for the secret tables. "Alice reads no secrets" would
     * pass if Alice could read nothing at all — so prove she CAN read her own
     * mailbox row, which sits right beside the secret and is meant to be
     * visible.
     */
    const { data, error } = await alice!.client
      .from('email_accounts').select('id, display_name').eq('id', aliceAccount)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]!.display_name).toBe('Alice mailbox')
  }, 30_000)

  for (const table of SECRET_TABLES) {
    it(`does not expose ${table} to its own workspace owner`, async () => {
      const { data, error } = await alice!.client.from(table).select('*')

      // Either refused outright, or filtered to nothing. Never a value.
      const rows = data ?? []
      expect(rows).toEqual([])
      if (error) expect(error.message).toBeTruthy()
    }, 30_000)
  }

  it('never returns an SMTP password, by any route', async () => {
    const { data } = await alice!.client.from('email_account_secrets').select('*')
    expect(JSON.stringify(data ?? [])).not.toContain('THE-PLAINTEXT-NOBODY-MAY-READ')

    // ...and the account row itself must not carry it either.
    const { data: account } = await alice!.client
      .from('email_accounts').select('*').eq('id', aliceAccount)
    expect(JSON.stringify(account ?? [])).not.toContain('THE-PLAINTEXT-NOBODY-MAY-READ')
    expect(JSON.stringify(account ?? [])).not.toContain('smtpPassword')
  }, 30_000)

  it('never returns a webhook signing secret or a Slack URL', async () => {
    const hooks = await alice!.client.from('webhook_subscriptions').select('*')
    expect(JSON.stringify(hooks.data ?? [])).not.toContain('THE-SECRET-NOBODY-MAY-READ')

    /*
     * A Slack incoming-webhook URL is unauthenticated: whoever holds it can
     * post into that channel as the app. It is a credential, not a setting.
     */
    const channels = await alice!.client.from('notification_channels').select('*')
    expect(JSON.stringify(channels.data ?? [])).not.toContain('THE-URL-NOBODY-MAY-READ')
  }, 30_000)

  it('never returns an API key hash', async () => {
    // The hash exists so that a database dump is not a set of working
    // credentials. Handing it out over the API defeats the point of hashing.
    const { data } = await alice!.client.from('api_keys').select('*')
    expect(data ?? []).toEqual([])
  }, 30_000)
})

// ---------------------------------------------------------------------------
// No unsigned webhook accepted
// ---------------------------------------------------------------------------

describeIf('NO UNSIGNED WEBHOOK ACCEPTED', () => {
  const SECRET = 'calendly-signing-secret'
  const body = JSON.stringify({ event: 'invitee.created', payload: {} })

  it('accepts a correctly signed payload', () => {
    // Signed with the product's own signer, so the test cannot pass by
    // agreeing with a reimplementation that is wrong in the same way.
    const header = signCalendlyPayload(body, SECRET)
    expect(verifyCalendlySignature(body, header, SECRET).valid).toBe(true)
  })

  it('REFUSES a payload with no signature header at all', () => {
    expect(verifyCalendlySignature(body, null, SECRET).valid).toBe(false)
    expect(verifyCalendlySignature(body, '', SECRET).valid).toBe(false)
  })

  it('REFUSES a signature computed with the wrong secret', () => {
    const forged = signCalendlyPayload(body, 'attacker-guess')
    expect(verifyCalendlySignature(body, forged, SECRET).valid).toBe(false)
  })

  it('REFUSES a valid signature over a DIFFERENT body', () => {
    /*
     * ⚠️ THE ATTACK THAT MATTERS. Replaying a genuine signature against a
     * tampered body is how "we check the signature" becomes meaningless. The
     * MAC covers the raw bytes, so any edit breaks it.
     */
    const genuine = signCalendlyPayload(body, SECRET)
    const tampered = JSON.stringify({ event: 'invitee.created', payload: { injected: true } })
    expect(verifyCalendlySignature(tampered, genuine, SECRET).valid).toBe(false)
  })

  it('REFUSES a stale signature, however valid', () => {
    // Without a timestamp window a signature captured once is valid forever.
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const header = signCalendlyPayload(body, SECRET, anHourAgo)
    const result = verifyCalendlySignature(body, header, SECRET)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('stale')
  })

  it('REFUSES when no signing key is configured, rather than waving it through', () => {
    /*
     * ⚠️ A MISSING ENVIRONMENT VARIABLE MUST NOT TURN CHECKING OFF. That is
     * how an endpoint silently becomes open in the one environment where the
     * variable was forgotten.
     */
    const header = signCalendlyPayload(body, SECRET)
    const result = verifyCalendlySignature(body, header, undefined)
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('not_configured')
  })

  it('REFUSES a malformed header rather than throwing', () => {
    // A parser that throws on junk is a denial-of-service, not a rejection.
    for (const junk of ['garbage', 't=,v1=', 'v1=abc', 't=abc,v1=def', '{}', 't=1']) {
      expect(() => verifyCalendlySignature(body, junk, SECRET)).not.toThrow()
      expect(verifyCalendlySignature(body, junk, SECRET).valid).toBe(false)
    }
  })
})
