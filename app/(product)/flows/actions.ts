'use server'

/**
 * Flow surface actions — M7 UI.
 *
 * ⚠️ PUBLISHING IS THE ONLY WAY A FLOW BECOMES LIVE, and it validates first.
 * A definition that passes per-step checks but cannot terminate — a dangling
 * target, an unreachable step, a cycle with no wait — would strand a run at
 * execution time, when the contact is already halfway through. So
 * `validateFlowDefinition` runs before anything is written.
 */
import { revalidatePath } from 'next/cache'

import {
  FlowDefinitionError,
  definitionSendsEmail,
  publishProblems,
  stampSendAuthority,
  validateFlowDefinition,
} from '@/lib/flows/definition'
import { startRun } from '@/lib/flows/engine'
import { simulateFlow, type SimulationResult } from '@/lib/flows/simulate'
import { flowTemplate } from '@/lib/flows/templates'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export type ActionState = { ok: true; message: string } | { ok: false; error: string } | null

export async function createFlow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('flow.manage')
    const name = String(formData.get('name') ?? '').trim()
    if (!name) return { ok: false, error: 'Give the flow a name.' }

    const db = createAdminClient()

    const { data: flow, error } = await db
      .from('flows')
      .insert({
        workspace_id: ctx.workspace.id,
        name,
        description: String(formData.get('description') ?? '').trim() || null,
        created_by: ctx.userId,
      })
      .select('id')
      .single()

    if (error || !flow) return { ok: false, error: 'Could not create that flow.' }

    /*
     * ⚠️ A TEMPLATE BECOMES A DRAFT VERSION, NEVER A PUBLISHED ONE. Starting
     * from a template must not start it running: someone picking "Handle a
     * reply" to see what it looks like has not agreed to automate their inbox.
     * `published_at` stays null, so the flow sits as a draft exactly like one
     * built by hand.
     */
    const templateKey = String(formData.get('template') ?? '')
    if (templateKey) {
      const template = flowTemplate(templateKey)
      if (!template) return { ok: false, error: 'That template no longer exists.' }

      const { error: versionError } = await db.from('flow_versions').insert({
        workspace_id: ctx.workspace.id,
        flow_id: flow.id,
        version: 1,
        definition: template.definition as never,
        created_by: ctx.userId,
      })

      if (versionError) {
        return {
          ok: false,
          error: 'The flow was created but the template could not be applied.',
        }
      }

      revalidatePath('/flows')
      return {
        ok: true,
        message: `${name} created from “${template.name}”. Review it, then publish when you are happy.`,
      }
    }

    revalidatePath('/flows')
    return { ok: true, message: `${name} created as a draft. Nothing runs until you publish it.` }
  } catch {
    return { ok: false, error: 'You do not have permission to create flows.' }
  }
}

/**
 * Publishes a definition.
 *
 * ⚠️ CREATES A NEW IMMUTABLE VERSION. Runs already in flight keep executing the
 * version they pinned at start (M7 criterion 3), so editing a live flow can
 * never rewrite what a half-finished run does next.
 */
