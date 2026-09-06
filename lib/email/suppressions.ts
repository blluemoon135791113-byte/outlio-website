import 'server-only'

/**
 * Reading and removing the suppression list.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  EVERY WRITE PATH EXISTED; THERE WAS NO READ PATH.                       ║
 * ║                                                                           ║
 * ║  `suppressEmail` is called on unsubscribe and on hard bounce, and         ║
 * ║  `enqueueEmail` refuses a suppressed address — proven by mutation, since  ║
 * ║  removing that check fails five integration tests. What no screen could   ║
 * ║  do was SHOW the list.                                                    ║
 * ║                                                                           ║
 * ║  CAN-SPAM §7704(a)(4) requires honouring an opt-out. The product does.    ║
 * ║  It could not demonstrate it: a customer asking "did you remove me?" got  ║
 * ║  no answer from any screen, and nobody could undo a suppression that was  ║
 * ║  wrong.                                                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'

export type {
  Suppression,
  SuppressionReason,
} from '@/lib/email/suppression-copy'
import type { Suppression, SuppressionReason } from '@/lib/email/suppression-copy'

/**
 * The workspace's suppression list, newest first.
 *
 * ⚠️ SCOPED IN CODE. The service role bypasses RLS, so the `workspace_id`
 * filter here is the only thing between one tenant's opt-outs and another's.
 */
export async function listSuppressions(
  workspaceId: string,
  limit = 500,
): Promise<Suppression[]> {
  const { data, error } = await createAdminClient()
    .from('email_suppressions')
    .select('id, email, reason, source, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`listSuppressions failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    reason: row.reason as SuppressionReason,
    source: row.source,
    createdAt: row.created_at,
  }))
}

/**
 * Removes one suppression, so the address can be mailed again.
 *
 * ⚠️ A HARD DELETE, AND THAT IS THE CORRECT SHAPE HERE. A soft-deleted
 * suppression still has to be excluded by every future query, and the day one
 * of those queries forgets, a person who opted out gets mailed. The audit trail
 * for consent lives in `email_events` — the `unsubscribed` event is not touched
 * by this and remains the record that they asked.
 *
 * Returns whether a row was actually removed: a delete that matched nothing
 * must not report success, or a caller scoped to the wrong workspace looks
 * identical to one that worked.
 */
export async function removeSuppression(
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('email_suppressions')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select('id')

  if (error) throw new Error(`removeSuppression failed: ${error.message}`)
  return (data ?? []).length > 0
}
