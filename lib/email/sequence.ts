import 'server-only'

/**
 * Sequence step ordering — R12.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `step_index` IS 0-BASED, CONTIGUOUS, AND UNIQUELY INDEXED.              ║
 * ║                                                                           ║
 * ║  `email_sequence_steps_order_idx` is unique on (campaign_id, step_index),  ║
 * ║  and the sequence walker asks for "the step after N". Both facts make     ║
 * ║  reordering harder than it looks: writing the new positions directly      ║
 * ║  collides with the rows not yet moved, and leaving a hole after a         ║
 * ║  deletion strands every enrolment that reaches it.                        ║
 * ║                                                                           ║
 * ║  Extracted from the server action so this can be tested against a real    ║
 * ║  database — the collision only happens against the real index.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Rewrites `step_index` as 0..n-1 in the order given.
 *
 * ⚠️ TWO PASSES, NOT ONE. Everything is parked above the live range first,
 * because assigning position 0 to the row currently at position 1 collides
 * with the row still sitting at 0. Without a transaction, shifting clear is
 * what makes an in-place reorder possible at all.
 */
export async function writeStepOrder(
  workspaceId: string,
  idsInOrder: string[],
): Promise<void> {
  const db = createAdminClient()
  const PARK = 1000

  for (let i = 0; i < idsInOrder.length; i += 1) {
    const { error } = await db
      .from('email_sequence_steps')
      .update({ step_index: PARK + i })
      // Scoped by workspace in code — the service role bypasses RLS.
      .eq('workspace_id', workspaceId)
      .eq('id', idsInOrder[i]!)

    if (error) throw new Error(`writeStepOrder (park) failed: ${error.message}`)
  }

  for (let i = 0; i < idsInOrder.length; i += 1) {
    const { error } = await db
      .from('email_sequence_steps')
      .update({ step_index: i })
      .eq('workspace_id', workspaceId)
      .eq('id', idsInOrder[i]!)

    if (error) throw new Error(`writeStepOrder (settle) failed: ${error.message}`)
  }
}

/** Closes any gap in a campaign's step numbering. */
export async function renumberSteps(
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  const { data } = await createAdminClient()
    .from('email_sequence_steps')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('campaign_id', campaignId)
    .order('step_index')

  await writeStepOrder(workspaceId, (data ?? []).map((s) => s.id))
}

/** Swaps a step with its neighbour, returning the new order. */
export function swapped<T>(items: T[], at: number, direction: 'up' | 'down'): T[] | null {
  const target = direction === 'up' ? at - 1 : at + 1
  if (at < 0 || at >= items.length || target < 0 || target >= items.length) return null

  const next = [...items]
  ;[next[at], next[target]] = [next[target]!, next[at]!]
  return next
}
