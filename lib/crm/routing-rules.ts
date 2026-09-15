import 'server-only'

/**
 * Routing rules, member availability and the Unassigned queue — the settings
 * side of intake routing (0127).
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE ENGINE HAS BEEN LIVE SINCE #32 WITH NO WAY TO GIVE IT A RULE.        ║
 * ║                                                                           ║
 * ║  Every imported lead has been landing unassigned with `no_rule_matched`.  ║
 * ║  This is how a rule gets written, put live, reordered and retired; how    ║
 * ║  someone is marked away; and how an admin sees what routing could not     ║
 * ║  place and why.                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NOTHING HERE DECIDES ACCESS. Callers pass `crm.routing.manage` first. Every
 * query is scoped by `workspace_id` in code: the service role bypasses RLS.
 *
 * ⚠️ EVERY CONFIGURATION CHANGE IS AUDITED. A routing rule decides who is paid
 * for which leads; "who changed the rule and when" is a question someone will
 * ask, and `crm_routing_decisions` answers only what the rules did, not who
 * wrote them.
 */
import { z } from 'zod'

import { recordAudit } from '@/lib/crm/activities'
import {
  ROUTING_RULE_KINDS,
  ROUTING_SOURCES,
  type RoutingRuleKind,
  type RoutingRuleStatus,
  type RoutingSource,
} from '@/lib/crm/routing-copy'
import { emitDomainEvent } from '@/lib/events/emit'
import { createAdminClient } from '@/lib/supabase/admin'

/** A failure whose message is written for the person who caused it. */
export class RoutingRuleError extends Error {}

export type RoutingRule = {
  id: string
  name: string
  position: number
  kind: RoutingRuleKind
  sources: RoutingSource[]
  userId: string | null
  memberIds: string[]
  maxOpenWorkload: number | null
  status: RoutingRuleStatus
  version: number
  publishedAt: string | null
}

export type RuleInput = {
  name: string
  kind: RoutingRuleKind
  sources: RoutingSource[]
  userId: string | null
  memberIds: string[]
  maxOpenWorkload: number | null
}

export type AvailabilityRow = {
  userId: string
  name: string
  role: string
  awayUntil: string | null
}

export type QueueItem = {
  contactId: string
  name: string
  reason: string
  /** What each rule said, in the order they were tried. */
  evaluated: { kind: string | null; reason: string }[]
  decidedAt: string
}

export type ReroutingResult = { outcome: 'assigned' | 'unassigned' | 'already_owned'; reason: string }

const MAX_WORKLOAD = 100_000

/*
 * ⚠️ THE SHAPE IS CHECKED HERE AND AGAIN BY 0127's CONSTRAINTS. The constraint
 * is the guarantee; this is the part that can say which field was wrong. Fields
 * belonging to another kind are dropped BEFORE validation, because the form
 * keeps a person picked under "One named person" after someone switches to
 * "Shared across people", and refusing that hidden value would be an error the
 * person cannot see.
 */
const ruleShape = z
  .object({
    name: z.string().trim().min(1, 'Give the rule a name.').max(120, 'Keep the name under 120 characters.'),
    kind: z.enum(ROUTING_RULE_KINDS),
    sources: z.array(z.enum(ROUTING_SOURCES)).min(1, 'Choose at least one source for the rule to route.'),
    userId: z.string().uuid().nullable(),
    memberIds: z.array(z.string().uuid()).max(100, 'A shared rule can list at most 100 people.'),
    maxOpenWorkload: z
      .number()
      .int('The cap must be a whole number.')
      .min(1, 'The cap must be at least 1.')
      .max(MAX_WORKLOAD, 'That cap is too large.')
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'named_user' && !value.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose the person this rule sends leads to.' })
    }
    if (value.kind === 'pool' && value.memberIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose at least one person to share leads across.' })
    }
  })

export function normaliseRuleInput(input: RuleInput): RuleInput {
  const base = {
    ...input,
    // A source listed twice is the same source.
    sources: [...new Set(input.sources)],
    memberIds: [...new Set(input.memberIds)],
  }
  if (input.kind === 'company_owner') return { ...base, userId: null, memberIds: [] }
  if (input.kind === 'named_user') return { ...base, memberIds: [] }
  return { ...base, userId: null }
}

export function validateRuleInput(input: RuleInput): RuleInput {
  const normalised = normaliseRuleInput(input)
  const parsed = ruleShape.safeParse(normalised)
  if (!parsed.success) {
    throw new RoutingRuleError(parsed.error.issues[0]?.message ?? 'That rule is not valid.')
  }
  return parsed.data
}

type RuleRow = {
  id: string
  name: string
  position: number
  kind: string
  sources: string[]
  user_id: string | null
  member_ids: string[]
  max_open_workload: number | null
  status: string
  version: number
  published_at: string | null
}

