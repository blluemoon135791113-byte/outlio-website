'use server'

/**
 * Server actions for the contact detail page.
 *
 * ⚠️ ASSIGNMENT GOES THROUGH THE COLLISION GUARD. That is the whole point of
 * Phase 8: the guard is useless if the one screen that reassigns people can
 * bypass it. `assignContactAction` refuses when the workspace requires
 * approval, and records an override when someone proceeds under a warning.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { addNote, assignContact } from '@/lib/crm/activities'
import { createContactManually } from '@/lib/crm/ingest'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  checkCollision,
  DuplicateRequestError,
  recordCollisionOverride,
  requestReassignment,
} from '@/lib/crm/collision'
import { isAppError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type ContactActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

const uuid = z.string().uuid()

const fail = (message: string): ContactActionState => ({ status: 'error', message })
const ok = (message: string): ContactActionState => ({ status: 'success', message })

function toState(error: unknown): ContactActionState {
  if (error instanceof DuplicateRequestError) return fail(error.message)
  if (isAppError(error)) return fail(error.userMessage)
  return fail('That did not work. Please try again.')
}

/**
 * Assigns a contact to someone.
 *
 * The flow the collision guard defines:
 *   require_approval + collision → REFUSED, with a reassignment request offered
 *   warn + collision + no override → refused, and the caller shows the warning
 *   warn + collision + override    → proceeds, and the override is recorded
 */
export async function assignContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.contact.assign')

    const contactId = uuid.safeParse(formData.get('contact_id'))
    if (!contactId.success) return fail('That contact could not be read.')

    // Empty string means "unassign", which is a legitimate choice — distinct
    // from a malformed id, which is not.
    const raw = String(formData.get('owner_user_id') ?? '')
    let newOwner: string | null = null
    if (raw !== '') {
      const parsed = uuid.safeParse(raw)
      if (!parsed.success) return fail('That person could not be read.')
      newOwner = parsed.data
    }

    const acknowledged = String(formData.get('acknowledged') ?? '') === 'true'
    const overrideReason = String(formData.get('override_reason') ?? '').trim()

    const collision = await checkCollision(ctx.workspace.id, contactId.data, ctx.userId)

    if (collision.hasCollision) {
      if (collision.blocked) {
        return fail(
          `${collision.contact?.ownerName ?? 'A teammate'} is working this contact and your workspace requires approval. Request a reassignment instead.`,
        )
      }
      if (!acknowledged) {
        // The caller renders the warning; this is the server refusing to act
        // on a click that has not seen it.
        return fail(
          `${collision.contact?.ownerName ?? 'A teammate'} is already working this contact. Review the warning before reassigning.`,
        )
      }
      await recordCollisionOverride(
        ctx.workspace.id,
        contactId.data,
        ctx.userId,
        overrideReason || undefined,
      )
    }

    await assignContact(ctx.workspace.id, contactId.data, newOwner, ctx.userId)

    revalidatePath(`/crm/contacts/${contactId.data}`)
    return ok(newOwner ? 'Owner updated.' : 'Owner cleared.')
  } catch (error) {
    return toState(error)
  }
}

export async function requestReassignmentAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    // Deliberately a LOWER bar than assigning: asking for a record is
    // something any setter should be able to do about a contact they can see.
    const ctx = await assertWorkspacePermission('crm.contact.view')

    const contactId = uuid.safeParse(formData.get('contact_id'))
    if (!contactId.success) return fail('That contact could not be read.')

    const note = String(formData.get('note') ?? '').trim()
    await requestReassignment(ctx.workspace.id, contactId.data, ctx.userId, note || undefined)

    revalidatePath(`/crm/contacts/${contactId.data}`)
    return ok('Request sent to the current owner.')
  } catch (error) {
    return toState(error)
  }
}

