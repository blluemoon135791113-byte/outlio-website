'use server'

/**
 * Email surface actions — M5/M6 UI.
 *
 * ⚠️ EVERY ACTION RE-CHECKS PERMISSION SERVER-SIDE. A server action is a POST
 * endpoint: hiding a button is not access control (CLAUDE.md rule 8), and
 * `assertWorkspacePermission` is what actually decides.
 *
 * ⚠️ THE MAILBOX PASSWORD NEVER COMES BACK. It goes in encrypted and is read
 * only by the SMTP adapter on the send path. No action here returns it, and
 * the form field is write-only for the same reason.
 */
import { revalidatePath } from 'next/cache'

import { createEmailAccount, disconnectEmailAccount, normalizeSendingAddress } from '@/lib/email/accounts'
import { assertLaunchable, type CampaignType } from '@/lib/email/campaign-policy'
import { bulkEnroll, summarize } from '@/lib/email/enrollment'
import { assessAccount } from '@/lib/email/readiness-runner'
import { requireProvider } from '@/lib/email/providers/registry'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type ActionState = { ok: true; message: string } | { ok: false; error: string } | null

/**
 * Connects an SMTP mailbox.
 *
 * ⚠️ THE CONNECTION IS TESTED BEFORE THE ROW IS WRITTEN. Saving first and
 * discovering later means a mailbox that looks connected and fails on its first
 * campaign — by which time the customer has queued a thousand messages against
 * it.
 */
export async function connectSmtpAccount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.account.connect')
  } catch {
    return { ok: false, error: 'You do not have permission to connect a mailbox.' }
  }

  const displayName = String(formData.get('displayName') ?? '').trim()
  const fromEmail = String(formData.get('fromEmail') ?? '').trim()
  const fromName = String(formData.get('fromName') ?? '').trim()
  const smtpHost = String(formData.get('smtpHost') ?? '').trim()
  const smtpPort = Number(formData.get('smtpPort') ?? 587)
  const imapHost = String(formData.get('imapHost') ?? '').trim()
  const imapPort = Number(formData.get('imapPort') ?? 993)
  const username = String(formData.get('username') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!displayName || !fromEmail || !smtpHost || !username || !password) {
    return { ok: false, error: 'Fill in the mailbox name, address, server, username and password.' }
  }

  const address = normalizeSendingAddress(fromEmail)
  if (!address) {
    return { ok: false, error: `"${fromEmail}" is not an address Outlio can send from.` }
  }

  const configuration = {
    smtpHost,
    smtpPort,
    ...(imapHost ? { imapHost, imapPort } : {}),
  }

  const secret = {
    smtpUsername: username,
    smtpPassword: password,
    ...(imapHost ? { imapUsername: username, imapPassword: password } : {}),
  }

  // Test BEFORE writing anything.
  const provider = requireProvider('smtp')
  const test = await provider.connect({
    configuration,
    secret,
    fromEmail: address.email,
    displayName: fromName || displayName,
  })

  if (!test.account.ok) {
    return { ok: false, error: test.account.message }
  }

  try {
    const account = await createEmailAccount({
      workspaceId: ctx.workspace.id,
      provider: 'smtp',
      scope: 'workspace',
      ownerUserId: ctx.userId,
      displayName,
      fromEmail: address.email,
      fromName: fromName || null,
      configuration,
      secret,
    })

    // Assess immediately so the customer sees SPF/DKIM/DMARC straight away
    // rather than after some invisible sweep.
    await assessAccount(ctx.workspace.id, account.id).catch(() => {
      // A failed first assessment must not undo a working connection.
    })

    revalidatePath('/email')
    return { ok: true, message: `${displayName} is connected and ramping up.` }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not save this mailbox.',
    }
  }
}

export async function disconnectAccount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('email.account.manage')
    const accountId = String(formData.get('accountId') ?? '')
    if (!accountId) return { ok: false, error: 'No mailbox selected.' }

    await disconnectEmailAccount(ctx.workspace.id, accountId)
    revalidatePath('/email')
    return { ok: true, message: 'Mailbox disconnected. Its stored password has been deleted.' }
  } catch {
    return { ok: false, error: 'Could not disconnect that mailbox.' }
  }
}

