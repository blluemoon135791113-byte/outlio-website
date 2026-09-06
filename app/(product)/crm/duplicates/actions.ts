'use server'

/**
 * Duplicate Center actions — M2 Phase 4's engine, M9's screens (Ledger DR14).
 *
 * ⚠️ MERGING IS IRREVERSIBLE AND REWRITES ATTRIBUTION, which is why it is not
 * a setter action: `crm.contact.merge` is manager-and-above. Everything hard
 * about it already lives in `crm_merge_contacts` (0074) — both rows locked in
 * a deterministic order, every child table moved with its own collision rule.
 * This layer only decides who may ask.
 */
import { revalidatePath } from 'next/cache'

import { ignoreCandidate, mergeContacts, MergeConflictError } from '@/lib/crm/duplicates'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type DuplicateActionState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

const PATH = '/crm/duplicates'

export async function mergePair(
  _previous: DuplicateActionState,
  formData: FormData,
): Promise<DuplicateActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.merge')
  } catch {
    return { ok: false, error: 'Only a manager can merge contacts.' }
  }

  const surviving = String(formData.get('survivingId') ?? '')
  const merged = String(formData.get('mergedId') ?? '')

  if (!surviving || !merged || surviving === merged) {
    return { ok: false, error: 'Pick which record to keep.' }
  }

  try {
    const result = await mergeContacts(ctx.workspace.id, surviving, merged, ctx.userId)
    const moved = Object.values(result.moved).reduce((a, b) => a + b, 0)

    revalidatePath(PATH)
    return {
      ok: true,
      // Says what actually moved: a merge that silently loses history is the
      // thing people fear about merging.
      message: `Merged. ${moved} linked ${moved === 1 ? 'record' : 'records'} moved across.`,
    }
  } catch (error) {
    if (error instanceof MergeConflictError) {
      /*
       * ⚠️ TWO PEOPLE MERGING THE SAME PAIR AT ONCE. The database resolves it
       * safely; this is what the loser of the race is told, and it must not
       * read as a failure they caused.
       */
      return { ok: false, error: 'Someone else just merged this pair. Refresh to see the result.' }
    }
    return { ok: false, error: 'That merge did not go through. Nothing was changed.' }
  }
}

export async function ignorePair(
  _previous: DuplicateActionState,
  formData: FormData,
): Promise<DuplicateActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.duplicate.resolve')
    await ignoreCandidate(ctx.workspace.id, String(formData.get('candidateId') ?? ''), ctx.userId)

    revalidatePath(PATH)
    // "Not a duplicate" is a judgement worth recording, not a dismissal.
    return { ok: true, message: 'Marked as not a duplicate.' }
  } catch {
    return { ok: false, error: 'Could not update that pair.' }
  }
}
