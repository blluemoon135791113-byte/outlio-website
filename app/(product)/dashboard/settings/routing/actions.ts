'use server'

/**
 * Lead routing settings — the actions behind the rules, availability and the
 * Unassigned queue.
 *
 * ⚠️ EVERY ACTION GATES ON `crm.routing.manage` IN ITS OWN BODY. A server
 * action is a public HTTP endpoint; a manager who can see this page, or anyone
 * who knows an action id, reaches the action whether or not a button was drawn.
 */
import { revalidatePath } from 'next/cache'

import {
  RoutingRuleError,
  createRule,
  deleteRule,
  moveRule,
  routeContactAgain,
  setAwayUntil,
  setRuleStatus,
  updateRule,
  type RuleInput,
} from '@/lib/crm/routing-rules'
import { describeDecision, type RoutingRuleKind, type RoutingSource } from '@/lib/crm/routing-copy'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type RoutingActionState = { ok: true; message: string } | { ok: false; error: string } | null

const PATH = '/dashboard/settings/routing'
const AWAY_MAX_MS = 2 * 365 * 24 * 60 * 60 * 1000

const denied = (): RoutingActionState => ({
  ok: false,
  error: 'Only a workspace admin can change lead routing.',
})

/**
 * ⚠️ ONLY A `RoutingRuleError` REACHES THE SCREEN. Its message was written for
 * the person who caused it. Anything else is a bug or an outage, and a raw
 * database message is not for a customer.
 */
function failure(error: unknown, fallback: string): RoutingActionState {
  return { ok: false, error: error instanceof RoutingRuleError ? error.message : fallback }
}

/**
 * Reads a rule from a form. The field names are what `RoutingSettings` submits.
 *
 * An unparseable cap is refused rather than read as "no cap": a person who typed
 * "ten" meant a limit, and silently removing the limit is the opposite.
 *
 * ⚠️ NOT EXPORTED, AND NOT ASYNC. Every exported async function in a
 * 'use server' file becomes a public server action with its own endpoint — the
 * first version exported this one, and the authorization guard correctly
 * reported an endpoint that checks nobody's permission.
 */
function readRuleForm(formData: FormData): RuleInput | { error: string } {
  const rawCap = String(formData.get('maxOpenWorkload') ?? '').trim()
  let maxOpenWorkload: number | null = null
  if (rawCap !== '') {
    const cap = Number(rawCap)
    if (!Number.isInteger(cap)) return { error: 'The cap must be a whole number, or left empty for no cap.' }
    maxOpenWorkload = cap
  }

  return {
    name: String(formData.get('name') ?? ''),
    kind: String(formData.get('kind') ?? '') as RoutingRuleKind,
    sources: formData.getAll('sources').map(String) as RoutingSource[],
    userId: String(formData.get('userId') ?? '') || null,
    memberIds: formData.getAll('memberIds').map(String).filter(Boolean),
    maxOpenWorkload,
  }
}

export async function createRoutingRuleAction(
  _previous: RoutingActionState,
  formData: FormData,
): Promise<RoutingActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.routing.manage')
  } catch {
    return denied()
  }

  const input = readRuleForm(formData)
  if ('error' in input) return { ok: false, error: input.error }

  try {
    await createRule(ctx.workspace.id, ctx.userId!, input)
    revalidatePath(PATH)
    return { ok: true, message: 'Saved as a draft. It routes nothing until you put it live.' }
  } catch (error) {
    return failure(error, 'Could not save that rule.')
  }
}

export async function updateRoutingRuleAction(
  _previous: RoutingActionState,
  formData: FormData,
): Promise<RoutingActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.routing.manage')
  } catch {
    return denied()
  }

  const ruleId = String(formData.get('ruleId') ?? '')
  const version = Number(formData.get('version'))
  if (!ruleId || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'Reload the page and try again.' }
  }

  const input = readRuleForm(formData)
  if ('error' in input) return { ok: false, error: input.error }

  try {
    await updateRule(ctx.workspace.id, ctx.userId!, ruleId, version, input)
    revalidatePath(PATH)
    return { ok: true, message: 'Saved.' }
  } catch (error) {
    return failure(error, 'Could not save that rule.')
  }
}

