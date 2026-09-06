import 'server-only'

/**
 * Private saved views for the contact list — Phase 2, DECISION-09.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ A SAVED VIEW IS USER-AUTHORED STATE THAT LATER REACHES A QUERY.       ║
 * ║                                                                           ║
 * ║  It is written once and read many times, often long afterwards, by code   ║
 * ║  that has forgotten where it came from. Anything stored here must be      ║
 * ║  validated on the way IN and again on the way OUT, because:               ║
 * ║                                                                           ║
 * ║    • the column is `jsonb` with only a `typeof = object` check, so the    ║
 * ║      database will happily store `{"sort": "; drop table --"}`;           ║
 * ║    • `definition` may have been written by an older version of this file  ║
 * ║      whose vocabulary has since changed;                                  ║
 * ║    • a row edited directly in the SQL editor bypasses the write path      ║
 * ║      entirely.                                                            ║
 * ║                                                                           ║
 * ║  So `parseDefinition` is the ONLY way a stored view becomes filter        ║
 * ║  options, and it drops anything it does not recognise rather than         ║
 * ║  passing it through. That is the same rule `isContactSort` follows for    ║
 * ║  the sort parameter, applied to a bigger surface.                         ║
 * ║                                                                           ║
 * ║  ⚠️ PRIVATE ONLY (DECISION-09). `is_shared` exists in the schema and is    ║
 * ║  always written `false`. Reads filter by `owner_user_id` as well as       ║
 * ║  workspace, so a shared view accidentally created by some other path is   ║
 * ║  still not returned to the wrong person.                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { z } from 'zod'

import type { TenantScope } from '@/lib/auth/scope'
import {
  CONTACT_SOURCES,
  isContactSort,
  type ContactSort,
  type ContactSource,
  type ListContactsOptions,
} from '@/lib/crm/contacts-list'
import { createAdminClient } from '@/lib/supabase/admin'

export type SavedView = {
  id: string
  name: string
  definition: ViewDefinition
  createdAt: string
}

/**
 * The filter state a view remembers.
 *
 * ⚠️ DELIBERATELY NOT `ListContactsOptions`. A view must not remember `page` —
 * restoring somebody onto page 7 of a list they have not seen is disorienting
 * and, once the data changes, meaningless. Nor `pageSize`, which is a display
 * preference rather than part of the segment.
 */
export type ViewDefinition = {
  search?: string
  ownerUserId?: string
  unassignedOnly?: boolean
  tagIds?: string[]
  companyId?: string
  createdAfter?: string
  createdBefore?: string
  hasEmail?: boolean
  source?: ContactSource
  sort?: ContactSort
  direction?: 'asc' | 'desc'
}

const uuid = z.string().uuid()
const isoDate = z.string().datetime({ offset: true }).or(z.string().date())

/**
 * ⚠️ EVERY FIELD IS OPTIONAL AND EVERY FIELD IS CHECKED. `.catch(undefined)`
 * on each means one corrupt key drops that key rather than rejecting the whole
 * view — a user whose saved view was written by an older version should lose
 * the filter that no longer exists, not the view.
 */
const definitionSchema = z.object({
  search: z.string().max(200).optional().catch(undefined),
  ownerUserId: uuid.optional().catch(undefined),
  unassignedOnly: z.boolean().optional().catch(undefined),
  tagIds: z.array(uuid).max(20).optional().catch(undefined),
  companyId: uuid.optional().catch(undefined),
  createdAfter: isoDate.optional().catch(undefined),
  createdBefore: isoDate.optional().catch(undefined),
  hasEmail: z.boolean().optional().catch(undefined),
  source: z.enum(CONTACT_SOURCES as [ContactSource, ...ContactSource[]]).optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  direction: z.enum(['asc', 'desc']).optional().catch(undefined),
})

/**
 * Turn stored JSON into a definition, dropping anything unrecognised.
 *
 * ⚠️ RETURNS `{}` RATHER THAN THROWING. A view that cannot be parsed at all
 * should open as the unfiltered list, not as an error page — the user's other
 * views still work and they can delete this one. Throwing here would make one
 * bad row break the whole views menu.
 */
export function parseDefinition(raw: unknown): ViewDefinition {
  const parsed = definitionSchema.safeParse(raw)
  if (!parsed.success) return {}

  const value = parsed.data
  return {
    ...value,
    // `sort` is validated against the SAME allowlist the URL parameter uses.
    // A stored value is no more trustworthy than a query string.
    sort: isContactSort(value.sort) ? value.sort : undefined,
  }
}

/**
 * A definition as `listContacts` options.
 *
 * ⚠️ PAGE IS ALWAYS RESET. See the note on `ViewDefinition`.
 */
export function viewToOptions(definition: ViewDefinition): ListContactsOptions {
  return { ...definition, page: 1 }
}

export async function listSavedViews(scope: TenantScope): Promise<SavedView[]> {
  const { data, error } = await createAdminClient()
    .from('crm_saved_views')
    .select('id, name, definition, created_at')
    .eq('workspace_id', scope.workspaceId)
    /*
     * ⚠️ OWNER AS WELL AS WORKSPACE. DECISION-09 is private-only, and filtering
     * by workspace alone would show every colleague's views to everyone — which
     * is the SHARED feature, arrived at by omission rather than by decision.
     */
    .eq('owner_user_id', scope.userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listSavedViews failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    definition: parseDefinition(row.definition),
    createdAt: row.created_at,
  }))
}

export async function getSavedView(
  scope: TenantScope,
  viewId: string,
): Promise<SavedView | null> {
  const { data, error } = await createAdminClient()
    .from('crm_saved_views')
    .select('id, name, definition, created_at')
    .eq('workspace_id', scope.workspaceId)
    .eq('owner_user_id', scope.userId)
    .eq('id', viewId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`getSavedView failed: ${error.message}`)
  if (!data) return null

  return {
    id: data.id,
    name: data.name,
    definition: parseDefinition(data.definition),
    createdAt: data.created_at,
  }
}

export class SavedViewError extends Error {}

export async function createSavedView(
  scope: TenantScope,
  name: string,
  definition: ViewDefinition,
): Promise<string> {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 80) {
    // Matches crm_saved_views_name_check, so the user gets a sentence rather
    // than a constraint violation.
    throw new SavedViewError('A view needs a name of 1 to 80 characters.')
  }

  /*
   * ⚠️ PARSED BEFORE IT IS STORED, not only when read. Validating on read alone
   * would let a malformed definition sit in the database until somebody opens
   * it, turning a bad save into a bug reported days later by a different person.
   */
  const clean = parseDefinition(definition)

  const { data, error } = await createAdminClient()
    .from('crm_saved_views')
    .insert({
      workspace_id: scope.workspaceId,
      owner_user_id: scope.userId,
      entity: 'contact',
      name: trimmed,
      definition: clean,
      // DECISION-09: private only. Never written true from this module.
      is_shared: false,
    })
    .select('id')
    .single()

  if (error || !data) throw new SavedViewError('Could not save that view.')
  return data.id
}

export async function deleteSavedView(scope: TenantScope, viewId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('crm_saved_views')
    .update({ deleted_at: new Date().toISOString() })
    .eq('workspace_id', scope.workspaceId)
    /*
     * ⚠️ OWNER TOO. Without it, any member could delete a colleague's view by
     * id — a cross-user write inside a correctly-scoped tenant, which the
     * tenant-isolation suite would not catch because both users are in the same
     * workspace.
     */
    .eq('owner_user_id', scope.userId)
    .eq('id', viewId)
    .is('deleted_at', null)
    .select('id')

  if (error) throw new Error(`deleteSavedView failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}
