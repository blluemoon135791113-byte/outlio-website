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
export type SuppressionPage = {
  rows: Suppression[]
  /** Every suppression in the workspace, not just the ones returned. */
  total: number
  /**
   * A single address the caller asked about, when it was not in `rows`.
   *
   * ⚠️ THE SCREEN'S ACTUAL QUESTION IS "IS THIS ONE ADDRESS SUPPRESSED?" and
   * scrolling a list is a bad way to answer it. This module's own banner says
   * the feature exists because "a customer asking 'did you remove me?' got no
   * answer from any screen" — a list that stops at 500 gives a WRONG answer to
   * the same question, which is worse than none.
   */
  match: Suppression | null
}

const PAGE = 500

export async function listSuppressions(
  workspaceId: string,
  options: { search?: string | null } = {},
): Promise<SuppressionPage> {
  const db = createAdminClient()
  const search = options.search?.trim().toLowerCase() || null

  let query = db
    .from('email_suppressions')
    // ⚠️ `count: 'exact'` — without it the screen cannot say the list is short,
    // and a truncated compliance list presented as complete is the defect.
    .select('id, email, reason, source, created_at', { count: 'exact' })
    .eq('workspace_id', workspaceId)

  /*
   * ⚠️ SEARCH IS AN EQUALITY, NOT A PATTERN. The column has a `= lower(email)`
   * check so the stored side is folded, and an exact lookup answers the
   * question a person is actually asking. A `like` would also match
   * `not-ada@example.com` when asked about `ada@example.com`, which on a
   * compliance screen is an answer that is confidently wrong.
   */
  if (search) query = query.eq('email', search)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .limit(PAGE)

  if (error) throw new Error(`listSuppressions failed: ${error.message}`)

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    reason: row.reason as SuppressionReason,
    source: row.source,
    createdAt: row.created_at,
  }))

  return {
    rows,
    total: count ?? rows.length,
    match: search ? (rows[0] ?? null) : null,
  }
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
