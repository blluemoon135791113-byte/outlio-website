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

import { assertAccountPermission, canSeeAccount } from '@/lib/crm/account-access'
import { openStageChoices } from '@/lib/crm/account-deals'
import { recordAudit } from '@/lib/crm/activities'
import { isOfferedCurrency } from '@/lib/crm/currencies'
import { createOpportunity } from '@/lib/crm/opportunities'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { dataScope } from '@/lib/workspaces/permissions'

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

  const money = dealMoneyFields(formData)
  if ('error' in money) return { ok: false, error: money.error }
  const { valueAmount, currency, expectedClose } = money

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
      .is('deleted_at', null)
      .maybeSingle()

    // A deleted contact, or (for a setter) a colleague's, is "not here" — the
    // same answer, so the id cannot be probed.
    const visible = contact && (dataScope(ctx.role) === 'all' || contact.owner_user_id === ctx.userId)
    if (!visible) return { ok: false, error: 'That contact is not in this workspace.' }
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
        currency,
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

/**
 * "New deal" on an account page: a deal FOR THE ACCOUNT, with a person at it
 * optionally.
 *
 * ⚠️ A SECOND OPEN DEAL FOR THE SAME ACCOUNT IS ALLOWED HERE, DELIBERATELY.
 * An upsell or a renewal beside a live deal is real, and a person typing one
 * in means it. Bulk "Move to pipeline" skips accounts already in the pipeline
 * because it answers a different question — "put these accounts in the
 * pipeline" — where a second deal would be an accident. (The submit button is
 * disabled while a request is pending, so a double-click does not repeat it.)
 *
 * ⚠️ EVERY ID IS A CLAIM. The account must be one the caller may see (the
 * account rule); the stage must be an OPEN stage of a live pipeline in this
 * workspace (the pipeline is derived from it, never taken from the form); a
 * person must work at THIS account and be someone the caller may see.
 */
export async function createAccountDealAction(
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
  const companyId = String(formData.get('companyId') ?? '')
  const stageId = String(formData.get('stageId') ?? '')
  const contactId = String(formData.get('contactId') ?? '') || null

  if (!title) return { ok: false, error: 'Give the deal a name.' }
  if (title.length > 200) return { ok: false, error: 'Keep the deal name under 200 characters.' }
  if (!stageId) return { ok: false, error: 'Choose a pipeline stage.' }

  const money = dealMoneyFields(formData)
  if ('error' in money) return { ok: false, error: money.error }

  try {
    const access = await assertAccountPermission(null)
    if (access.ctx.workspace.id !== ctx.workspace.id || !(await canSeeAccount(access, companyId))) {
      return { ok: false, error: 'That account could not be found.' }
    }

    const stage = (await openStageChoices(ctx.workspace.id)).find((s) => s.stageId === stageId)
    if (!stage) return { ok: false, error: 'That stage is no longer available. Refresh and try again.' }

    if (contactId) {
      const { data: contact, error } = await createAdminClient()
        .from('crm_contacts')
        .select('primary_company_id, owner_user_id')
        .eq('workspace_id', ctx.workspace.id)
        .eq('id', contactId)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw new Error(`createAccountDealAction failed: ${error.message}`)
      const visible =
        contact && (dataScope(ctx.role) === 'all' || contact.owner_user_id === ctx.userId)
      if (!visible || contact.primary_company_id !== companyId) {
        return { ok: false, error: 'That person is not at this account.' }
      }
    }

    const opportunityId = await createOpportunity(
      ctx.workspace.id,
      {
        title,
        pipelineId: stage.pipelineId,
        stageId: stage.stageId,
        contactId,
        companyId,
        ownerUserId: ctx.userId,
        valueAmount: money.valueAmount,
        currency: money.currency,
        expectedCloseDate: money.expectedClose,
      },
      ctx.userId,
    )

    // After the commit: an audit failure is logged, never reported as a failed add.
    try {
      await recordAudit(ctx.workspace.id, {
        action: 'crm.account.deal_created',
        targetType: 'crm_opportunity',
        targetId: opportunityId,
        actorUserId: ctx.userId,
        after: { companyId, stageId: stage.stageId, contactId },
      })
    } catch (error) {
      console.error('[createAccountDealAction] audit', error instanceof Error ? error.message : 'unknown error')
    }

    revalidatePath(`/crm/companies/${companyId}`)
    revalidatePath('/crm/pipeline')
    revalidatePath('/dashboard')
    return { ok: true, message: `${title} added to ${stage.label}.`, opportunityId }
  } catch (error) {
    console.error('[createAccountDealAction]', error instanceof Error ? error.message : 'unknown error')
    return { ok: false, error: 'Could not create that deal.' }
  }
}

/** Value, currency and close date, parsed the same way for every deal form. */
function dealMoneyFields(
  formData: FormData,
): { valueAmount: number | null; currency: string | undefined; expectedClose: string | null } | { error: string } {
  /*
   * ⚠️ THE VALUE IS PARSED, NOT TRUSTED. An empty field must mean "unknown"
   * and become NULL — not zero. A deal worth £0 and a deal whose value nobody
   * has filled in are different things, and every forecast that sums them
   * would quietly under-report if they were the same (CLAUDE.md rule 4).
   */
  const rawValue = String(formData.get('valueAmount') ?? '').trim()
  const valueAmount = rawValue === '' ? null : Number(rawValue)
  if (valueAmount !== null && (!Number.isFinite(valueAmount) || valueAmount < 0)) {
    return { error: 'The value must be a number, or left blank.' }
  }
  // numeric(14,2): anything larger is refused by the column, not rounded.
  if (valueAmount !== null && valueAmount >= 1e12) {
    return { error: 'That value is too large.' }
  }

  /*
   * ⚠️ VALIDATED AGAINST THE OFFERED SET, NOT JUST THE SHAPE. A server action is
   * a public HTTP endpoint, so `^[A-Z]{3}$` alone would accept any three
   * letters — and a code the rate feed cannot quote does not fail loudly: the
   * deal saves with a NULL rate and quietly drops out of every total.
   *
   * ⚠️ BLANK MEANS "THE WORKSPACE'S", NOT "USD". `createOpportunity` resolves
   * that; hardcoding a fallback here would put the decision in two places and
   * let them disagree.
   */
  const rawCurrency = String(formData.get('currency') ?? '').trim()
  if (rawCurrency && !isOfferedCurrency(rawCurrency)) {
    return { error: 'Choose a currency from the list.' }
  }
  const currency = rawCurrency ? rawCurrency.toUpperCase() : undefined

  const expectedClose = String(formData.get('expectedCloseDate') ?? '').trim() || null
  if (expectedClose !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expectedClose)) {
    return { error: 'Choose the expected close date from the calendar.' }
  }
  return { valueAmount, currency, expectedClose }
}