/** Re-runs readiness on demand, so a customer who just fixed DNS sees it. */
export async function recheckAccount(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('email.account.connect')
    const accountId = String(formData.get('accountId') ?? '')
    if (!accountId) return { ok: false, error: 'No mailbox selected.' }

    // `forceDns` because the point of pressing this is that DNS just changed;
    // serving the six-hour cache would make the button look broken.
    const result = await assessAccount(ctx.workspace.id, accountId, { forceDns: true })
    revalidatePath('/email')

    if (!result) return { ok: false, error: 'That mailbox no longer exists.' }
    return { ok: true, message: `Checked. Setup and sending health is ${result.score}/100.` }
  } catch {
    return { ok: false, error: 'Could not check that mailbox.' }
  }
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function createCampaign(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('email.campaign.create')

    const name = String(formData.get('name') ?? '').trim()
    const type = String(formData.get('type') ?? '') as CampaignType
    const accountId = String(formData.get('accountId') ?? '')

    if (!name) return { ok: false, error: 'Give the campaign a name.' }
    if (!accountId) return { ok: false, error: 'Choose a mailbox to send from.' }

    const { error } = await createAdminClient().from('email_campaigns').insert({
      workspace_id: ctx.workspace.id,
      name,
      type,
      account_id: accountId,
      created_by: ctx.userId,
    })

    if (error) return { ok: false, error: 'Could not create that campaign.' }

    revalidatePath('/email/campaigns')
    return { ok: true, message: `${name} created as a draft.` }
  } catch {
    return { ok: false, error: 'You do not have permission to create campaigns.' }
  }
}

/**
 * Launches a campaign.
 *
 * ⚠️ `assertLaunchable` RUNS SERVER-SIDE BEFORE ANY MESSAGE IS QUEUED. A
 * campaign that starts and then discovers it is misconfigured has already
 * mailed people.
 */
export async function launchCampaign(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.campaign.launch')
  } catch {
    return { ok: false, error: 'You do not have permission to launch campaigns.' }
  }

  const campaignId = String(formData.get('campaignId') ?? '')
  const db = createAdminClient()

  const { data: campaign } = await db
    .from('email_campaigns')
    .select('id, name, type, account_id, status')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', campaignId)
    .maybeSingle()

  if (!campaign) return { ok: false, error: 'That campaign no longer exists.' }

  const [{ count: stepCount }, { count: enrollmentCount }] = await Promise.all([
    db.from('email_sequence_steps').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId),
    db.from('email_enrollments').select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['active', 'paused']),
  ])

  try {
    assertLaunchable({
      type: campaign.type as CampaignType,
      stepCount: stepCount ?? 0,
      hasAccount: Boolean(campaign.account_id),
      // Outlio adds the RFC 8058 header itself, so this is always available.
      hasUnsubscribeSupport: true,
      enrollmentCount: enrollmentCount ?? 0,
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Cannot launch yet.' }
  }

  await db
    .from('email_campaigns')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', campaignId)

  // Everyone already enrolled becomes due now.
  await db
    .from('email_enrollments')
    .update({ next_action_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .eq('status', 'active')
    .is('next_action_at', null)

  revalidatePath('/email/campaigns')
  return { ok: true, message: `${campaign.name} is running.` }
}

export async function pauseCampaign(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('email.campaign.launch')
    const campaignId = String(formData.get('campaignId') ?? '')

    await createAdminClient()
      .from('email_campaigns')
      .update({ status: 'paused' })
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', campaignId)

    revalidatePath('/email/campaigns')
    return { ok: true, message: 'Campaign paused. Nothing further will be sent.' }
  } catch {
    return { ok: false, error: 'Could not pause that campaign.' }
  }
}

/**
 * Enrols contacts.
 *
 * ⚠️ REPORTS EVERY SKIP. `summarize` names why each contact was left out —
 * "28 enrolled" of 40 selected is a lie by omission the customer builds a
 * forecast on.
 */
export async function enrolContacts(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('email.campaign.create')

    const campaignId = String(formData.get('campaignId') ?? '')
    const contactIds = String(formData.get('contactIds') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)

    if (contactIds.length === 0) return { ok: false, error: 'Select some contacts first.' }

    const result = await bulkEnroll({
      workspaceId: ctx.workspace.id,
      campaignId,
      contactIds,
      actorUserId: ctx.userId,
      acknowledgeCollisions: formData.get('acknowledgeCollisions') === 'on',
    })

    revalidatePath('/email/campaigns')
    return { ok: true, message: summarize(result) }
  } catch {
    return { ok: false, error: 'Could not enrol those contacts.' }
  }
}
