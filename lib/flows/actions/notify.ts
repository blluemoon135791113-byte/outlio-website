import 'server-only'

/**
 * The `NOTIFY` flow action — M8 Phase 25, criterion 9.
 *
 * ⚠️ `NOTIFY` WAS DECLARED IN THE ACTION CATALOGUE FROM PHASE 20 AND HAD NO
 * HANDLER, so a flow using it failed with ACTION_NOT_AVAILABLE. That was the
 * honest state — better than a placeholder that silently succeeded — and this
 * is what fills it.
 */
import { describeEvent } from '@/lib/notifications/format'
import { notifyChannels } from '@/lib/notifications/send'
import { registerAction, type ActionHandler, type ActionResult } from '@/lib/flows/engine'
import { createAdminClient } from '@/lib/supabase/admin'

const notify: ActionHandler = async (ctx, config): Promise<ActionResult> => {
  const event = typeof config.event === 'string' ? config.event : 'flow.notification'

  /*
   * ⚠️ THE CONTACT'S NAME, NOT THE CONTACT'S DATA. A channel notification is a
   * broadcast to a room that may include people with no CRM access, so it
   * carries the fact and a link — never the contents.
   */
  let contactName: string | null = null
  if (ctx.contactId) {
    const { data } = await createAdminClient()
      .from('crm_contacts')
      .select('full_name')
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', ctx.contactId)
      .maybeSingle()
    contactName = data?.full_name ?? null
  }

  const custom = typeof config.message === 'string' ? config.message.trim() : ''
  const title = custom || describeEvent(event, { contactName })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.outlio.io'
  const url = ctx.contactId ? `${baseUrl}/crm/contacts/${ctx.contactId}` : null

  const result = await notifyChannels(ctx.workspaceId, event, {
    title,
    url,
    urlLabel: 'Open in Outlio',
  })

  /*
   * ⚠️ NO CHANNELS IS SUCCESS, NOT FAILURE. A workspace that has not connected
   * Slack should not have every flow containing a notify step fail — the step
   * did what it could, and the output says so.
   */
  return {
    ok: true,
    output: { sent: result.sent, failed: result.failed, skipped: result.skipped },
  }
}

export function registerNotifyAction(): void {
  registerAction('NOTIFY', notify)
}
