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
import { after } from 'next/server'

import { createEmailAccount, disconnectEmailAccount, getEmailAccount, normalizeSendingAddress } from '@/lib/email/accounts'
import { formatDiagnostics, type MailboxDiagnostics } from '@/lib/email/diagnostics'
import { assertLaunchable, type CampaignType } from '@/lib/email/campaign-policy'
import { bulkEnroll, summarize } from '@/lib/email/enrollment'
import { assessAccount } from '@/lib/email/readiness-runner'
import { runTick } from '@/lib/workers/tick'
import { requireProvider } from '@/lib/email/providers/registry'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

/**
 * ⚠️ `values` ECHOES BACK WHAT WAS TYPED, AND THE PASSWORD IS NEVER IN IT.
 *
 * React 19 resets uncontrolled fields once a form action completes, so without
 * this a single wrong password wiped the From name, address, SMTP host, IMAP
 * host and username too — every field, on every failed attempt. Connecting a
 * mailbox is exactly the flow where the first attempt usually fails, and
 * retyping six fields to correct one of them is how people give up.
 *
 * The password is deliberately excluded, the same as `lib/auth/actions.ts`
 * does: echoing a credential back into the HTML puts it in the page source and
 * in any error report that captures it.
 */
export type ActionState =
  | { ok: true; message: string }
  | { ok: false; error: string; values?: Record<string, string> }
  | null

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

  // Everything except the password, so a failed attempt costs one field, not six.
  const values = {
    displayName,
    fromEmail,
    fromName,
    smtpHost,
    smtpPort: String(smtpPort),
    imapHost,
    imapPort: String(imapPort),
    username,
  }
  const reject = (error: string): ActionState => ({ ok: false, error, values })

  if (!displayName || !fromEmail || !smtpHost || !username || !password) {
    return reject('Fill in the mailbox name, address, server, username and password.')
  }

  const address = normalizeSendingAddress(fromEmail)
  if (!address) {
    return reject(`"${fromEmail}" is not an address Outlio can send from.`)
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
    return reject(test.account.message)
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

/**
 * Runs the mailbox connection diagnostic and returns a SANITIZED report.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS RUNS WHEREVER THE ENCRYPTION KEY IS. The stored credential is    ║
 * ║  decrypted inside the provider; a machine whose                           ║
 * ║  `INTEGRATION_ENCRYPTION_KEY` differs from the one that wrote the         ║
 * ║  envelope fails there and never reaches the mail server. So this proves   ║
 * ║  the provider path only when run in the deployed environment — which is   ║
 * ║  the entire reason it exists as an action rather than as a script.        ║
 * ║                                                                           ║
 * ║  ⚠️ ADMIN ONLY. `email.account.manage` is `minRole: admin`, matching       ║
 * ║  `disconnectAccount`. It decrypts a credential and can put a message on   ║
 * ║  the wire; a setter has no business doing either.                         ║
 * ║                                                                           ║
 * ║  ⚠️ THE TEST RECIPIENT IS NOT FREE-FORM, AND THAT IS A SECURITY CHOICE.   ║
 * ║  An unrestricted destination would turn a diagnostic into a way to send   ║
 * ║  arbitrary mail from a warmed domain with no campaign, no suppression     ║
 * ║  check, no ramp and no record — every control this product has, routed    ║
 * ║  around by design. It is therefore limited to the mailbox's own address   ║
 * ║  or a member of the workspace: "an address you control", enforced rather  ║
 * ║  than assumed.                                                            ║
 * ║                                                                           ║
 * ║  ⚠️ IT BYPASSES THE SCHEDULER ONLY — no send window, no ramp, no daily     ║
 * ║  counter, because an operator pressing "test" wants an answer now. It     ║
 * ║  does NOT bypass provider authentication, and it changes no account        ║
 * ║  configuration: not the window, not `send_days`, not the ramp.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function testMailboxConnection(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('email.account.manage')
    const accountId = String(formData.get('accountId') ?? '')
    if (!accountId) return { ok: false, error: 'No mailbox selected.' }

    const account = await getEmailAccount(ctx.workspace.id, accountId)
    if (!account) return { ok: false, error: 'That mailbox no longer exists.' }

    const requested = String(formData.get('sendTestTo') ?? '').trim().toLowerCase()
    let sendTestTo: string | undefined

    if (requested) {
      const db = createAdminClient()
      const { data: members } = await db
        .from('workspace_memberships')
        .select('profiles!inner(email)')
        .eq('workspace_id', ctx.workspace.id)

      const allowed = new Set<string>([account.fromEmail.toLowerCase()])
      for (const row of (members ?? []) as unknown as { profiles: { email: string | null } }[]) {
        if (row.profiles?.email) allowed.add(row.profiles.email.toLowerCase())
      }

      if (!allowed.has(requested)) {
        return {
          ok: false,
          error:
            'A test message can only be sent to this mailbox\'s own address or to a ' +
            'member of this workspace.',
        }
      }
      sendTestTo = requested
    }

    const provider = requireProvider(account.provider)
    if (typeof (provider as { runDiagnostics?: unknown }).runDiagnostics !== 'function') {
      return { ok: false, error: 'This provider does not support connection diagnostics yet.' }
    }

    const report = await (
      provider as unknown as {
        runDiagnostics: (a: typeof account, o: { sendTestTo?: string }) => Promise<MailboxDiagnostics>
      }
    ).runDiagnostics(account, { sendTestTo })

    /*
     * ⚠️ `formatDiagnostics` RETURNS ONLY CLASSIFIED CODES, CURATED MESSAGES AND
     * A SCRUBBED EXCERPT. No password, no ciphertext, no auth tag, no key —
     * see `scrubProviderDetail`, which also removes the literal secret.
     */
    return { ok: true, message: formatDiagnostics(report) }
  } catch {
    // Deliberately opaque: a thrown error here could carry provider text.
    return { ok: false, error: 'Could not run the mailbox connection test.' }
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

  const [{ count: stepCount }, { count: enrollmentCount }, { data: workspace }] =
    await Promise.all([
      db.from('email_sequence_steps').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId),
      db.from('email_enrollments').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).in('status', ['active', 'paused']),
      // Migration 0111. Read at launch rather than cached, so setting the
      // address unblocks the next launch without any other step.
      db.from('workspaces').select('sender_postal_address')
        .eq('id', ctx.workspace.id).maybeSingle(),
    ])

  try {
    assertLaunchable({
      type: campaign.type as CampaignType,
      stepCount: stepCount ?? 0,
      hasAccount: Boolean(campaign.account_id),
      /*
       * Outlio adds the RFC 8058 headers itself — which became true in Phase
       * 0.5. Before that this line was correct in intent and false in fact:
       * `OutboundMessage` had no `headers` field, so no message could carry
       * one. See lib/email/compliance.ts.
       */
      hasUnsubscribeSupport: true,
      enrollmentCount: enrollmentCount ?? 0,
      senderPostalAddress: workspace?.sender_postal_address ?? null,
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

  /*
   * ⚠️ A NUDGE, NOT THE SCHEDULE. The scheduled tick runs every five minutes,
   * and someone who clicks Launch and sees nothing happen for five minutes
   * concludes the product is broken. `after()` runs the tick once the response
   * is already on its way, so the first messages go out immediately.
   *
   * It is safe to be cut short mid-send: the send worker CLAIMS before it
   * sends and the reaper releases expired claims, which is exactly the
   * kill-and-retry case proven in `email-send-worker.test.ts` to deliver
   * once and only once. The scheduled tick picks up whatever is left.
   *
   * It must never THROW into the response path — the campaign really did
   * launch, and a failed nudge is a delayed send, not a failed launch.
   */
  after(async () => {
    try {
      await runTick()
    } catch (error) {
      console.error('[launch] post-launch tick failed', {
        message: error instanceof Error ? error.message : 'failed',
      })
    }
  })

  revalidatePath('/email/campaigns')
  return { ok: true, message: `${campaign.name} is running. The first emails go out now.` }
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

// ---------------------------------------------------------------------------
// Sending settings — R13
// ---------------------------------------------------------------------------

export type SendingSettingsState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/** ISO weekday numbers, Monday first. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

/**
 * Updates a mailbox's schedule and ramp.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY ONE OF THESE HAS BEEN ENFORCED SINCE M5 AND EDITABLE BY NOBODY.   ║
 * ║                                                                           ║
 * ║  The send window, the sending days, the daily limit, the minimum delay    ║
 * ║  and the whole ramp are read on every enqueue — a message outside the     ║
 * ║  window is refused, and the ramp caps the daily allowance. All of it sat  ║
 * ║  at its default because nothing in the product could change it.           ║
 * ║                                                                           ║
 * ║  So a customer in Karachi sent on London hours, and a warmed-up domain    ║
 * ║  stayed capped at the starting allowance forever.                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function updateSendingSettings(
  _previous: SendingSettingsState,
  formData: FormData,
): Promise<SendingSettingsState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.account.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to change sending settings.' }
  }

  const accountId = String(formData.get('accountId') ?? '')
  const start = String(formData.get('sendWindowStart') ?? '')
  const end = String(formData.get('sendWindowEnd') ?? '')

  /*
   * ⚠️ THE DATABASE ALSO CHECKS THIS, and the check here exists so the person
   * gets a sentence instead of a constraint violation. An end before a start
   * is not a narrow window — it is a window that can never open, and every
   * send would queue forever with no obvious cause.
   */
  if (start >= end) {
    return { ok: false, error: 'The window has to end after it starts.' }
  }

  const days = formData
    .getAll('sendDays')
    .map((d) => Number(d))
    .filter((d) => WEEKDAYS.includes(d))

  if (days.length === 0) {
    // Same failure as an impossible window, reached a different way.
    return { ok: false, error: 'Pick at least one day, or nothing can ever send.' }
  }

  const positiveOrNull = (name: string): number | null => {
    const raw = String(formData.get(name) ?? '').trim()
    if (raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  }

  const { error } = await createAdminClient()
    .from('email_accounts')
    .update({
      timezone: String(formData.get('timezone') ?? 'UTC'),
      send_window_start: start,
      send_window_end: end,
      send_days: days,
      // Blank means "no cap of our own", which is different from zero — zero
      // would stop the mailbox entirely.
      daily_send_limit: positiveOrNull('dailySendLimit'),
      min_delay_seconds: positiveOrNull('minDelaySeconds') ?? 60,
      ramp_enabled: formData.get('rampEnabled') === 'on',
    })
    // Scoped by workspace in code — the service role bypasses RLS.
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', accountId)

  if (error) return { ok: false, error: 'Could not save those settings.' }

  revalidatePath('/email')
  return { ok: true, message: 'Sending settings saved.' }
}

export type PostalAddressState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | { ok: null }

/**
 * The workspace's sender postal address — Phase 0.5, migration 0111.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNTIL PHASE 0.5 THERE WAS NOWHERE TO PUT ONE. The string "postal        ║
 * ║  address" appeared nowhere in this codebase — no column, no field, no    ║
 * ║  TODO — while CAN-SPAM §7704(a)(5) requires a valid physical address in  ║
 * ║  every commercial email.                                                 ║
 * ║                                                                           ║
 * ║  ⚠️ SETTING IT IS WHAT UNBLOCKS LAUNCHING A CAMPAIGN. `assertLaunchable`  ║
 * ║  refuses any campaign that would carry an unsubscribe footer while this   ║
 * ║  is empty — which is every campaign except a manual one-to-one message.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function updateSenderPostalAddress(
  _previous: PostalAddressState,
  formData: FormData,
): Promise<PostalAddressState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.account.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to change sending settings.' }
  }

  const address = String(formData.get('senderPostalAddress') ?? '').trim()

  /*
   * ⚠️ BLANK IS ALLOWED AND CLEARS IT. Refusing to clear would mean a workspace
   * that mistyped an address is stuck with a WRONG one, and a wrong postal
   * address in commercial mail is its own §7704(a)(5) violation — worse than an
   * absent one, because it looks compliant. Launching stays blocked while empty.
   */
  if (address !== '' && address.length < 10) {
    return { ok: false, error: 'That looks too short to be a postal address.' }
  }

  if (address.length > 500) {
    return { ok: false, error: 'That is longer than an address needs to be.' }
  }

  const { error } = await createAdminClient()
    .from('workspaces')
    .update({ sender_postal_address: address === '' ? null : address })
    .eq('id', ctx.workspace.id)

  if (error) {
    return {
      ok: false,
      error: 'We could not save that. If this persists, contact support.',
    }
  }

  revalidatePath('/email')
  return {
    ok: true,
    message: address === '' ? 'Address cleared.' : 'Address saved.',
  }
}
