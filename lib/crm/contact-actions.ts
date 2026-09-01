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