const RULE_COLUMNS =
  'id, name, position, kind, sources, user_id, member_ids, max_open_workload, status, version, published_at'

function toRule(row: RuleRow): RoutingRule {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    kind: row.kind as RoutingRuleKind,
    sources: row.sources as RoutingSource[],
    userId: row.user_id,
    memberIds: row.member_ids ?? [],
    maxOpenWorkload: row.max_open_workload,
    status: row.status as RoutingRuleStatus,
    version: row.version,
    publishedAt: row.published_at,
  }
}

/** Every rule that has not been deleted, in the order routing tries them. */
export async function listRules(workspaceId: string): Promise<RoutingRule[]> {
  const { data, error } = await createAdminClient()
    .from('crm_routing_rules')
    .select(RULE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw new Error(`listRules failed: ${error.message}`)
  return ((data ?? []) as RuleRow[]).map(toRule)
}

/**
 * ⚠️ EVERYONE A RULE NAMES MUST BE A MEMBER NOW. Routing re-checks membership
 * at the moment it runs, so a rule naming an outsider would never route to them
 * — but saving one would look like it worked, and the rule would silently place
 * fewer leads than its author believes.
 */
async function assertMembers(workspaceId: string, input: RuleInput): Promise<void> {
  const ids = input.kind === 'named_user' ? [input.userId!] : input.kind === 'pool' ? input.memberIds : []
  if (ids.length === 0) return

  const { data, error } = await createAdminClient()
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .in('user_id', ids)

  if (error) throw new Error(`assertMembers failed: ${error.message}`)
  const found = new Set((data ?? []).map((m) => m.user_id))
  if (ids.some((id) => !found.has(id))) {
    throw new RoutingRuleError('Everyone in a rule must be a member of this workspace.')
  }
}

export async function createRule(
  workspaceId: string,
  actorUserId: string,
  raw: RuleInput,
): Promise<string> {
  const input = validateRuleInput(raw)
  await assertMembers(workspaceId, input)

  const db = createAdminClient()

  // New rules go last: adding a rule must never silently change which rule
  // already-live leads hit first.
  const { data: last } = await db
    .from('crm_routing_rules')
    .select('position')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await db
    .from('crm_routing_rules')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      position: (last?.position ?? -1) + 1,
      kind: input.kind,
      sources: input.sources,
      user_id: input.userId,
      member_ids: input.memberIds,
      max_open_workload: input.maxOpenWorkload,
      // ⚠️ A NEW RULE STARTS AS A DRAFT. Putting it live is a separate,
      // deliberate click, so a half-configured rule never routes a real lead.
      status: 'draft',
      created_by: actorUserId,
      updated_by: actorUserId,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`createRule failed: ${error?.message ?? 'no row'}`)

  await recordAudit(workspaceId, {
    action: 'crm.routing_rule.created',
    targetType: 'crm_routing_rule',
    targetId: data.id,
    actorUserId,
    after: input,
  })

  return data.id
}