export async function addNoteAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.contact.edit')

    const contactId = uuid.safeParse(formData.get('contact_id'))
    if (!contactId.success) return fail('That contact could not be read.')

    const body = String(formData.get('body') ?? '').trim()
    if (!body) return fail('Write something first.')
    if (body.length > 20000) return fail('That note is too long.')

    await addNote(ctx.workspace.id, { contactId: contactId.data, body }, ctx.userId)

    revalidatePath(`/crm/contacts/${contactId.data}`)
    return ok('Note added.')
  } catch (error) {
    return toState(error)
  }
}


// ---------------------------------------------------------------------------
// Creating a contact by hand — R2
// ---------------------------------------------------------------------------

export type CreateContactState =
  | { ok: true; message: string; contactId: string; created: boolean }
  | { ok: false; error: string }
  | null

/**
 * ⚠️ ROUTED THROUGH THE DEDUPLICATING INGEST, not a plain insert. Manual entry
 * is the most likely way a duplicate gets into a CRM, because it is what people
 * reach for when they cannot find someone who is already there. This reports
 * "already in your CRM" instead of quietly making a second copy.
 */
export async function createContactAction(
  _previous: CreateContactState,
  formData: FormData,
): Promise<CreateContactState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.create')
  } catch {
    return { ok: false, error: 'You do not have permission to add contacts.' }
  }

  const fullName = String(formData.get('fullName') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const jobTitle = String(formData.get('jobTitle') ?? '').trim()
  const linkedInUrl = String(formData.get('linkedInUrl') ?? '').trim()
  const phone = String(formData.get('phone') ?? '').trim()

  // The normalizer enforces this too, but saying it here names the field.
  if (!fullName && !email) {
    return { ok: false, error: 'Give at least a name or an email address.' }
  }

  try {
    const result = await createContactManually(
      ctx.workspace.id,
      {
        fullName: fullName || null,
        emails: email ? [email] : [],
        phones: phone ? [phone] : [],
        jobTitle: jobTitle || null,
        linkedInUrl: linkedInUrl || null,
        // Whoever adds someone by hand is working them; that is a far better
        // default than unassigned, which is right for a bulk import.
        ownerUserId: ctx.userId,
        source: 'manual',
      },
      ctx.userId,
    )

    revalidatePath('/crm/contacts')

    return {
      ok: true,
      contactId: result.contactId,
      created: result.created,
      message: result.created
        ? 'Contact added.'
        : 'That person was already in your CRM — opening them instead.',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('needs a name or an email')) {
      return { ok: false, error: 'Give at least a name or an email address.' }
    }
    return { ok: false, error: 'Could not add that contact.' }
  }
}

// ---------------------------------------------------------------------------
// Bulk assignment — R2
// ---------------------------------------------------------------------------

export type BulkAssignState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/**
 * Assigns many contacts at once.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS CLOSES A LOOP R1 DELIBERATELY OPENED.                              ║
 * ║                                                                           ║
 * ║  Imported and extracted leads arrive UNASSIGNED on purpose — bulk-giving  ║
 * ║  five hundred contacts to whoever clicked the button is wrong most of the ║
 * ║  time. But that is only defensible if distributing them afterwards is     ║
 * ║  easy, and until now there was no way to assign more than one contact at  ║
 * ║  a time. The deliberate choice was quietly making the product unusable    ║
 * ║  after an import of any size.                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function bulkAssignAction(
  _previous: BulkAssignState,
  formData: FormData,
): Promise<BulkAssignState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.assign')
  } catch {
    return { ok: false, error: 'You do not have permission to assign contacts.' }
  }

  const ids = formData.getAll('contactId').map(String).filter(Boolean)
  if (ids.length === 0) return { ok: false, error: 'Select some contacts first.' }

  /*
   * ⚠️ BOUNDED. A page holds 25; anything far beyond that is a crafted request
   * rather than a click, and an unbounded UPDATE is how one form submission
   * rewrites a whole book of business.
   */
  if (ids.length > 200) {
    return { ok: false, error: 'Assign at most 200 contacts at a time.' }
  }

  const raw = String(formData.get('ownerUserId') ?? '')
  const ownerUserId = raw === 'none' ? null : raw

  const db = createAdminClient()

  /*
   * ⚠️ THE NEW OWNER MUST BE A MEMBER OF THIS WORKSPACE. The id comes from a
   * form and the service role bypasses RLS, so without this a crafted request
   * hands contacts to an outsider, who then owns them legitimately. Same check
   * as the departing-member handover in R3.
   */
  if (ownerUserId) {
    const { data: member } = await db
      .from('workspace_memberships')
      .select('user_id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('user_id', ownerUserId)
      .maybeSingle()

    if (!member) return { ok: false, error: 'That person is not in this workspace.' }
  }

  const { data, error } = await db
    .from('crm_contacts')
    .update({ owner_user_id: ownerUserId })
    // Scoped by workspace in code, and by the id list — an id from a form is a
    // claim, and this is what stops it reaching another tenant's contact.
    .eq('workspace_id', ctx.workspace.id)
    .in('id', ids)
    .select('id')

  if (error) return { ok: false, error: 'Could not assign those contacts.' }

  const moved = data?.length ?? 0

  revalidatePath('/crm/contacts')

  /*
   * Reports the number that ACTUALLY changed, not the number selected. They
   * differ when a selection spans a page someone no longer has access to, and
   * silently claiming the larger number would hide that.
   */
  return {
    ok: true,
    message: ownerUserId
      ? `${moved} contact${moved === 1 ? '' : 's'} assigned.`
      : `${moved} contact${moved === 1 ? '' : 's'} unassigned.`,
  }
}