export async function publishFlow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let ctx
  try {
    /*
     * ⚠️ `flow.manage`, NOT a separate publish permission. The M1 catalogue has
     * `flow.view` and `flow.manage`, and adding a third mid-build would be a
     * unilateral change to the permission model. It is also unnecessary: the
     * genuinely dangerous capability — actually sending mail — is gated
     * independently by the six-condition send gate, which requires
     * `actorAuthorized` on the step rather than trusting the flow's publisher.
     */
    ctx = await assertWorkspacePermission('flow.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to publish flows.' }
  }

  const flowId = String(formData.get('flowId') ?? '')
  const raw = String(formData.get('definition') ?? '')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'That is not valid JSON.' }
  }

  let definition
  try {
    definition = validateFlowDefinition(parsed)
  } catch (error) {
    if (error instanceof FlowDefinitionError) {
      // Every problem at once — one round trip should tell the author
      // everything to fix.
      return { ok: false, error: error.problems.join(' ') }
    }
    return { ok: false, error: 'That flow definition is not valid.' }
  }

  /*
   * ⚠️ REFUSED HERE, NOT DISCOVERED IN A FAILED RUN.
   *
   * A step whose required config is blank can only ever fail. Observed in
   * production: an ASSIGN_OWNER step with `userId: ""` published cleanly, ran
   * on a real contact and died at step one — and the only trace was a failed
   * run nobody was watching, so the flow looked like it was working.
   *
   * Deliberately NOT part of `validateFlowDefinition`: that also parses
   * definitions already stored, and tightening it would retroactively break
   * flows published before this check existed.
   */
  const blockers = publishProblems(definition)
  if (blockers.length > 0) {
    return { ok: false, error: blockers.join(' ') }
  }

  /*
   * ⚠️ SEND AUTHORITY IS STAMPED HERE, AND IS NOT AN EDITOR FIELD.
   *
   * `sendEmail` reads `config.actorAuthorized === true` and the gate fails
   * closed. Nothing wrote that key anywhere in the product, so every SEND_EMAIL
   * step refused at condition one with "this flow runs as someone who is not
   * allowed to send email" — a flow could never send mail at all.
   *
   * A checkbox would be self-certification: anyone who can open the builder
   * could tick it, which is exactly what the gate exists to prevent. Authority
   * is a fact about the PUBLISHER, so it is read from the permission catalogue
   * at the moment of publishing — and re-stamped on every publish, so revoking
   * someone's access takes effect on the next version instead of being frozen
   * in at version one.
   */
  const publisherMaySend = can(
    { role: ctx.role, modules: ctx.modules },
    'email.campaign.launch',
  )

  if (definitionSendsEmail(definition) && !publisherMaySend) {
    /*
     * Refused rather than published-and-broken. Publishing it would stamp
     * `false`, and the flow would then fail on every contact it touched —
     * the same "publishable but can only fail" shape as a blank assignee.
     */
    return {
      ok: false,
      error:
        'This flow sends email, and you do not have permission to launch email. Ask an admin to publish it, or remove the send step.',
    }
  }

  const authorized = stampSendAuthority(definition, publisherMaySend)

  const { data: version, error } = await createAdminClient().rpc('flow_publish', {
    p_workspace_id: ctx.workspace.id,
    p_flow_id: flowId,
    /*
     * ⚠️ THE STAMPED DEFINITION, NOT THE RAW ONE. Passing `parsed` here would
     * store exactly what the browser sent — discarding the authority stamp and
     * restoring the bug this block exists to fix.
     */
    p_definition: authorized as never,
    p_created_by: ctx.userId,
  })

  if (error || !version) return { ok: false, error: 'Could not publish that flow.' }

  revalidatePath(`/flows/${flowId}`)
  return { ok: true, message: 'Published. Runs already in progress finish on the old version.' }
}

/**
 * Pauses a flow.
 *
 * ⚠️ PAUSING STOPS NEW RUNS, not runs already going. Stopping mid-run would
 * leave contacts halfway through a sequence with no record of why — the
 * existing runs finish, and nothing new starts.
 */
export async function pauseFlow(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await assertWorkspacePermission('flow.manage')
    const flowId = String(formData.get('flowId') ?? '')
    const next = String(formData.get('next') ?? 'paused')

    await createAdminClient()
      .from('flows')
      .update({ status: next === 'published' ? 'published' : 'paused' })
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', flowId)

    revalidatePath(`/flows/${flowId}`)
    return {
      ok: true,
      message:
        next === 'published'
          ? 'Live again. New triggers will start runs.'
          : 'Paused. Runs already in progress will finish; nothing new will start.',
    }
  } catch {
    return { ok: false, error: 'Could not change that flow.' }
  }
}

// ---------------------------------------------------------------------------
// Running a flow by hand — R8 (the `manual` trigger)
// ---------------------------------------------------------------------------

export type ManualRunState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

