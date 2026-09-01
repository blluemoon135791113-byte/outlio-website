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

import { FlowDefinitionError, validateFlowDefinition } from '@/lib/flows/definition'
import { flowTemplate } from '@/lib/flows/templates'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

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

  try {
    validateFlowDefinition(parsed)
  } catch (error) {
    if (error instanceof FlowDefinitionError) {
      // Every problem at once — one round trip should tell the author
      // everything to fix.
      return { ok: false, error: error.problems.join(' ') }
    }
    return { ok: false, error: 'That flow definition is not valid.' }
  }

  const { data: version, error } = await createAdminClient().rpc('flow_publish', {
    p_workspace_id: ctx.workspace.id,
    p_flow_id: flowId,
    p_definition: parsed as never,
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
