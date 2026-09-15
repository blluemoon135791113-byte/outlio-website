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

import { addNote, assignContact, bulkAssignContacts, eraseContact, NotAMemberError } from '@/lib/crm/activities'
import { createContactManually } from '@/lib/crm/ingest'
import {
  STOP_REASONS,
  STOP_SCOPES,
  suppressContact,
  unsuppressContact,
  type StopReason,
} from '@/lib/crm/contact-stop'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  checkCollision,
  DuplicateRequestError,
  recordCollisionOverride,
  requestReassignment,
} from '@/lib/crm/collision'
import { isAppError } from '@/lib/errors/catalog'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

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
  /**
   * §4's fourth create-time outcome: a PRIVATE ADMIN-REVIEW CONFLICT.
   *
   * The entry matched somebody this caller may not read. No id, no name, no
   * owner and no count crosses back — `held` carries no payload on purpose,
   * because every field it could carry is one T04 forbids.
   */
  | { ok: true; held: true; message: string }
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

    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  A MATCH THE CALLER CANNOT READ IS NOT AN ANSWER THEY GET.            ║
     * ║                                                                       ║
     * ║  Dedup runs on the service role, so it matches across the whole        ║
     * ║  workspace — including records a setter's `assigned` scope hides.      ║
     * ║  Returning that contact's id told them the person exists, who they     ║
     * ║  are, and gave them the id to navigate to: an enumeration oracle for   ║
     * ║  the entire contact list, one guessed email at a time.                 ║
     * ║                                                                       ║
     * ║  T04: no owner, name, id or count disclosure — and the admin review    ║
     * ║  path must still prevent the unsafe duplicate. So the record is not    ║
     * ║  created, nothing identifying is returned, and the existing            ║
     * ║  reassignment queue carries the conflict to someone who may act on it. ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const matchedSomeoneElses =
      !result.created &&
      dataScope(ctx.role) !== 'all' &&
      result.ownerUserId !== ctx.userId

    if (matchedSomeoneElses) {
      try {
        await requestReassignment(
          ctx.workspace.id,
          result.contactId,
          ctx.userId,
          'Opened automatically: tried to add a contact the workspace already has.',
        )
      } catch (error) {
        // Already asked. The review path is open, which is all this needs — and
        // the requester must not learn that a second attempt behaved
        // differently from the first.
        if (!(error instanceof DuplicateRequestError)) throw error
      }

      return {
        ok: true,
        held: true,
        message:
          'That contact needs an administrator to review it before it can be added. ' +
          'They have been asked.',
      }
    }

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

  /*
   * ⚠️ THE WORKSPACE AND MEMBERSHIP CHECKS NOW LIVE IN THE DATABASE, where the
   * write happens. `crm_bulk_assign_contacts` (0129) only touches this
   * workspace's live contacts — an id from a form is a claim — and refuses a
   * new owner who is not a member, so a crafted request cannot hand contacts
   * to an outsider. Each change goes through the single-assignment function,
   * so each writes its OWNER_ASSIGNED history.
   */
  let result
  try {
    result = await bulkAssignContacts(ctx.workspace.id, ids, ownerUserId, ctx.userId)
  } catch (error) {
    if (error instanceof NotAMemberError) return { ok: false, error: error.message }
    return { ok: false, error: 'Could not assign those contacts.' }
  }

  revalidatePath('/crm/contacts')

  /*
   * Reports the number that ACTUALLY changed, not the number selected. They
   * differ when a selection spans a page someone no longer has access to, and
   * silently claiming the larger number would hide that.
   */
  const { changed, unchanged } = result
  const verb = ownerUserId ? 'assigned' : 'unassigned'
  const already = unchanged > 0 ? ` ${unchanged} already ${ownerUserId ? 'theirs' : 'unassigned'}.` : ''
  return {
    ok: true,
    message: `${changed} contact${changed === 1 ? '' : 's'} ${verb}.${already}`,
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

// ---------------------------------------------------------------------------
// The right to erasure — §6.4
// ---------------------------------------------------------------------------

/**
 * Erases a contact under the GDPR right to erasure.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ERASURE PATH WAS BUILT AND UNREACHABLE FOR THE WHOLE OF ITS LIFE.    ║
 * ║                                                                           ║
 * ║  `crm_erase_contact` landed in migration 0075 and was revised twice (0091, ║
 * ║  0109) to work with the append-only guard. `eraseContact` wraps it.        ║
 * ║  Integration tests exercise it. And its only callers were those tests —    ║
 * ║  no server action, no UI. A data subject could not have their data erased  ║
 * ║  because nothing in the product could ask.                                 ║
 * ║                                                                           ║
 * ║  This is the seventh instance of one defect in this codebase, and the      ║
 * ║  first with a statutory deadline attached: Art. 17 gives one month.        ║
 * ║                                                                           ║
 * ║  ⚠️ NEITHER EXISTING GUARD COULD SEE IT. `orphan-module.test.ts` works at  ║
 * ║  MODULE granularity and `lib/crm/activities.ts` has many other importers;  ║
 * ║  `action-reachability.test.ts` checks that server actions are called, and  ║
 * ║  there was no action to check. `tests/unit/test-only-export.test.ts` is    ║
 * ║  the guard for this shape.                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ GATED ON `crm.contact.delete`, WHICH IS THE STRONGEST CONTACT PERMISSION
 * THAT EXISTS — and erasure is stronger than deletion. A dedicated
 * `crm.contact.erase` would mean changing the permission matrix and every
 * role's grants, which is an owner decision rather than a detail of this
 * change. Recorded so it is a choice rather than an oversight.
 *
 * ⚠️ TYPED CONFIRMATION, NOT A `confirm()`. This is the only hard delete in the
 * CRM and it cannot be undone, so the person has to type the word. A dialog
 * someone dismisses by reflex is not consent to destroy a record.
 */
export async function eraseContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.contact.delete')

    const contactId = uuid.safeParse(formData.get('contact_id'))
    if (!contactId.success) return fail('That contact could not be read.')

    /*
     * The word is checked server-side. A client-side check is a courtesy to
     * the person typing; it is not a control, because the form is an HTTP
     * endpoint anybody can post to.
     */
    const confirmation = String(formData.get('confirm') ?? '').trim().toUpperCase()
    if (confirmation !== 'ERASE') {
      return fail('Type ERASE to confirm. This cannot be undone.')
    }

    const reason = String(formData.get('reason') ?? '').trim()
    if (reason.length > 500) return fail('That reason is too long.')

    /*
     * ⚠️ THE CONTACT MUST BE IN THIS WORKSPACE, CHECKED BEFORE THE RPC. The RPC
     * scopes by workspace itself, but a wrong id would otherwise report a
     * successful erasure of nothing — indistinguishable, to the person who
     * asked, from their request having been honoured.
     */
    const { data: contact } = await createAdminClient()
      .from('crm_contacts')
      .select('id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', contactId.data)
      .maybeSingle()

    if (!contact) return fail('That contact is not in this workspace.')

    const removed = await eraseContact(
      ctx.workspace.id,
      contactId.data,
      ctx.userId,
      reason || 'Right to erasure request',
    )

    const rows = Object.values(removed).reduce((sum, n) => sum + (Number(n) || 0), 0)

    /*
     * The contact page itself is gone, so the list is what the person returns
     * to. Revalidating the detail path as well keeps a cached copy of a
     * now-erased person from being served.
     */
    revalidatePath('/crm/contacts')
    revalidatePath(`/crm/contacts/${contactId.data}`)

    return ok(
      `Erased. ${rows} record${rows === 1 ? '' : 's'} destroyed; an audit entry proving the erasure remains.`,
    )
  } catch (error) {
    return toState(error)
  }
}

