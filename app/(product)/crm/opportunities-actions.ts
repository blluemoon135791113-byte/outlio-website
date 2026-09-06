'use server'

/**
 * Creating an opportunity — R4.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `createOpportunity` SHIPPED WITH M3 AND NOTHING EVER CALLED IT.         ║
 * ║                                                                           ║
 * ║  A CRM whose central object cannot be created is not a CRM. This is the   ║
 * ║  second of the six engines the R0 audit found stranded.                   ║
 * ║                                                                           ║
 * ║  ⚠️ LIVES AT THE CRM ROOT, NOT UNDER /pipeline, because the brief lists   ║
 * ║  eight creation sources — contact detail, the board, bulk actions, CSV,   ║
 * ║  Lead Engine, flows, the API. Burying it under one route would mean the   ║
 * ║  next caller copies it rather than imports it.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { revalidatePath } from 'next/cache'

import { createOpportunity } from '@/lib/crm/opportunities'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type OpportunityActionState =
  | { ok: true; message: string; opportunityId?: string }
  | { ok: false; error: string }
  | null

export async function createOpportunityAction(
  _previous: OpportunityActionState,
  formData: FormData,
): Promise<OpportunityActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.opportunity.create')
  } catch {
    return { ok: false, error: 'You do not have permission to create deals.' }
  }

  const title = String(formData.get('title') ?? '').trim()
  const pipelineId = String(formData.get('pipelineId') ?? '')
  const stageId = String(formData.get('stageId') ?? '') || undefined
  const contactId = String(formData.get('contactId') ?? '') || null

  if (!title) return { ok: false, error: 'Give the deal a name.' }
  if (!pipelineId) return { ok: false, error: 'Choose a pipeline.' }

  /*
   * ⚠️ THE VALUE IS PARSED, NOT TRUSTED. An empty field must mean "unknown"
   * and become NULL — not zero. A deal worth £0 and a deal whose value nobody
   * has filled in are different things, and every forecast that sums them
   * would quietly under-report if they were the same (CLAUDE.md rule 4).
   */
  const rawValue = String(formData.get('valueAmount') ?? '').trim()
  const valueAmount = rawValue === '' ? null : Number(rawValue)
  if (valueAmount !== null && (!Number.isFinite(valueAmount) || valueAmount < 0)) {
    return { ok: false, error: 'The value must be a number, or left blank.' }
  }

  const expectedClose = String(formData.get('expectedCloseDate') ?? '').trim() || null

  const db = createAdminClient()

  /*
   * ⚠️ THE CONTACT IS VERIFIED TO BE IN THIS WORKSPACE. An id arriving from a
   * form is a claim, and the service role bypasses RLS — without this, a
   * crafted request could attach someone else's contact to a deal here.
   */
  let companyId: string | null = null
  if (contactId) {
    const { data: contact } = await db
      .from('crm_contacts')
      .select('id, primary_company_id, owner_user_id')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', contactId)
      .maybeSingle()

    if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }
    // Carried across so the deal inherits the company without asking again.
    companyId = contact.primary_company_id
  }

  try {
    const opportunityId = await createOpportunity(
      ctx.workspace.id,
      {
        title,
        pipelineId,
        stageId,
        contactId,
        companyId,
        /*
         * Defaults to the creator. The brief is explicit that a contact owner
         * and a deal owner need not be the same person, so this is a default
         * and not a rule — it stays editable afterwards.
         */
        ownerUserId: ctx.userId,
        valueAmount,
        expectedCloseDate: expectedClose,
      },
      ctx.userId,
    )

    /*
     * ⚠️ NO ACTIVITY IS RECORDED HERE, AND THAT IS DELIBERATE.
     *
     * `crm_activity_type` has no OPPORTUNITY_CREATED value — only WON, LOST
     * and STAGE_CHANGED. Inventing one needs a migration, and reusing a
     * neighbouring value to keep a comment honest would poison every report
     * that reads it.
     *
     * It is not needed: `crm_batch_funnel` (0083) counts opportunities from
     * `crm_opportunities` directly, not from the event stream, so the batch
     * that produced a deal is still credited with the revenue.
     *
     * ⚠️ This is a genuine inconsistency with the constitution's "ALL metrics
     * derive from events", and it predates this phase. Recorded rather than
     * papered over.
     */
    revalidatePath('/crm/pipeline')
    revalidatePath('/dashboard')
    return { ok: true, message: `${title} added.`, opportunityId }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('has no stages')) {
      return { ok: false, error: 'That pipeline has no stages yet.' }
    }
    return { ok: false, error: 'Could not create that deal.' }
  }
}
