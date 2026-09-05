/**
 * One-click unsubscribe, end to end — M6 Phase 17.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  M6 CRITERION 2: "unsubscribe link works one-click, UPDATES SUPPRESSION,  ║
 * ║  STOPS APPLICABLE CAMPAIGNS, RECORDS EVENTS."                             ║
 * ║                                                                           ║
 * ║  All three consequences are asserted, because any one of them silently    ║
 * ║  missing produces the same visible outcome — a page saying "you have been ║
 * ║  unsubscribed" — while the person keeps receiving mail.                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { createUnsubscribeToken, verifyUnsubscribeToken } from '@/lib/email/unsubscribe'
import { recordUnsubscribe } from '@/lib/email/unsubscribe-action'
import { adminClient, createAuthUser, deleteTestUser, hasSupabaseEnv } from './helpers'

const RUN = Date.now().toString(36)

let user: Awaited<ReturnType<typeof createAuthUser>> | null = null
let workspaceId = ''
let accountId = ''
let salesCampaignId = ''
let broadcastCampaignId = ''

beforeAll(async () => {
  if (!hasSupabaseEnv) return

  user = await createAuthUser(`unsub-${RUN}`)
  const db = adminClient()
  const { data: m } = await db
    .from('workspace_memberships').select('workspace_id').eq('user_id', user.id).single()
  workspaceId = m!.workspace_id

  const { data: acct } = await db
    .from('email_accounts')
    .insert({
      workspace_id: workspaceId, provider: 'smtp', scope: 'workspace',
      owner_user_id: user.id, display_name: 'Unsub mailbox',
      from_email: 'sender@acme.example', from_domain: 'acme.example',
      configuration: { smtpHost: 'localhost', smtpPort: 2525 },
    })
    .select('id').single()
  accountId = acct!.id

  const { data: campaigns } = await db
    .from('email_campaigns')
    .insert([
      { workspace_id: workspaceId, name: `Sales ${RUN}`, type: 'sales_sequence',
        status: 'running', account_id: accountId },
      { workspace_id: workspaceId, name: `News ${RUN}`, type: 'marketing_broadcast',
        status: 'running', account_id: accountId },
    ])
    .select('id, type')
  salesCampaignId = campaigns!.find((c) => c.type === 'sales_sequence')!.id
  broadcastCampaignId = campaigns!.find((c) => c.type === 'marketing_broadcast')!.id
}, 60_000)

afterAll(async () => {
  if (!user) return
  const db = adminClient()
  // The workspace cascade is the only path that may remove append-only events.
  await db.from('workspaces').delete().eq('id', workspaceId)
  await deleteTestUser(user.id)
})

/** A person enrolled in BOTH campaigns, with mail already queued. */
async function enrolledPerson(): Promise<{ email: string; salesId: string; broadcastId: string }> {
  const db = adminClient()
  const stamp = `${RUN}-${Math.random().toString(36).slice(2, 8)}`
  const email = `leaver+${stamp}@buyer.example`

  const { data: contact } = await db
    .from('crm_contacts')
    .insert({
      workspace_id: workspaceId, first_name: 'Kim', last_name: 'Alvarez',
      full_name: `Kim Alvarez ${stamp}`,
    })
    .select('id').single()

  const { data: enrollments, error } = await db
    .from('email_enrollments')
    .insert([
      { workspace_id: workspaceId, campaign_id: salesCampaignId,
        contact_id: contact!.id, to_email: email },
      { workspace_id: workspaceId, campaign_id: broadcastCampaignId,
        contact_id: contact!.id, to_email: email },
    ])
    .select('id, campaign_id')
  if (error) throw new Error(`enroll failed: ${error.message}`)

  const salesId = enrollments!.find((e) => e.campaign_id === salesCampaignId)!.id
  const broadcastId = enrollments!.find((e) => e.campaign_id === broadcastCampaignId)!.id

  await db.from('email_messages').insert({
    workspace_id: workspaceId, account_id: accountId, enrollment_id: salesId,
    to_email: email, subject: 'Follow-up', body_text: 'b',
    idempotency_key: `unsub-queued-${stamp}`, status: 'queued',
    scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
  })

  return { email, salesId, broadcastId }
}

const describeIf = hasSupabaseEnv ? describe : describe.skip