/**
 * Marks a person do-not-contact — §4.11.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `suppressContact` HAD EXISTED WITH ZERO CALLERS. Migration 0121        ║
 * ║  created `crm_contact_suppressions`, the writer was written, three readers ║
 * ║  were repaired to consult it — and nothing anywhere could put a row in.    ║
 * ║  The table was always empty, which is exactly why nobody noticed those     ║
 * ║  readers were wrong: they all agreed on nothing, correctly, by accident.   ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ `crm.contact.edit`, WHICH IS SETTER-LEVEL, AND THAT IS THE POINT. The
 * person who hears "take me off your list" is the one on the call. Requiring a
 * manager would mean the request waits, and a request to stop that waits is a
 * request that gets ignored.
 */
export async function markDoNotContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.contact.edit')

    const contactId = uuid.safeParse(formData.get('contact_id'))
    if (!contactId.success) return fail('That contact could not be read.')

    const scope = String(formData.get('scope') ?? 'all')
    if (!(STOP_SCOPES as readonly string[]).includes(scope)) {
      return fail('Choose what to stop.')
    }

    const reason = String(formData.get('reason') ?? 'manual')
    if (!(STOP_REASONS as readonly string[]).includes(reason)) {
      return fail('Choose a reason.')
    }

    const note = String(formData.get('note') ?? '').trim()
    if (note.length > 500) return fail('That note is too long.')

    /*
     * ⚠️ THE CONTACT MUST BE IN THIS WORKSPACE, CHECKED BEFORE THE WRITE. The
     * service role bypasses RLS, so without this a posted id from another
     * tenant would be marked — and the response would look identical to a
     * legitimate one. Same reasoning as `eraseContactAction`.
     */
    const { data: contact } = await createAdminClient()
      .from('crm_contacts')
      .select('id, full_name')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', contactId.data)
      .maybeSingle()

    if (!contact) return fail('That contact is not in this workspace.')

    await suppressContact({
      workspaceId: ctx.workspace.id,
      contactId: contactId.data,
      reason: reason as StopReason,
      scope: scope as 'all' | 'email' | 'linkedin',
      source: note || null,
      createdBy: ctx.userId,
    })

    revalidatePath(`/crm/contacts/${contactId.data}`)
    revalidatePath('/crm/contacts')

    const who = contact.full_name ?? 'This contact'
    return ok(
      scope === 'all'
        ? `${who} will not be contacted on any channel.`
        : `${who} will not be contacted by ${scope === 'email' ? 'email' : 'LinkedIn'}.`,
    )
  } catch (error) {
    return toState(error)
  }
}