const STATUS_MESSAGE = {
  published: 'Live. New leads from its sources are routed by it.',
  draft: 'Taken offline. It routes nothing until you put it live again.',
  archived: 'Archived. Its past decisions are kept.',
} as const

export async function setRoutingRuleStatusAction(
  _previous: RoutingActionState,
  formData: FormData,
): Promise<RoutingActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.routing.manage')
  } catch {
    return denied()
  }

  const ruleId = String(formData.get('ruleId') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!ruleId || !(status === 'published' || status === 'draft' || status === 'archived')) {
    return { ok: false, error: 'Reload the page and try again.' }
  }

  try {
    await setRuleStatus(ctx.workspace.id, ctx.userId!, ruleId, status)
    revalidatePath(PATH)
    return { ok: true, message: STATUS_MESSAGE[status] }
  } catch (error) {
    return failure(error, 'Could not change that rule.')
  }
}

export async function moveRoutingRuleAction(
  _previous: RoutingActionState,
  formData: FormData,
): Promise<RoutingActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.routing.manage')
  } catch {
    return denied()
  }

  const ruleId = String(formData.get('ruleId') ?? '')
  const direction = String(formData.get('direction') ?? '')
  if (!ruleId || !(direction === 'up' || direction === 'down')) {
    return { ok: false, error: 'Reload the page and try again.' }
  }

  try {
    await moveRule(ctx.workspace.id, ctx.userId!, ruleId, direction)
    revalidatePath(PATH)
    return { ok: true, message: 'Moved.' }
  } catch (error) {
    return failure(error, 'Could not move that rule.')
  }
}

export async function deleteRoutingRuleAction(
  _previous: RoutingActionState,
  formData: FormData,
): Promise<RoutingActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.routing.manage')
  } catch {
    return denied()
  }

  const ruleId = String(formData.get('ruleId') ?? '')
  if (!ruleId) return { ok: false, error: 'Reload the page and try again.' }

  try {
    await deleteRule(ctx.workspace.id, ctx.userId!, ruleId)
    revalidatePath(PATH)
    return { ok: true, message: 'Deleted. The leads it already placed keep their owners and their history.' }
  } catch (error) {
    return failure(error, 'Could not delete that rule.')
  }
}

export async function setMemberAwayAction(
  _previous: RoutingActionState,
  formData: FormData,
): Promise<RoutingActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.routing.manage')
  } catch {
    return denied()
  }

  const userId = String(formData.get('userId') ?? '')
  if (!userId) return { ok: false, error: 'Reload the page and try again.' }

  /*
   * An empty date means available again. A date means away until the START of
   * that day, read in the server's timezone — the same rule snooze uses,
   * because no user or workspace timezone exists to read.
   */
  const raw = String(formData.get('awayUntil') ?? '').trim()
  let awayUntil: string | null = null
  if (raw !== '') {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : null
    if (!at || Number.isNaN(at.getTime())) return { ok: false, error: 'Pick a return date.' }
    if (at.getTime() <= Date.now() || at.getTime() > Date.now() + AWAY_MAX_MS) {
      return { ok: false, error: 'Pick a return date after today and within two years, or clear it.' }
    }
    awayUntil = at.toISOString()
  }

  try {
    await setAwayUntil(ctx.workspace.id, ctx.userId!, userId, awayUntil)
    revalidatePath(PATH)
    return { ok: true, message: awayUntil ? 'Marked away. They receive no routed leads until then.' : 'Available for routed leads.' }
  } catch (error) {
    return failure(error, 'Could not change their availability.')
  }
}

export async function routeContactAgainAction(
  _previous: RoutingActionState,
  formData: FormData,
): Promise<RoutingActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('crm.routing.manage')
  } catch {
    return denied()
  }

  const contactId = String(formData.get('contactId') ?? '')
  if (!contactId) return { ok: false, error: 'Reload the page and try again.' }

  try {
    const result = await routeContactAgain(ctx.workspace.id, contactId)
    revalidatePath(PATH)
    if (result.outcome === 'assigned') return { ok: true, message: 'Routed to an owner.' }
    return { ok: false, error: `Still waiting. ${describeDecision(result.reason)}` }
  } catch (error) {
    return failure(error, 'Could not route that lead.')
  }
}
