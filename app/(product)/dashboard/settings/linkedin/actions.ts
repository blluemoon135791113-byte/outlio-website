'use server'

/**
 * Linking and reviewing a LinkedIn sender.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE OWNER IS ALWAYS `ctx.userId`. IT IS NEVER READ FROM THE FORM.    ║
 * ║                                                                           ║
 * ║  That single line is what makes account sharing unexpressible here. If     ║
 * ║  the owner came from the request, an admin could link a colleague's        ║
 * ║  profile and start releasing tasks against an account that is not theirs — ║
 * ║  which is the practice §4.10 names and LinkedIn's User Agreement           ║
 * ║  prohibits. You can only ever link an account AS YOURSELF.                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ GATED ON MEMBERSHIP AND THE MODULE, NOT ON `workspace.settings.manage`.
 * Linking your own LinkedIn account is not an administrative act — it is a
 * person saying "this is me". Requiring admin would mean either nobody but an
 * admin can link, or an admin links on somebody else's behalf, and the second
 * is the thing above.
 */
import { revalidatePath } from 'next/cache'

import { linkSender } from '@/lib/linkedin/senders'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type SenderActionState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/** Everyone who can see a contact can link their own account. */
const PERMISSION = 'crm.contact.view' as const

const PATH = '/dashboard/settings/linkedin'

export async function linkSenderAction(
  _previous: SenderActionState,
  formData: FormData,
): Promise<SenderActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
  } catch {
    return { ok: false, error: 'You do not have access to this workspace.' }
  }

  if (!ctx.modules.has('linkedin')) {
    return { ok: false, error: 'The LinkedIn channel is not enabled on your plan.' }
  }

  const profileUrl = String(formData.get('profileUrl') ?? '').trim()
  const displayLabel = String(formData.get('displayLabel') ?? '').trim()

  if (!profileUrl) return { ok: false, error: 'Paste the URL of your LinkedIn profile.' }
  if (!displayLabel) return { ok: false, error: 'Give this account a name you will recognise.' }
  if (displayLabel.length > 80) {
    return { ok: false, error: 'That name is too long — 80 characters at most.' }
  }

  const result = await linkSender({
    workspaceId: ctx.workspace.id,
    // ⚠️ Never `formData`. See the banner above.
    ownerUserId: ctx.userId,
    profileUrl,
    displayLabel,
  })

  if (!result.ok) {
    if (result.reason === 'invalid_profile_url') {
      return {
        ok: false,
        error: 'That does not look like a LinkedIn profile URL. It should look like linkedin.com/in/your-name.',
      }
    }
    /*
     * ⚠️ DELIBERATELY VAGUE, AND THE VAGUENESS IS THE POINT. The other cause is
     * that this profile is already linked by a different Outlio user. Saying so
     * would confirm that a given LinkedIn profile is on Outlio — a disclosure
     * about somebody who never signed up here.
     */
    return {
      ok: false,
      error: 'That account could not be linked. If you believe it should be, contact support.',
    }
  }

  revalidatePath(PATH)
  return {
    ok: true,
    message: result.created
      ? 'Account linked. Review it below to start releasing tasks.'
      : 'Account linked to this workspace.',
  }
}

/**
 * Records that the owner has looked at the account.
 *
 * ⚠️ IT MOVES `status`, NOT `stage`. §4.10: "Do not advance automatically on a
 * timer. A new account does not become trusted merely because several days
 * elapsed." A review makes the account usable at its CURRENT stage; climbing
 * the ladder is a separate, later decision.
 */
export async function recordOwnerReview(
  _previous: SenderActionState,
  formData: FormData,
): Promise<SenderActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
  } catch {
    return { ok: false, error: 'You do not have access to this workspace.' }
  }

  const senderId = String(formData.get('senderId') ?? '')
  if (!senderId) return { ok: false, error: 'Could not tell which account you meant.' }

  const db = createAdminClient()

  /*
   * ⚠️ SCOPED BY OWNER, NOT BY WORKSPACE. The service role bypasses RLS, and a
   * sender is not workspace-scoped at all — so the wall here is that only the
   * person whose account it is may say they have reviewed it. A manager
   * attesting to somebody else's account is exactly the attestation §4.10 says
   * has to come from the owner.
   */
  const { data, error } = await db
    .from('linkedin_senders')
    .update({
      status: 'owner_reviewed',
      last_owner_review_at: new Date().toISOString(),
      // Stage 0 → 1 on first review is the ladder's own first rung, and it is
      // the ONLY automatic stage move: §4.10 gates every later one on time at
      // the current stage plus another explicit review.
      stage: 1,
    })
    .eq('id', senderId)
    .eq('owner_user_id', ctx.userId)
    .eq('stage', 0)
    .select('id')

  if (error) return { ok: false, error: 'Could not record that review.' }
  if (!data || data.length === 0) {
    return { ok: false, error: 'That account is not yours to review, or it has already been reviewed.' }
  }

  revalidatePath(PATH)
  return { ok: true, message: 'Reviewed. Outlio will start releasing a small number of tasks.' }
}

/**
 * Records a warning or restriction from LinkedIn.
 *
 * ⚠️ ANY MEMBER MAY REPORT ONE, INCLUDING AGAINST SOMEBODY ELSE'S SENDER. This
 * is the one place the owner-only rule is deliberately relaxed: a warning stops
 * work, and a control that only the affected person can reach is a control that
 * goes unused while they are on holiday. Stopping is never the dangerous
 * direction.
 */
export async function reportSenderWarning(
  _previous: SenderActionState,
  formData: FormData,
): Promise<SenderActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
  } catch {
    return { ok: false, error: 'You do not have access to this workspace.' }
  }

  const senderId = String(formData.get('senderId') ?? '')
  if (!senderId) return { ok: false, error: 'Could not tell which account you meant.' }

  const db = createAdminClient()

  // The sender must be linked to THIS workspace, or anybody could pause anyone's.
  const { data: link } = await db
    .from('linkedin_sender_links')
    .select('sender_id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('sender_id', senderId)
    .maybeSingle()

  if (!link) return { ok: false, error: 'That account is not linked to this workspace.' }

  const { error } = await db
    .from('linkedin_senders')
    .update({ status: 'warning' })
    .eq('id', senderId)

  if (error) return { ok: false, error: 'Could not record that warning.' }

  revalidatePath(PATH)
  return {
    ok: true,
    message:
      'Recorded. No further tasks will be released for this account until somebody reads the notice from LinkedIn and resumes it.',
  }
}