describeIf('CRITERION 2 — one click does all three things', () => {
  it('suppresses, stops campaigns, cancels queued mail, and records an event', async () => {
    const { email, salesId, broadcastId } = await enrolledPerson()
    const db = adminClient()

    const token = createUnsubscribeToken({
      workspaceId, email, campaignId: salesCampaignId,
    })
    const verified = verifyUnsubscribeToken(token)
    expect(verified.valid).toBe(true)
    if (!verified.valid) return

    await recordUnsubscribe(verified.subject)

    // 1. SUPPRESSION — stops future campaigns, including ones not yet created.
    const { data: suppression } = await db
      .from('email_suppressions')
      .select('reason').eq('workspace_id', workspaceId).eq('email', email).maybeSingle()
    expect(suppression?.reason).toBe('unsubscribed')

    /*
     * 2. CAMPAIGNS STOPPED — and note BOTH, not just the one named in the
     * token. Someone clicking unsubscribe in a cold email is not saying "just
     * this campaign, keep the others coming". Honouring it narrowly would be
     * technically defensible and would obviously infuriate them.
     */
    const { data: enrollments } = await db
      .from('email_enrollments')
      .select('id, status, stop_reason').in('id', [salesId, broadcastId])

    expect(enrollments!.every((e) => e.status === 'stopped')).toBe(true)
    expect(enrollments!.every((e) => e.stop_reason === 'unsubscribed')).toBe(true)

    // Queued mail is cancelled, or they receive one more after opting out.
    const { data: queued } = await db
      .from('email_messages').select('status').eq('enrollment_id', salesId).single()
    expect(queued!.status).toBe('cancelled')

    // 3. EVENT — the audit trail, and the answer to "prove they opted out".
    const { data: events } = await db
      .from('email_events')
      .select('type, campaign_id, metadata')
      .eq('workspace_id', workspaceId).eq('email', email).eq('type', 'unsubscribed')

    expect(events!.length).toBe(1)
    // The campaign is still attributed, so reporting knows which one lost them.
    expect(events![0]!.campaign_id).toBe(salesCampaignId)
    expect((events![0]!.metadata as { source?: string }).source).toBe('one_click')
  }, 60_000)

  it('is idempotent — pressing the button twice is not an error', async () => {
    /*
     * A mail client may retry the POST, and a recipient may click twice. An
     * error page shown to someone opting out sends them to "report spam"
     * instead, which is far more damaging than the duplicate.
     */
    const { email } = await enrolledPerson()
    const subject = { workspaceId, email, campaignId: null }

    await recordUnsubscribe(subject)
    await expect(recordUnsubscribe(subject)).resolves.toBeUndefined()

    const db = adminClient()
    const { data: suppressions } = await db
      .from('email_suppressions').select('id').eq('workspace_id', workspaceId).eq('email', email)
    expect(suppressions!.length).toBe(1)
  }, 60_000)

  it('keeps the ORIGINAL reason when a bounce arrives after an unsubscribe', async () => {
    // A stated wish outranks a delivery accident. Overwriting would lose the
    // consent provenance a customer may have to produce.
    const { email } = await enrolledPerson()
    const db = adminClient()

    await recordUnsubscribe({ workspaceId, email, campaignId: null })
    const { suppressEmail } = await import('@/lib/email/send')
    await suppressEmail({ workspaceId, email, reason: 'hard_bounce' })

    const { data } = await db
      .from('email_suppressions')
      .select('reason').eq('workspace_id', workspaceId).eq('email', email).single()
    expect(data!.reason).toBe('unsubscribed')
  }, 60_000)

  it('refuses to act on a forged token', async () => {
    const { email, salesId } = await enrolledPerson()

    const forged = Buffer.from(
      `u1:${workspaceId}:${email}:${salesCampaignId}`, 'utf8',
    ).toString('base64url')
    const result = verifyUnsubscribeToken(`${forged}.not-a-real-signature`)

    expect(result.valid).toBe(false)

    // Nothing happened: the enrollment is untouched.
    const { data } = await adminClient()
      .from('email_enrollments').select('status').eq('id', salesId).single()
    expect(data!.status).toBe('active')
  }, 60_000)

  it('suppresses an address that is in no campaign at all', async () => {
    /*
     * A forwarded email means the person unsubscribing may never have been
     * enrolled. Their wish still counts — and suppression is what stops any
     * FUTURE campaign reaching them.
     */
    const email = `stranger+${RUN}@buyer.example`
    await recordUnsubscribe({ workspaceId, email, campaignId: null })

    const { data } = await adminClient()
      .from('email_suppressions')
      .select('reason').eq('workspace_id', workspaceId).eq('email', email).maybeSingle()
    expect(data?.reason).toBe('unsubscribed')
  }, 60_000)
})
