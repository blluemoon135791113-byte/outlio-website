import type { Metadata } from 'next'

import { ApiKeys, Webhooks } from '@/components/settings/DeveloperSettings'
import { SettingsShell } from '@/components/settings/SettingsShell'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspacePermission } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Developer settings | Outlio',
  robots: { index: false, follow: false },
}

/**
 * API keys and webhooks.
 *
 * ⚠️ THE KEY HASH IS NEVER SELECTED. This page reads `key_prefix` and nothing
 * that could reconstruct a key — the hash exists so that a database dump is not
 * a set of working credentials, and putting it in a server component's props
 * would send it to the browser as serialised RSC payload.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ GATED AT THE ROUTE, NOT ONLY AT THE BUTTONS. This page used to call    ║
 * ║  `requireWorkspace()` and pass `canManage` down purely to decide which     ║
 * ║  CONTROLS rendered — so any member could load it. Measured on staging: a   ║
 * ║  `setter`, the second-lowest role, read the API key names, the key         ║
 * ║  prefixes, and the full webhook URLs.                                     ║
 * ║                                                                           ║
 * ║  ⚠️ A WEBHOOK URL IS A CREDENTIAL. Slack, Teams and Zapier all put a       ║
 * ║  bearer token in the PATH — whoever holds the URL can post as the app.     ║
 * ║  The notifications page one directory over already knew this and passes    ║
 * ║  only `hostOf(url)` for exactly this reason; this page shipped the whole   ║
 * ║  thing. Same risk, same codebase, opposite handling.                      ║
 * ║                                                                           ║
 * ║  `workspace.settings.manage` is admin-only, which is what CLAUDE.md rule 8 ║
 * ║  means by authorization being server-side: hiding the buttons left the     ║
 * ║  data in the RSC payload for anyone who typed the URL.                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export default async function DeveloperSettingsPage() {
  const ctx = await requireWorkspacePermission('workspace.settings.manage')
  // Still computed rather than hardcoded true: the guard above and the controls
  // below then answer the same question through the same function, so a future
  // change to the policy table moves both together.
  const canManage = can({ role: ctx.role, modules: ctx.modules }, 'workspace.settings.manage')
  const db = createAdminClient()

  const [{ data: keys }, { data: subscriptions }] = await Promise.all([
    db
      .from('api_keys')
      .select('id, name, key_prefix, scopes, last_used_at, created_at, revoked_at')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false }),
    db
      .from('webhook_subscriptions')
      .select('id, name, url, events, is_active, failure_count, disabled_reason')
      .eq('workspace_id', ctx.workspace.id)
      .order('created_at', { ascending: false }),
  ])

  const { data: deliveries } = await db
    .from('webhook_deliveries')
    .select('id, event_type, status, attempts, last_status_code, last_error, created_at')
    .eq('workspace_id', ctx.workspace.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <SettingsShell
      title="Developers"
      description="API keys for reading your workspace, and webhooks for hearing about changes."
    >
      <div className="space-y-10">
        <ApiKeys
          canManage={canManage}
          keys={(keys ?? []).map((k) => ({
            id: k.id,
            name: k.name,
            keyPrefix: k.key_prefix,
            scopes: k.scopes ?? [],
            lastUsedAt: k.last_used_at,
            createdAt: k.created_at,
            revokedAt: k.revoked_at,
          }))}
        />

        <Webhooks
          canManage={canManage}
          subscriptions={(subscriptions ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            url: s.url,
            events: s.events ?? [],
            isActive: s.is_active,
            failureCount: s.failure_count,
            disabledReason: s.disabled_reason,
          }))}
          deliveries={(deliveries ?? []).map((d) => ({
            id: d.id,
            eventType: d.event_type,
            status: d.status,
            attempts: d.attempts,
            lastStatusCode: d.last_status_code,
            lastError: d.last_error,
            createdAt: d.created_at,
          }))}
        />
      </div>
    </SettingsShell>
  )
}