export async function updateRule(
  workspaceId: string,
  actorUserId: string,
  ruleId: string,
  expectedVersion: number,
  raw: RuleInput,
): Promise<void> {
  const input = validateRuleInput(raw)
  await assertMembers(workspaceId, input)

  const db = createAdminClient()
  const { data: before } = await db
    .from('crm_routing_rules')
    .select(RULE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('id', ruleId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!before) throw new RoutingRuleError('That rule no longer exists.')

  /*
   * ⚠️ THE VERSION IS IN THE WHERE CLAUSE. Two admins editing the same rule
   * would otherwise both succeed and the second silently discard the first.
   * The trigger bumps `version` on every update, so the loser's form is stale.
   */
  const { data: updated, error } = await db
    .from('crm_routing_rules')
    .update({
      name: input.name,
      kind: input.kind,
      sources: input.sources,
      user_id: input.userId,
      member_ids: input.memberIds,
      max_open_workload: input.maxOpenWorkload,
      updated_by: actorUserId,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', ruleId)
    .eq('version', expectedVersion)
    .select('id')

  if (error) throw new Error(`updateRule failed: ${error.message}`)
  if (!updated || updated.length === 0) {
    throw new RoutingRuleError('Someone changed this rule while you were editing it. Reload to see their version.')
  }

  await recordAudit(workspaceId, {
    action: 'crm.routing_rule.updated',
    targetType: 'crm_routing_rule',
    targetId: ruleId,
    actorUserId,
    before: toRule(before as RuleRow),
    after: input,
  })
}

export async function setRuleStatus(
  workspaceId: string,
  actorUserId: string,
  ruleId: string,
  status: RoutingRuleStatus,
): Promise<void> {
  const db = createAdminClient()
  const patch =
    status === 'published'
      ? { status, published_at: new Date().toISOString(), updated_by: actorUserId }
      : { status, updated_by: actorUserId }

  const { data, error } = await db
    .from('crm_routing_rules')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', ruleId)
    .is('deleted_at', null)
    .select('id')

  if (error) throw new Error(`setRuleStatus failed: ${error.message}`)
  if (!data || data.length === 0) throw new RoutingRuleError('That rule no longer exists.')

  await recordAudit(workspaceId, {
    action: `crm.routing_rule.${status}`,
    targetType: 'crm_routing_rule',
    targetId: ruleId,
    actorUserId,
    after: { status },
  })
}

/**
 * Moves a rule one place earlier or later.
 *
 * ⚠️ RENUMBERS THE WHOLE LIST, NOT A SWAP OF TWO VALUES. Positions can collide —
 * a rule created while another admin was reordering takes "last + 1" — and a
 * swap between equal positions changes nothing visible. Writing 0..n-1 in the
 * new order leaves no ties for the next move to trip over.
 */
export async function moveRule(
  workspaceId: string,
  actorUserId: string,
  ruleId: string,
  direction: 'up' | 'down',
): Promise<void> {
  const rules = await listRules(workspaceId)
  const from = rules.findIndex((r) => r.id === ruleId)
  if (from === -1) throw new RoutingRuleError('That rule no longer exists.')

  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= rules.length) return

  const order = [...rules]
  ;[order[from], order[to]] = [order[to]!, order[from]!]

  const db = createAdminClient()
  for (let position = 0; position < order.length; position++) {
    const rule = order[position]!
    if (rule.position === position) continue
    const { error } = await db
      .from('crm_routing_rules')
      .update({ position, updated_by: actorUserId })
      .eq('workspace_id', workspaceId)
      .eq('id', rule.id)
    if (error) throw new Error(`moveRule failed: ${error.message}`)
  }

  await recordAudit(workspaceId, {
    action: 'crm.routing_rule.moved',
    targetType: 'crm_routing_rule',
    targetId: ruleId,
    actorUserId,
    before: { order: rules.map((r) => r.id) },
    after: { order: order.map((r) => r.id) },
  })
}

/**
 * Soft-deletes a rule.
 *
 * Its past decisions keep their snapshot of it — 0127 stores the rule's
 * definition on each decision rather than a reference — so deleting a rule
 * never erases the record of what it did.
 */
export async function deleteRule(workspaceId: string, actorUserId: string, ruleId: string): Promise<void> {
  const { data, error } = await createAdminClient()
    .from('crm_routing_rules')
    .update({ deleted_at: new Date().toISOString(), updated_by: actorUserId })
    .eq('workspace_id', workspaceId)
    .eq('id', ruleId)
    .is('deleted_at', null)
    .select('id')

  if (error) throw new Error(`deleteRule failed: ${error.message}`)
  if (!data || data.length === 0) throw new RoutingRuleError('That rule no longer exists.')

  await recordAudit(workspaceId, {
    action: 'crm.routing_rule.deleted',
    targetType: 'crm_routing_rule',
    targetId: ruleId,
    actorUserId,
  })
}

/**
 * Every member and whether routing may give them leads.
 *
 * ⚠️ A RETURN DATE THAT HAS PASSED COMES BACK AS `null` — available. Routing
 * already treats it that way, and deciding it here keeps `Date.now()` out of
 * the component, where React's purity lint refuses it during render.
 */
export async function listAvailability(
  workspaceId: string,
  now: Date = new Date(),
): Promise<AvailabilityRow[]> {
  const db = createAdminClient()
  const { data: memberships, error } = await db
    .from('workspace_memberships')
    .select('user_id, role, away_until, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listAvailability failed: ${error.message}`)
  const rows = memberships ?? []
  if (rows.length === 0) return []

  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name, email')
    .in(
      'id',
      rows.map((m) => m.user_id),
    )

  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name?.trim() || p.email || 'Unknown']))

  return rows.map((m) => ({
    userId: m.user_id,
    name: names.get(m.user_id) ?? 'Unknown',
    role: m.role,
    awayUntil: m.away_until && new Date(m.away_until).getTime() > now.getTime() ? m.away_until : null,
  }))
}

/**
 * Marks a member away until a moment, or available again with `null`.
 *
 * ⚠️ ROUTING ONLY. Being away hides nothing and moves nothing already owned;
 * it only stops new leads arriving. A lead that could not be placed while
 * someone was away is not re-routed automatically when they return — that is
 * what "Route again" in the queue is for, until scheduled review exists.
 */
