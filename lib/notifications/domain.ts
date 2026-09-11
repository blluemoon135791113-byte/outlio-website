import 'server-only'

/**
 * A domain event reaching the workspace's channels — Phase 23.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EIGHT EVENTS WERE OFFERED IN SETTINGS AND NONE OF THEM COULD ARRIVE.     ║
 * ║                                                                           ║
 * ║  `NOTIFIABLE_EVENTS` lets a customer tick "Someone replies", "A deal is    ║
 * ║  won", "A contact is assigned". `notifyChannels` had exactly two callers:  ║
 * ║  the settings test button, which passes `'__test__'`, and the NOTIFY flow  ║
 * ║  action, which passes whatever string a flow author typed into a step.     ║
 * ║                                                                           ║
 * ║  So no moment in the product ever sent one of the eight. Connect Slack,   ║
 * ║  tick "Someone replies", and nothing ever arrives.                        ║
 * ║                                                                           ║
 * ║  ⚠️ AND THE TEST BUTTON HID IT. "Send test" passes `onlyChannelId`, which  ║
 * ║  deliberately bypasses the event filter so the point of the test is THIS   ║
 * ║  url. It therefore always delivers. A customer tests the channel, watches  ║
 * ║  it arrive in Slack, and reasonably concludes the subscription works —    ║
 * ║  a green signal that is not about the thing it appears to be about.       ║
 * ║                                                                           ║
 * ║  This is the fourth instance of one defect: R8's seventeen flow triggers   ║
 * ║  with one firing, Phase 12's four routes past the metered door, Phase 23's ║
 * ║  twelve webhook events with none published, and now this. Every time the   ║
 * ║  code was correct and the wiring depended on somebody remembering.        ║
 * ║                                                                           ║
 * ║  So it hangs off `emitDomainEvent`, the door that already fans a domain    ║
 * ║  event out to flows and webhooks, rather than off eight new call sites.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describeEvent, NOTIFIABLE_EVENTS } from '@/lib/notifications/format'
import { notifyChannels, type NotifyResult } from '@/lib/notifications/send'
import { createAdminClient } from '@/lib/supabase/admin'

const NOTHING: NotifyResult = { sent: 0, failed: 0, skipped: 0 }

/**
 * The events a customer was actually offered.
 *
 * ⚠️ THIS FILTER EXISTS BECAUSE OF A BUG I ALMOST SHIPPED. `emitDomainEvent`
 * can produce nine event names; Settings offers eight, and only six overlap.
 * `notifyChannels` treats an EMPTY `events` array as "everything" — a
 * reasonable default for a first channel — so without this filter, every
 * existing channel with nothing ticked would suddenly receive
 * `crm.contact.created`, `crm.task.completed` and `email.message.sent`.
 *
 * A 25-lead import would have fired 25 Slack messages for an event the UI
 * never listed and therefore offers no way to turn off individually. Making a
 * dead feature live is not licence to broaden what it does.
 */
const OFFERED = new Set<string>(NOTIFIABLE_EVENTS.map((e) => e.value))

/**
 * Tells the workspace's channels that something happened.
 *
 * ⚠️ NEVER THROWS. Called from inside business operations, where a Slack
 * outage must not roll back the deal that was won. `notifyChannels` already
 * refuses to throw; the catch here covers the name lookup as well.
 *
 * ⚠️ THE NAME, NOT THE RECORD. A channel is a room that may contain people with
 * no CRM access, so the message carries the fact and a link — permissions still
 * apply at the link. Never the contact's data.
 */
export async function notifyDomainEvent(
  workspaceId: string,
  event: string,
  contactId: string | null,
): Promise<NotifyResult> {
  /*
   * Refused before any query: an event nobody was offered cannot be
   * unsubscribed from, so sending it is worse than not having the feature.
   */
  if (!OFFERED.has(event)) return NOTHING

  try {
    let contactName: string | null = null

    if (contactId) {
      /*
       * Scoped by workspace in code: the service role bypasses RLS, so a
       * contact id alone is not authorisation to read it.
       */
      const { data } = await createAdminClient()
        .from('crm_contacts')
        .select('full_name')
        .eq('workspace_id', workspaceId)
        .eq('id', contactId)
        .maybeSingle()
      contactName = data?.full_name ?? null
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.outlio.io'

    return await notifyChannels(workspaceId, event, {
      title: describeEvent(event, { contactName }),
      url: contactId ? `${baseUrl}/crm/contacts/${contactId}` : null,
      urlLabel: 'Open in Outlio',
    })
  } catch (error) {
    console.error('[notifications] domain event notify failed', {
      workspaceId,
      event,
      message: error instanceof Error ? error.message : 'unknown',
    })
    return NOTHING
  }
}
