import type { Metadata } from 'next'

import { NotificationChannels, type ChannelRow } from '@/components/settings/NotificationChannels'
import { SettingsShell } from '@/components/settings/SettingsShell'
import type { ChannelProvider } from '@/lib/notifications/format'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Notifications | Outlio',
  robots: { index: false, follow: false },
}

/**
 * ⚠️ THE URL IS SELECTED BUT ONLY ITS HOST IS PASSED DOWN. A Slack
 * incoming-webhook URL is unauthenticated — whoever holds it can post as the
 * app — so putting it in a server component's props would ship a working
 * credential to the browser inside the serialised RSC payload.
 */
export default async function NotificationSettingsPage() {
  const ctx = await requireWorkspace()
  const canManage = can({ role: ctx.role, modules: ctx.modules }, 'workspace.settings.manage')

  const { data } = await createAdminClient()
    .from('notification_channels')
    .select('id, name, provider, url, events, is_active, failure_count, last_error, last_sent_at')
    .eq('workspace_id', ctx.workspace.id)
    .order('created_at', { ascending: false })

  const channels: ChannelRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider as ChannelProvider,
    host: hostOf(row.url),
    events: row.events ?? [],
    isActive: row.is_active,
    failureCount: row.failure_count,
    lastError: row.last_error,
    lastSentAt: row.last_sent_at,
  }))

  return (
    <SettingsShell
      title="Notifications"
      description="Send a line to Slack or Teams when something happens worth looking at."
    >
      <NotificationChannels channels={channels} canManage={canManage} />
    </SettingsShell>
  )
}

/** A stored URL is always valid, but a parse failure must not blank the page. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown host'
  }
}