/**
 * Starts one run of a manually-triggered flow against one contact.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS IS NOT TEST MODE, AND MUST NOT BE MISTAKEN FOR IT.              ║
 * ║                                                                           ║
 * ║  Every action runs FOR REAL: tasks are created, owners are assigned,      ║
 * ║  notifications are sent. The brief's test mode — where destructive steps  ║
 * ║  are simulated — needs a simulate path through the action registry and is ║
 * ║  recorded as deferred. Calling this "test" would be the dangerous lie:    ║
 * ║  someone would try it on a real contact expecting nothing to happen.      ║
 * ║                                                                           ║
 * ║  ⚠️ ONLY FLOWS WHOSE TRIGGER IS `manual`. Running a `contact_created`     ║
 * ║  flow by hand would fire real actions against someone the flow was never  ║
 * ║  meant to touch — and the person clicking would reasonably expect a       ║
 * ║  rehearsal, not a live run.                                               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function runFlowManually(
  _previous: ManualRunState,
  formData: FormData,
): Promise<ManualRunState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('flow.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to run flows.' }
  }

  const flowId = String(formData.get('flowId') ?? '')
  const contactId = String(formData.get('contactId') ?? '')
  if (!contactId) return { ok: false, error: 'Choose a contact to run it against.' }

  const db = createAdminClient()

  // Scoped by workspace in code — an id from a form is a claim, not authority.
  const { data: flow } = await db
    .from('flows')
    .select('id, name, status, published_version_id, flow_versions!flows_published_version_fk(definition)')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', flowId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!flow) return { ok: false, error: 'That flow no longer exists.' }

  if (flow.status !== 'published' || !flow.published_version_id) {
    return { ok: false, error: 'Publish the flow before running it.' }
  }

  const definition = (flow.flow_versions as { definition?: { trigger?: { type?: string } } } | null)
    ?.definition

  if (definition?.trigger?.type !== 'manual') {
    return {
      ok: false,
      error:
        'This flow runs on its own trigger, not by hand. Only a flow whose trigger is “manual” can be started here.',
    }
  }

  const { data: contact } = await db
    .from('crm_contacts')
    .select('id, full_name')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }

  try {
    const result = await startRun({
      workspaceId: ctx.workspace.id,
      flowId: flow.id,
      triggerType: 'manual',
      contactId: contact.id,
      /*
       * ⚠️ THE TIMESTAMP IS PART OF THE KEY, deliberately — unlike every other
       * trigger. Running a flow by hand twice is two intentional acts, and
       * de-duplicating them would silently ignore the second click and look
       * like a broken button.
       */
      idempotencyKey: `manual:${flow.id}:${contact.id}:${Date.now()}`,
    })

    revalidatePath(`/flows/${flow.id}`)

    if (!result.started) {
      const explain: Record<string, string> = {
        not_published: 'Publish the flow before running it.',
        duplicate: 'That run has already been started.',
        halted: `Stopped by a safety limit: ${result.detail}`,
      }
      return { ok: false, error: explain[result.reason] ?? 'That run could not start.' }
    }

    return {
      ok: true,
      message: `Started against ${contact.full_name ?? 'that contact'}. Every step runs for real — watch the run history below.`,
    }
  } catch {
    return { ok: false, error: 'That run could not start.' }
  }
}

// ---------------------------------------------------------------------------
// Test mode — R9
// ---------------------------------------------------------------------------

export type SimulateState =
  | { ok: true; result: SimulationResult; contactName: string }
  | { ok: false; error: string }
  | null

/**
 * Dry-runs a flow against one contact.
 *
 * ⚠️ WRITES NOTHING AND CALLS NO HANDLER. Unlike `runFlowManually`, which is a
 * real run wearing a plain name, this is the rehearsal — and it works on a
 * DRAFT as well as a published flow, because rehearsing before you publish is
 * the entire point.
 */
export async function simulateFlowAction(
  _previous: SimulateState,
  formData: FormData,
): Promise<SimulateState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('flow.manage')
  } catch {
    return { ok: false, error: 'You do not have permission to test flows.' }
  }

  const flowId = String(formData.get('flowId') ?? '')
  const contactId = String(formData.get('contactId') ?? '') || null

  const db = createAdminClient()

  // Scoped by workspace in code — an id from a form is a claim.
  const { data: flow } = await db
    .from('flows')
    .select('id, published_version_id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', flowId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!flow) return { ok: false, error: 'That flow no longer exists.' }

  /*
   * The published version if there is one, otherwise the newest draft. Testing
   * an unpublished flow is the case that matters most: it is how someone finds
   * out the branch goes the wrong way BEFORE it runs on anybody.
   */
  const { data: version } = await db
    .from('flow_versions')
    .select('definition')
    .eq('workspace_id', ctx.workspace.id)
    .eq('flow_id', flow.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!version) return { ok: false, error: 'This flow has no steps to test yet.' }

  let definition
  try {
    definition = validateFlowDefinition(version.definition)
  } catch {
    return { ok: false, error: 'This flow’s steps are not valid yet, so it cannot be tested.' }
  }

  let contactName = 'no contact'
  if (contactId) {
    const { data: contact } = await db
      .from('crm_contacts')
      .select('id, full_name')
      .eq('workspace_id', ctx.workspace.id)
      .eq('id', contactId)
      .is('deleted_at', null)
      .maybeSingle()

    if (!contact) return { ok: false, error: 'That contact is not in this workspace.' }
    contactName = contact.full_name ?? 'that contact'
  }

  const result = await simulateFlow({
    workspaceId: ctx.workspace.id,
    definition,
    contactId,
  })

  return { ok: true, result, contactName }
}
