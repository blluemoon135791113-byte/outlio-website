'use server'

/**
 * List management actions.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS FILE IS THE FIX FOR "LISTS DOES NOT WORK".                          ║
 * ║                                                                           ║
 * ║  Lists were not broken and were not dead code — they were a CLOSED LOOP.  ║
 * ║  Every piece existed except an entrance:                                  ║
 * ║                                                                           ║
 * ║    · `crm_lists` / `crm_list_members` shipped in migration 0072           ║
 * ║    · `bulkAddToListAction` adds selected contacts to a list               ║
 * ║    · the flow engine can add and remove list members                      ║
 * ║    · `/crm/lists` renders lists and their counts                          ║
 * ║    · `/api/v1/lists` serves them                                          ║
 * ║                                                                           ║
 * ║  …and NOTHING ANYWHERE CREATED A LIST. `BulkAssign` gates its picker on   ║
 * ║  `lists.length > 0`, so the one control that consumes lists was hidden    ║
 * ║  precisely because there were none — and the empty state told people to   ║
 * ║  make one "during an import or from the contacts screen", neither of      ║
 * ║  which offered any such thing. A feature can be complete in every part    ║
 * ║  and still be unusable, and it reads exactly like a dead feature from     ║
 * ║  the outside.                                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NOTHING BUT `async function` MAY BE EXPORTED FROM THIS FILE — see the long
 * note in `../pipeline/actions.ts`; a non-function export here takes down every
 * action reachable from the page at runtime, and no build step catches it.
 */
import { revalidatePath } from 'next/cache'

import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type ListActionState =
  | { ok: true; message: string; listId?: string }
  | { ok: false; error: string }
  | null

export async function createListAction(
  _previous: ListActionState,
  formData: FormData,
): Promise<ListActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch {
    return { ok: false, error: 'You do not have permission to create lists.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { ok: false, error: 'Give the list a name.' }
  if (name.length > 120) return { ok: false, error: 'That name is too long (120 characters).' }

  const description = String(formData.get('description') ?? '').trim() || null

  const db = createAdminClient()

  /*
   * ⚠️ `normalized_name` IS NOT OPTIONAL. It is `not null`, it carries a CHECK
   * that it equals its own lowercase, and the partial unique index that stops
   * two "Warm leads" in one workspace is built on it — so computing it here is
   * what makes the duplicate below detectable at all.
   */
  const { data, error } = await db
    .from('crm_lists')
    .insert({
      workspace_id: ctx.workspace.id,
      name,
      normalized_name: name.toLowerCase(),
      description,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) {
    // The partial unique index on (workspace_id, normalized_name).
    if (error.code === '23505') {
      return { ok: false, error: `You already have a list called “${name}”.` }
    }
    return { ok: false, error: 'Could not create that list.' }
  }

  revalidatePath('/crm/lists')
  // The contacts screen reads lists to build its "Add to list…" picker, and
  // that picker is hidden while there are none — so it has to re-render too,
  // or the first list appears to have changed nothing.
  revalidatePath('/crm/contacts')
  return { ok: true, message: `${name} is ready.`, listId: data.id }
}

export async function renameListAction(
  _previous: ListActionState,
  formData: FormData,
): Promise<ListActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch {
    return { ok: false, error: 'You do not have permission to change lists.' }
  }

  const listId = String(formData.get('listId') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  if (!listId) return { ok: false, error: 'Choose a list.' }
  if (!name) return { ok: false, error: 'Give the list a name.' }

  const db = createAdminClient()

  const { error } = await db
    .from('crm_lists')
    .update({ name, normalized_name: name.toLowerCase() })
    // Scoped by workspace in code — the service role bypasses RLS.
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', listId)
    .is('deleted_at', null)

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `You already have a list called “${name}”.` }
    }
    return { ok: false, error: 'Could not rename that list.' }
  }

  revalidatePath('/crm/lists')
  revalidatePath('/crm/contacts')
  return { ok: true, message: 'Renamed.' }
}

/**
 * ⚠️ SOFT, AND THE MEMBERSHIPS ARE LEFT ALONE. `deleted_at` hides the list; the
 * `crm_list_members` rows stay, so restoring one is an UPDATE rather than a
 * reconstruction. Every reader already filters on `deleted_at is null`.
 *
 * Deleting a list has never deleted a contact and must not start: a list is an
 * association, not a container (see the note atop `/crm/lists/page.tsx`).
 */
export async function deleteListAction(
  _previous: ListActionState,
  formData: FormData,
): Promise<ListActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch {
    return { ok: false, error: 'You do not have permission to delete lists.' }
  }

  const listId = String(formData.get('listId') ?? '')
  if (!listId) return { ok: false, error: 'Choose a list.' }

  const db = createAdminClient()

  const { error } = await db
    .from('crm_lists')
    .update({ deleted_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', listId)
    .is('deleted_at', null)

  if (error) return { ok: false, error: 'Could not delete that list.' }

  revalidatePath('/crm/lists')
  revalidatePath('/crm/contacts')
  return { ok: true, message: 'Deleted. The contacts on it are untouched.' }
}
