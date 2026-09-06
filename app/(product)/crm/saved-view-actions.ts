'use server'

/**
 * Saved-view actions — Phase 2, DECISION-09 (private views).
 *
 * ⚠️ NO `export const` OF ANYTHING BUT AN ACTION IN THIS FILE. A `'use server'`
 * module may only export async functions; exporting a constant from one killed
 * every action on the pipeline page earlier in this project, and `tsc`, ESLint,
 * `next build` and 2,400 tests were all green while it did.
 */
import { revalidatePath } from 'next/cache'

import { scopeFor } from '@/lib/auth/scope'
import {
  createSavedView,
  deleteSavedView,
  SavedViewError,
  type ViewDefinition,
} from '@/lib/crm/saved-views'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type SavedViewState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | { ok: null }

/**
 * Save the current filter state as a private view.
 *
 * ⚠️ THE DEFINITION IS REBUILT FROM NAMED FIELDS, NOT PARSED FROM A BLOB.
 * Accepting a JSON string from the form would let a caller store arbitrary
 * shapes that `parseDefinition` then has to defend against on every read. The
 * form supplies the same query parameters the list already understands, and
 * this assembles them.
 */
export async function saveViewAction(
  _previous: SavedViewState,
  formData: FormData,
): Promise<SavedViewState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.view')
  } catch {
    return { ok: false, error: 'You do not have permission to save views.' }
  }

  const value = (key: string): string | undefined => {
    const raw = String(formData.get(key) ?? '').trim()
    return raw === '' ? undefined : raw
  }

  const tagIds = formData.getAll('tagId').map(String).filter(Boolean)

  const definition: ViewDefinition = {
    search: value('search'),
    ownerUserId: value('owner'),
    unassignedOnly: formData.get('unassigned') === 'on' ? true : undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    companyId: value('company'),
    createdAfter: value('createdAfter'),
    createdBefore: value('createdBefore'),
    // Absent means "no filter"; only an explicit yes/no becomes a boolean.
    hasEmail: value('hasEmail') === undefined ? undefined : value('hasEmail') === 'yes',
    source: value('source') as ViewDefinition['source'],
    sort: value('sort') as ViewDefinition['sort'],
    direction: value('dir') === 'asc' ? 'asc' : undefined,
  }

  try {
    await createSavedView(scopeFor(ctx), String(formData.get('name') ?? ''), definition)
  } catch (error) {
    if (error instanceof SavedViewError) return { ok: false, error: error.message }
    return { ok: false, error: 'Could not save that view.' }
  }

  revalidatePath('/crm/contacts')
  return { ok: true, message: 'View saved.' }
}

export async function deleteViewAction(
  _previous: SavedViewState,
  formData: FormData,
): Promise<SavedViewState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.view')
  } catch {
    return { ok: false, error: 'You do not have permission to manage views.' }
  }

  const viewId = String(formData.get('viewId') ?? '')
  if (!viewId) return { ok: false, error: 'Which view?' }

  const removed = await deleteSavedView(scopeFor(ctx), viewId)
  // A view that was not yours reports the same thing as one already deleted:
  // "no longer exists". Distinguishing them would confirm it belongs to
  // somebody else, which is the enumeration answer.
  if (!removed) return { ok: false, error: 'That view no longer exists.' }

  revalidatePath('/crm/contacts')
  return { ok: true, message: 'View deleted.' }
}