/**
 * The selection every bulk action starts from.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THREE THINGS MUST HOLD FOR EVERY BULK ACTION, AND MISSING ANY ONE     ║
 * ║  LOOKS LIKE WORKING CODE.                                                ║
 * ║                                                                           ║
 * ║   1. A PERMISSION, checked server-side. A bulk action multiplies the cost ║
 * ║      of a missing check by the size of the selection.                    ║
 * ║   2. A BOUND. An unbounded write is how one form submission rewrites a    ║
 * ║      whole book of business.                                             ║
 * ║   3. A WORKSPACE FILTER. Ids arrive from a form — they are a CLAIM, not a ║
 * ║      fact — and the service role bypasses RLS, so nothing else stops an   ║
 * ║      id belonging to another tenant.                                     ║
 * ║                                                                           ║
 * ║  Centralised here so a new bulk action cannot quietly omit one.          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
const BULK_LIMIT = 200

type BulkSelection =
  | { ok: true; ctx: Awaited<ReturnType<typeof assertWorkspacePermission>>; ids: string[] }
  | { ok: false; error: string }

async function bulkSelection(
  formData: FormData,
  permission: Parameters<typeof assertWorkspacePermission>[0],
  refusal: string,
): Promise<BulkSelection> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(permission)
  } catch {
    return { ok: false, error: refusal }
  }

  const ids = formData.getAll('contactId').map(String).filter(Boolean)
  if (ids.length === 0) return { ok: false, error: 'Select some contacts first.' }
  if (ids.length > BULK_LIMIT) {
    return { ok: false, error: `Select at most ${BULK_LIMIT} contacts at a time.` }
  }

  return { ok: true, ctx, ids }
}

export type BulkState = { ok: true; message: string } | { ok: false; error: string } | { ok: null }

/** Attach a tag to every selected contact. */
export async function bulkTagAction(
  _previous: BulkState,
  formData: FormData,
): Promise<BulkState> {
  const selection = await bulkSelection(
    formData,
    'crm.contact.edit',
    'You do not have permission to tag contacts.',
  )
  if (!selection.ok) return selection

  const { ctx, ids } = selection
  const tagId = String(formData.get('tagId') ?? '')
  if (!tagId) return { ok: false, error: 'Choose a tag.' }

  const db = createAdminClient()

  /*
   * ⚠️ THE TAG MUST BELONG TO THIS WORKSPACE. Same reasoning as the owner check
   * in `bulkAssignAction`: the id comes from a form. Without this a crafted
   * request attaches another tenant's tag, and the tag list then leaks their
   * taxonomy back through the UI.
   */
  const { data: tag } = await db
    .from('crm_tags')
    .select('id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', tagId)
    .maybeSingle()

  if (!tag) return { ok: false, error: 'That tag no longer exists.' }

  /*
   * ⚠️ THE CONTACT IDS ARE FILTERED BEFORE THE INSERT, not trusted from the
   * form. `crm_contact_tags` rows are written directly, so an id from another
   * workspace would otherwise create a cross-tenant association that every
   * later read treats as real.
   */
  const { data: owned } = await db
    .from('crm_contacts')
    .select('id')
    .eq('workspace_id', ctx.workspace.id)
    .in('id', ids)
    .is('deleted_at', null)

  const validIds = (owned ?? []).map((r) => r.id)
  if (validIds.length === 0) return { ok: false, error: 'Those contacts no longer exist.' }

  const { error } = await db.from('crm_contact_tags').upsert(
    validIds.map((contactId) => ({
      workspace_id: ctx.workspace.id,
      contact_id: contactId,
      tag_id: tagId,
    })),
    // Tagging something already tagged is a no-op, not an error — a user
    // re-applying a tag to a mixed selection is doing something reasonable.
    { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
  )

  if (error) return { ok: false, error: 'Could not tag those contacts.' }

  revalidatePath('/crm/contacts')
  return { ok: true, message: `Tagged ${validIds.length} contact${validIds.length === 1 ? '' : 's'}.` }
}

/** Add every selected contact to a static list. */
export async function bulkAddToListAction(
  _previous: BulkState,
  formData: FormData,
): Promise<BulkState> {
  const selection = await bulkSelection(
    formData,
    'crm.contact.edit',
    'You do not have permission to change lists.',
  )
  if (!selection.ok) return selection

  const { ctx, ids } = selection
  const listId = String(formData.get('listId') ?? '')
  if (!listId) return { ok: false, error: 'Choose a list.' }

  const db = createAdminClient()

  const { data: list } = await db
    .from('crm_lists')
    .select('id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', listId)
    .maybeSingle()

  if (!list) return { ok: false, error: 'That list no longer exists.' }

  const { data: owned } = await db
    .from('crm_contacts')
    .select('id')
    .eq('workspace_id', ctx.workspace.id)
    .in('id', ids)
    .is('deleted_at', null)

  const validIds = (owned ?? []).map((r) => r.id)
  if (validIds.length === 0) return { ok: false, error: 'Those contacts no longer exist.' }

  const { error } = await db.from('crm_list_members').upsert(
    validIds.map((contactId) => ({
      workspace_id: ctx.workspace.id,
      list_id: listId,
      contact_id: contactId,
    })),
    { onConflict: 'list_id,contact_id', ignoreDuplicates: true },
  )

  if (error) return { ok: false, error: 'Could not add those contacts to the list.' }

  revalidatePath('/crm/contacts')
  revalidatePath('/crm/lists')
  return { ok: true, message: `Added ${validIds.length} to the list.` }
}

/**
 * Soft-delete every selected contact.
 *
 * ⚠️ SOFT, AND THAT IS NOT A HEDGE. `crm_activities` is append-only and
 * references contacts; a hard delete would either be refused by the guard or
 * rewrite history. Everything downstream already filters on
 * `deleted_at is null`, so a soft delete is the delete this product has.
 */
export async function bulkDeleteAction(
  _previous: BulkState,
  formData: FormData,
): Promise<BulkState> {
  const selection = await bulkSelection(
    formData,
    'crm.contact.delete',
    'You do not have permission to delete contacts.',
  )
  if (!selection.ok) return selection

  const { ctx, ids } = selection

  const { data, error } = await createAdminClient()
    .from('crm_contacts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspace.id)
    .in('id', ids)
    // Deleting an already-deleted contact should not report success for it.
    .is('deleted_at', null)
    .select('id')

  if (error) return { ok: false, error: 'Could not delete those contacts.' }

  const removed = data?.length ?? 0
  revalidatePath('/crm/contacts')
  return { ok: true, message: `Deleted ${removed} contact${removed === 1 ? '' : 's'}.` }
}
