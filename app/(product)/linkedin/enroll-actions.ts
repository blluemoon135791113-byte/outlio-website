'use server'

/**
 * Starting a LinkedIn sequence for one contact.
 *
 * ⚠️ ENROLLING IS NOT CONTACTING. This writes an enrollment row and a PENDING
 * card. Nothing reaches LinkedIn here or anywhere — CLAUDE.md rule 1.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { buildLinkedInContext, type RecordSource } from '@/lib/linkedin/context'
import { enrollContact } from '@/lib/linkedin/enroll'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type EnrollActionState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

const uuid = z.string().uuid()

export async function enrollContactAction(
  _previous: EnrollActionState,
  formData: FormData,
): Promise<EnrollActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.contact.edit')
  } catch {
    return { ok: false, error: 'You do not have access to this workspace.' }
  }

  if (!ctx.modules.has('linkedin')) {
    return { ok: false, error: 'The LinkedIn channel is not enabled on your plan.' }
  }

  const contactId = uuid.safeParse(formData.get('contactId'))
  const senderId = uuid.safeParse(formData.get('senderId'))
  if (!contactId.success) return { ok: false, error: 'Could not tell which contact you meant.' }
  if (!senderId.success) return { ok: false, error: 'Choose which account to send from.' }

  const topic = String(formData.get('topic') ?? '').trim()
  const manualBody = String(formData.get('manualBody') ?? '').trim() || null

  if (!topic) {
    // §4.9 marks `topic` required at publication — it is the customer's own
    // plain-language problem statement, and nothing can stand in for it.
    return { ok: false, error: 'Say what this is about, in your own words.' }
  }

  const db = createAdminClient()

  /*
   * ⚠️ THE FACTS ARE READ HERE AND NAMED EXPLICITLY. `buildLinkedInContext`
   * takes a narrow shape rather than the contact row, so a column added to
   * `crm_contacts` later cannot silently start feeding a message.
   */
  const { data: contact } = await db
    .from('crm_contacts')
    .select('source, first_name, full_name, job_title, headline')
    // Service role bypasses RLS — scoping by workspace is mandatory.
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', contactId.data)
    .is('deleted_at', null)
    .maybeSingle()

  if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }

  const context = buildLinkedInContext({
    contact: {
      source: contact.source as RecordSource,
      firstName: contact.first_name,
      fullName: contact.full_name,
      jobTitle: contact.job_title,
      headline: contact.headline,
    },
    campaign: { topic },
  })

  const result = await enrollContact({
    workspaceId: ctx.workspace.id,
    contactId: contactId.data,
    senderId: senderId.data,
    templateId: 'T01',
    context,
    manualBody,
    actorUserId: ctx.userId,
  })

  if (!result.ok) return { ok: false, error: result.message }

  revalidatePath(`/crm/contacts/${contactId.data}`)
  revalidatePath('/linkedin')
  return { ok: true, message: 'Added. The first task is in your LinkedIn inbox.' }
}