export async function setAwayUntil(
  workspaceId: string,
  actorUserId: string,
  userId: string,
  awayUntil: string | null,
): Promise<void> {
  const { data, error } = await createAdminClient()
    .from('workspace_memberships')
    .update({ away_until: awayUntil })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .select('user_id')

  if (error) throw new Error(`setAwayUntil failed: ${error.message}`)
  if (!data || data.length === 0) throw new RoutingRuleError('That person is not a member of this workspace.')

  await recordAudit(workspaceId, {
    action: awayUntil ? 'workspace.member.away' : 'workspace.member.available',
    targetType: 'workspace_membership',
    targetId: userId,
    actorUserId,
    after: { away_until: awayUntil },
  })
}

const QUEUE_SCAN = 200

/**
 * Leads routing could not place, newest first, with the reason.
 *
 * ⚠️ A DECISION IS HISTORY, NOT STATE. A lead routed as `unassigned` last week
 * may have been assigned by hand since, or routed on review, or deleted — its
 * `unassigned` decision is still true and still there. So the queue is the
 * newest unassigned decision for each lead that is STILL unowned and not
 * deleted, never "every unassigned decision".
 */
export async function listUnassignedQueue(workspaceId: string, limit = 50): Promise<QueueItem[]> {
  const db = createAdminClient()
  const { data: decisions, error } = await db
    .from('crm_routing_decisions')
    .select('contact_id, reason, evaluated, created_at')
    .eq('workspace_id', workspaceId)
    .eq('outcome', 'unassigned')
    .order('created_at', { ascending: false })
    .limit(QUEUE_SCAN)

  if (error) throw new Error(`listUnassignedQueue failed: ${error.message}`)

  const newest = new Map<string, NonNullable<typeof decisions>[number]>()
  for (const d of decisions ?? []) {
    if (!newest.has(d.contact_id)) newest.set(d.contact_id, d)
  }
  if (newest.size === 0) return []

  const { data: contacts } = await db
    .from('crm_contacts')
    .select('id, full_name, owner_user_id, deleted_at')
    .eq('workspace_id', workspaceId)
    .in('id', [...newest.keys()])

  const stillWaiting = new Map(
    (contacts ?? [])
      .filter((c) => c.owner_user_id === null && c.deleted_at === null)
      .map((c) => [c.id, c.full_name?.trim() || 'Unnamed contact']),
  )

  const items: QueueItem[] = []
  for (const [contactId, d] of newest) {
    const name = stillWaiting.get(contactId)
    if (name === undefined) continue
    const evaluated = Array.isArray(d.evaluated) ? (d.evaluated as Record<string, unknown>[]) : []
    items.push({
      contactId,
      name,
      reason: d.reason,
      evaluated: evaluated.map((e) => ({
        kind: typeof e.kind === 'string' ? e.kind : null,
        reason: typeof e.reason === 'string' ? e.reason : 'unknown',
      })),
      decidedAt: d.created_at,
    })
    if (items.length >= limit) break
  }
  return items
}

/**
 * Routes one waiting lead again — a manual review, F02.
 *
 * ⚠️ A NEW INTAKE KEY EVERY TIME. The original key would replay the original
 * `unassigned` decision — once-per-intake doing exactly its job — and the lead
 * would never move. A review is a new routing event, so it is a new key, and
 * both decisions stay on record.
 *
 * ⚠️ AN OWNED LEAD IS REFUSED HERE, not only by the function. Someone may have
 * claimed it between the queue loading and the click; telling them that is
 * better than a silent `already_owned` decision.
 */
export async function routeContactAgain(
  workspaceId: string,
  contactId: string,
  now: Date = new Date(),
): Promise<ReroutingResult> {
  const db = createAdminClient()
  const { data: contact } = await db
    .from('crm_contacts')
    .select('id, owner_user_id, deleted_at, source')
    .eq('workspace_id', workspaceId)
    .eq('id', contactId)
    .maybeSingle()

  if (!contact || contact.deleted_at) throw new RoutingRuleError('That lead no longer exists.')
  if (contact.owner_user_id) throw new RoutingRuleError('That lead already has an owner.')
  if (contact.source === 'manual') {
    throw new RoutingRuleError('Contacts added by hand belong to whoever added them, so they are never routed.')
  }

  const { data, error } = await db.rpc('crm_route_contact', {
    p_workspace_id: workspaceId,
    p_contact_id: contactId,
    p_intake_key: `review:${contactId}:${now.toISOString()}`,
    p_source: contact.source,
  })

  if (error) throw new Error(`routeContactAgain failed: ${error.message}`)

  const result = data as { outcome: ReroutingResult['outcome']; reason: string; chosen_owner: string | null; activity_id: string | null }

  if (result.outcome === 'assigned' && result.activity_id && result.chosen_owner) {
    await emitDomainEvent({
      workspaceId,
      triggerType: 'contact_assigned',
      contactId,
      idempotencyKey: `contact_assigned:${result.activity_id}`,
      payload: { contactId, to: result.chosen_owner, by: 'routing' },
    })
  }

  return { outcome: result.outcome, reason: result.reason }
}
