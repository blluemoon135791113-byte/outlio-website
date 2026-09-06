import 'server-only'

/**
 * Delivering a channel notification — M8 Phase 25.
 *
 * ⚠️ NOT QUEUED, UNLIKE OUTBOUND WEBHOOKS, and that is a deliberate
 * difference. A webhook is a contract: a consumer is entitled to eventual
 * delivery, so it retries for hours. A channel notification is a NUDGE — "Dana
 * replied" arriving three hours late is worse than not arriving, because
 * someone reads it and acts on stale information. One attempt, and a failure
 * is recorded rather than retried.
 */
import { assertSafeWebhookUrl, UnsafeWebhookUrlError } from '@/lib/api/webhook-url'
import { formatNotification, type ChannelProvider, type NotificationInput } from '@/lib/notifications/format'
import { createAdminClient } from '@/lib/supabase/admin'

export type NotifyResult = {
  sent: number
  failed: number
  /** Channels that matched the event but are switched off. */
  skipped: number
}

/**
 * Sends to every channel in a workspace subscribed to this event.
 *
 * ⚠️ NEVER THROWS. A notification failing must not fail the thing that caused
 * it — nobody should be unable to win a deal because Slack is down.
 */
export async function notifyChannels(
  workspaceId: string,
  event: string,
  input: NotificationInput,
  options: {
    /**
     * Send to exactly one channel regardless of its subscriptions — used by
     * "send a test", where the point is to exercise THIS url.
     */
    onlyChannelId?: string
  } = {},
): Promise<NotifyResult> {
  const db = createAdminClient()
  const result: NotifyResult = { sent: 0, failed: 0, skipped: 0 }

  /*
   * ⚠️ SCOPED BY `workspace_id` IN CODE. The service role bypasses RLS, so an
   * id alone is not authorisation — a channel id from another workspace must
   * match nothing rather than deliver there.
   */
  let query = db
    .from('notification_channels')
    .select('id, provider, url, events, is_active')
    .eq('workspace_id', workspaceId)

  if (options.onlyChannelId) query = query.eq('id', options.onlyChannelId)

  const { data: channels } = await query

  for (const channel of channels ?? []) {
    // Empty `events` means everything. A targeted test ignores the filter.
    const wants =
      Boolean(options.onlyChannelId) ||
      channel.events.length === 0 ||
      channel.events.includes(event)
    if (!wants) continue

    if (!channel.is_active) {
      result.skipped += 1
      continue
    }

    try {
      /*
       * ⚠️ THE SAME SSRF GUARD THE WEBHOOKS USE. A channel URL is
       * customer-supplied, so it is the same class of risk — and re-checked at
       * send time rather than only when saved, since a hostname that was
       * public when it was added can later resolve elsewhere.
       */
      assertSafeWebhookUrl(channel.url)

      const response = await fetch(channel.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formatNotification(channel.provider as ChannelProvider, input)),
        // A hung endpoint must not hold up whatever triggered this.
        signal: AbortSignal.timeout(8_000),
      })

      if (!response.ok) throw new Error(`The channel returned ${response.status}.`)

      await db
        .from('notification_channels')
        .update({ last_sent_at: new Date().toISOString(), failure_count: 0, last_error: null })
        .eq('id', channel.id)

      result.sent += 1
    } catch (error) {
      result.failed += 1

      const message =
        error instanceof UnsafeWebhookUrlError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'The notification could not be sent.'

      /*
       * ⚠️ THE FAILURE IS RECORDED ON THE CHANNEL, where a person will see it.
       * A notification that silently stops arriving is indistinguishable from
       * nothing happening — which is the worst possible failure for a feature
       * whose whole job is telling you something happened.
       */
      const { data: current } = await db
        .from('notification_channels')
        .select('failure_count')
        .eq('id', channel.id)
        .maybeSingle()

      const failures = (current?.failure_count ?? 0) + 1

      await db
        .from('notification_channels')
        .update({
          failure_count: failures,
          last_error: message,
          // Twenty consecutive failures is well past "Slack had a bad
          // afternoon"; the URL has almost certainly been revoked.
          ...(failures >= 20 ? { is_active: false } : {}),
        })
        .eq('id', channel.id)
    }
  }

  return result
}
