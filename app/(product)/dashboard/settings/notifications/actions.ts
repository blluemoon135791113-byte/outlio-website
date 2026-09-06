'use server'

/**
 * Slack and Teams channels — M8 Phase 25.
 *
 * ⚠️ THE URL IS A CREDENTIAL. A Slack incoming-webhook URL is unauthenticated:
 * anyone holding it can post into that channel as the app. So it is write-only
 * from the browser's point of view — accepted here, never sent back.
 */
import { revalidatePath } from 'next/cache'

import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from '@/lib/api/webhook-url'
import { NOTIFIABLE_EVENTS, type ChannelProvider } from '@/lib/notifications/format'
import { notifyChannels } from '@/lib/notifications/send'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type ChannelActionState = { ok: true; message: string } | { ok: false; error: string } | null

const PERMISSION = 'workspace.settings.manage' as const
const PATH = '/dashboard/settings/notifications'

/**
 * ⚠️ EACH PROVIDER'S URL IS CHECKED AGAINST ITS OWN HOST. Pasting a Slack URL
 * into the Teams field is the single most likely setup mistake, and it fails at
 * send time with a bare 400 that tells the customer nothing.
 */
function assertProviderUrl(provider: ChannelProvider, url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'That is not a valid URL.'
  }

  if (provider === 'slack' && !host.endsWith('slack.com')) {
    return 'A Slack webhook URL starts with https://hooks.slack.com/services/.'
  }

  if (provider === 'teams') {
    // Power Automate Workflows URLs are on Azure Logic Apps hosts; the retired
    // connector route used office.com. Both are Microsoft, neither is Slack.
    const microsoft = ['azure.com', 'microsoft.com', 'office.com', 'logic.azure.com']
    if (!microsoft.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return 'A Teams URL comes from Workflows and is on a Microsoft domain.'
    }
  }

  return null
}

export async function createChannel(
  _previous: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
  } catch {
    return { ok: false, error: 'You do not have permission to add notification channels.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const url = String(formData.get('url') ?? '').trim()
  const provider = String(formData.get('provider') ?? '') as ChannelProvider

  if (provider !== 'slack' && provider !== 'teams') {
    return { ok: false, error: 'Choose Slack or Microsoft Teams.' }
  }
  if (!name || !url) return { ok: false, error: 'A name and a URL are both needed.' }

  const mismatch = assertProviderUrl(provider, url)
  if (mismatch) return { ok: false, error: mismatch }

  // The same SSRF guard the outbound webhooks use.
  try {
    assertSafeWebhookUrl(url)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof UnsafeWebhookUrlError ? error.message : 'That URL cannot be used.',
    }
  }

  const events = formData
    .getAll('events')
    .map(String)
    .filter((event) => NOTIFIABLE_EVENTS.some((e) => e.value === event))

  const { error } = await createAdminClient().from('notification_channels').insert({
    workspace_id: ctx.workspace.id,
    name,
    provider,
    url,
    events,
    created_by: ctx.userId,
  })

  if (error) return { ok: false, error: 'Could not save that channel.' }

  revalidatePath(PATH)
  return { ok: true, message: `${name} added.` }
}

/**
 * Sends a real notification to the channel.
 *
 * ⚠️ WORTH THE EXTRA ACTION. Everything that can go wrong with a channel — a
 * revoked URL, the wrong provider, a webhook pointed at an archived channel —
 * is invisible until a real event fires, which might be days later and is
 * exactly when someone is relying on it.
 */
export async function testChannel(
  _previous: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
  } catch {
    return { ok: false, error: 'You do not have permission to test channels.' }
  }

  const id = String(formData.get('channelId') ?? '')
  const db = createAdminClient()

  // Scoped by workspace in code — the service role bypasses RLS.
  const { data: channel } = await db
    .from('notification_channels')
    .select('id, name, is_active')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', id)
    .maybeSingle()

  if (!channel) return { ok: false, error: 'That channel no longer exists.' }
  if (!channel.is_active) {
    // Sending from a paused channel would be the more surprising behaviour.
    return { ok: false, error: 'That channel is paused. Enable it first.' }
  }

  const result = await notifyChannels(ctx.workspace.id, '__test__', {
    title: 'Outlio test notification',
    fields: [{ label: 'Channel', value: channel.name }],
    url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.outlio.io',
    urlLabel: 'Open Outlio',
  }, { onlyChannelId: channel.id })

  revalidatePath(PATH)

  if (result.sent === 1) return { ok: true, message: 'Sent. Check the channel.' }

  // The stored error is more useful than "it failed", so point at it.
  return { ok: false, error: 'That did not send. The reason is shown on the channel below.' }
}

export async function setChannelActive(
  _previous: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const ctx = await assertWorkspacePermission(PERMISSION)
    const active = formData.get('active') === 'true'

    await createAdminClient()
      .from('notification_channels')
      .update({
        is_active: active,
        // Re-enabling clears the count, or a channel disabled for repeated
        // failures would be disabled again on its next single failure.
        ...(active ? { failure_count: 0, last_error: null } : {}),
      })
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', String(formData.get('channelId') ?? ''))

    revalidatePath(PATH)
    return { ok: true, message: active ? 'Channel enabled.' : 'Channel paused.' }
  } catch {
    return { ok: false, error: 'Could not change that channel.' }
  }
}

export async function deleteChannel(
  _previous: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  try {
    const ctx = await assertWorkspacePermission(PERMISSION)

    await createAdminClient()
      .from('notification_channels')
      .delete()
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', String(formData.get('channelId') ?? ''))

    revalidatePath(PATH)
    return { ok: true, message: 'Channel removed.' }
  } catch {
    return { ok: false, error: 'Could not remove that channel.' }
  }
}