/**
 * Lifts a do-not-contact.
 *
 * ⚠️ SAME PERMISSION AS MARKING, AND THE SAFEGUARD IS THE TYPED CONFIRMATION
 * RATHER THAN THE ROLE. Gating this behind manager would mean a setter who
 * mis-clicked cannot undo their own mistake until somebody senior is free,
 * while the contact sits uncontactable. Overloading `crm.contact.delete` to
 * stand in for "manager" would also quietly change what that permission means
 * the next time somebody edits the role table.
 */
export async function clearDoNotContactAction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  try {
    const ctx = await assertWorkspacePermission('crm.contact.edit')

    const contactId = uuid.safeParse(formData.get('contact_id'))
    if (!contactId.success) return fail('That contact could not be read.')

    // Checked server-side. The client-side copy is a courtesy; this is the
    // control, because the form is an HTTP endpoint anybody can post to.
    const confirmation = String(formData.get('confirm') ?? '').trim().toUpperCase()
    if (confirmation !== 'ALLOW') {
      return fail('Type ALLOW to confirm you may contact this person again.')
    }

    const { data: contact } = await createAdminClient()
      .from('crm_contacts')
      .select('id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', contactId.data)
      .maybeSingle()

    if (!contact) return fail('That contact is not in this workspace.')

    const lifted = await unsuppressContact({
      workspaceId: ctx.workspace.id,
      contactId: contactId.data,
    })

    if (!lifted) return fail('That contact was not marked do-not-contact.')

    revalidatePath(`/crm/contacts/${contactId.data}`)
    revalidatePath('/crm/contacts')

    /*
     * ⚠️ SAYS WHAT THIS DID NOT DO. If the person also unsubscribed themselves,
     * the address suppression still stands and mail will still refuse — which
     * would otherwise look like the button having failed.
     */
    return ok(
      'Do-not-contact lifted. Any unsubscribe the person made themselves still applies.',
    )
  } catch (error) {
    return toState(error)
  }
}
