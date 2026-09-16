'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'

import {
  createRoutingRuleAction,
  deleteRoutingRuleAction,
  moveRoutingRuleAction,
  routeContactAgainAction,
  setMemberAwayAction,
  setRoutingRuleStatusAction,
  updateRoutingRuleAction,
  type RoutingActionState,
} from '@/app/(product)/dashboard/settings/routing/actions'
import { LocalTime } from '@/components/ui/LocalTime'
import {
  KIND_HINT,
  KIND_LABEL,
  ROUTING_RULE_KINDS,
  ROUTING_SOURCES,
  SOURCE_LABEL,
  STATUS_LABEL,
  describeDecision,
  describeRuleSkip,
  type RoutingRuleKind,
} from '@/lib/crm/routing-copy'
import type { AvailabilityRow, QueueItem, RoutingRule } from '@/lib/crm/routing-rules'

/**
 * Lead routing settings.
 *
 * ⚠️ HIDING A CONTROL IS NOT THE PERMISSION CHECK. `canManage` decides what is
 * drawn; every action asserts `crm.routing.manage` itself (CLAUDE.md:
 * "Hiding a button is not access control").
 *
 * ⚠️ THE MEMBER CONTROLS ARE NOT THE FLOW BUILDER'S PICKERS, DELIBERATELY.
 * Those are controlled components that write into the builder's JSON config and
 * carry no form field names; these settings submit plain forms to server
 * actions. The behaviour that matters is copied rather than shared: a saved
 * person who has since left stays visible and labelled, instead of the select
 * silently falling back to someone else.
 */

type Member = { userId: string; name: string }

const LABEL = 'block text-xs font-semibold uppercase tracking-[0.12em] text-muted'
const INPUT =
  'w-full rounded-[var(--radius-md)] border border-border bg-panel px-2.5 py-1.5 text-sm text-ink focus-visible:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30'
const OUTLINE_BUTTON =
  'shrink-0 rounded-[var(--radius-md)] border border-border-strong bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-surface-muted disabled:opacity-60'
const TEXT_BUTTON =
  'rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:underline disabled:opacity-60'

const STATUS_TONE = {
  published: 'bg-success/10 text-success',
  draft: 'bg-surface-muted text-muted',
  archived: 'bg-surface-muted text-muted',
} as const

export function RoutingSettings({
  rules,
  people,
  queue,
  canManage,
  minAwayDate,
}: {
  rules: RoutingRule[]
  people: AvailabilityRow[]
  queue: QueueItem[]
  canManage: boolean
  minAwayDate: string
}) {
  const members: Member[] = people.map((p) => ({ userId: p.userId, name: p.name }))
  const liveCount = rules.filter((r) => r.status === 'published').length

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Rules</h3>
          <p className="mt-0.5 text-xs text-muted">
            Tried top to bottom. A lead goes to the first live rule that has someone available;
            if none does, it waits below with the reason.
          </p>
        </div>

        {/*
          ⚠️ SAID OUTRIGHT WHEN NOTHING IS LIVE. With no live rule every imported
          lead waits unassigned, and "no rules" looks like an empty list rather
          than the reason the queue below keeps growing.
        */}
        {liveCount === 0 ? (
          <p className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning">
            No rule is live, so every imported lead waits unassigned until someone assigns it.
          </p>
        ) : null}

        {rules.length > 0 ? (
          <ol className="space-y-2">
            {rules.map((rule, index) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                index={index}
                total={rules.length}
                members={members}
                canManage={canManage}
              />
            ))}
          </ol>
        ) : null}

        {canManage ? <NewRule members={members} /> : null}
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <div>
          <h3 className="text-sm font-semibold text-ink">Who is available</h3>
          <p className="mt-0.5 text-xs text-muted">
            Someone who is away receives no routed leads until their return date. Nothing they
            already own moves.
          </p>
        </div>
        <ul className="clay divide-y divide-border px-4">
          {people.map((person) => (
            <AvailabilityRowView
              key={person.userId}
              person={person}
              canManage={canManage}
              minAwayDate={minAwayDate}
            />
          ))}
        </ul>
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <div>
          <h3 className="text-sm font-semibold text-ink">Waiting for an owner</h3>
          <p className="mt-0.5 text-xs text-muted">
            Leads routing could not place, newest first. Assign one from its contact page, or
            route it again after changing a rule or someone’s availability.
          </p>
        </div>
        {queue.length === 0 ? (
          <div className="clay p-6 text-center">
            <p className="text-sm font-medium text-ink">Nothing is waiting.</p>
            <p className="mt-1 text-xs text-muted">
              Every routed lead has an owner, or was assigned by hand since.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {queue.map((item) => (
              <QueueRow key={item.contactId} item={item} canManage={canManage} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

function summarise(rule: RoutingRule, members: Member[]): string {
  const name = (id: string | null) =>
    members.find((m) => m.userId === id)?.name ?? 'someone no longer in this workspace'
  if (rule.kind === 'company_owner') return "To the lead's company owner"
  if (rule.kind === 'named_user') return `To ${name(rule.userId)}`
  return `Shared across ${rule.memberIds.length} ${rule.memberIds.length === 1 ? 'person' : 'people'}`
}

function RuleCard({
  rule,
  index,
  total,
  members,
  canManage,
}: {
  rule: RoutingRule
  index: number
  total: number
  members: Member[]
  canManage: boolean
}) {
  const [editing, setEditing] = useState(false)

  return (
    <li className="clay space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            <span className="mr-2 text-muted">{index + 1}.</span>
            {rule.name}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {summarise(rule, members)} · from {rule.sources.map((s) => SOURCE_LABEL[s]).join(', ')}
            {rule.maxOpenWorkload !== null ? ` · at most ${rule.maxOpenWorkload} contacts each` : ''}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[rule.status]}`}
        >
          {STATUS_LABEL[rule.status]}
        </span>
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <MoveButton ruleId={rule.id} direction="up" disabled={index === 0} />
          <MoveButton ruleId={rule.id} direction="down" disabled={index === total - 1} />
          <StatusButton rule={rule} />
          <button type="button" className={TEXT_BUTTON} onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            {editing ? 'Close' : 'Edit'}
          </button>
          <DeleteRule rule={rule} />
        </div>
      ) : null}

      {canManage && editing ? (
        <RuleForm members={members} rule={rule} onSaved={() => setEditing(false)} />
      ) : null}
    </li>
  )
}

function MoveButton({ ruleId, direction, disabled }: { ruleId: string; direction: 'up' | 'down'; disabled: boolean }) {
  const [state, action, pending] = useActionState<RoutingActionState, FormData>(moveRoutingRuleAction, null)
  return (
    <form action={action}>
      <input type="hidden" name="ruleId" value={ruleId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled || pending}
        className={OUTLINE_BUTTON}
        aria-label={direction === 'up' ? 'Try this rule earlier' : 'Try this rule later'}
      >
        {direction === 'up' ? '↑' : '↓'}
      </button>
      {state && !state.ok ? <Feedback state={state} /> : null}
    </form>
  )
}

function StatusButton({ rule }: { rule: RoutingRule }) {
  const [state, action, pending] = useActionState<RoutingActionState, FormData>(setRoutingRuleStatusAction, null)
  const next = rule.status === 'published' ? 'draft' : 'published'
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="ruleId" value={rule.id} />
      <input type="hidden" name="status" value={next} />
      <button type="submit" disabled={pending} className={OUTLINE_BUTTON}>
        {pending ? 'Saving…' : next === 'published' ? 'Put live' : 'Take offline'}
      </button>
      <Feedback state={state} />
    </form>
  )
}

/**
 * ⚠️ CONFIRMED FIRST, AND THE CONFIRMATION SAYS WHAT SURVIVES. The fear with
 * deleting a rule is that the leads it placed lose their owners. They do not.
 */
function DeleteRule({ rule }: { rule: RoutingRule }) {
  const [confirming, setConfirming] = useState(false)
  const [state, action, pending] = useActionState<RoutingActionState, FormData>(deleteRoutingRuleAction, null)

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-danger hover:underline">
        Delete
      </button>
    )
  }

  return (
    <form action={action} className="flex w-full flex-wrap items-center gap-2">
      <input type="hidden" name="ruleId" value={rule.id} />
      <p className="text-xs text-ink">
        Delete <span className="font-semibold">{rule.name}</span>? Leads it already placed keep
        their owners and their history.
      </p>
      <button type="submit" disabled={pending} className="rounded-[var(--radius-md)] bg-danger px-3 py-1.5 text-xs font-semibold text-cream hover:opacity-90 disabled:opacity-60">
        {pending ? 'Deleting…' : 'Delete'}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-muted hover:text-ink">
        Keep it
      </button>
      <Feedback state={state} />
    </form>
  )
}

function NewRule({ members }: { members: Member[] }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={OUTLINE_BUTTON}>
        Add a rule
      </button>
    )
  }
  return (
    <div className="clay p-4">
      <RuleForm members={members} onSaved={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </div>
  )
}

function RuleForm({
  members,
  rule,
  onSaved,
  onCancel,
}: {
  members: Member[]
  rule?: RoutingRule
  onSaved: () => void
  onCancel?: () => void
}) {
  const [state, action, pending] = useActionState<RoutingActionState, FormData>(
    rule ? updateRoutingRuleAction : createRoutingRuleAction,
    null,
  )
  const [kind, setKind] = useState<RoutingRuleKind>(rule?.kind ?? 'pool')

  useEffect(() => {
    if (state?.ok) onSaved()
  }, [state, onSaved])

  const sources = rule?.sources ?? ['csv_import', 'lead_engine']
  const knownUser = rule?.userId ? members.some((m) => m.userId === rule.userId) : true
  const staleMembers = (rule?.memberIds ?? []).filter((id) => !members.some((m) => m.userId === id))

  return (
    <form action={action} className="space-y-4">
      {rule ? (
        <>
          <input type="hidden" name="ruleId" value={rule.id} />
          <input type="hidden" name="version" value={rule.version} />
        </>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor={`rule-name-${rule?.id ?? 'new'}`} className={LABEL}>Name</label>
        <input id={`rule-name-${rule?.id ?? 'new'}`} name="name" required maxLength={120} defaultValue={rule?.name ?? ''} placeholder="New leads to the sales team" className={INPUT} />
      </div>

      <fieldset className="space-y-1.5">
        <legend className={LABEL}>Who gets the lead</legend>
        {ROUTING_RULE_KINDS.map((k) => (
          <label key={k} className="flex items-start gap-2 text-sm text-ink">
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-1 h-4 w-4" />
            <span>
              {KIND_LABEL[k]}
              <span className="block text-xs text-muted">{KIND_HINT[k]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === 'named_user' ? (
        <div className="space-y-1.5">
          <label htmlFor={`rule-user-${rule?.id ?? 'new'}`} className={LABEL}>Person</label>
          <select id={`rule-user-${rule?.id ?? 'new'}`} name="userId" required defaultValue={rule?.userId ?? ''} className={INPUT}>
            <option value="" disabled>Choose a member</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
            {rule?.userId && !knownUser ? (
              <option value={rule.userId}>Someone no longer in this workspace</option>
            ) : null}
          </select>
        </div>
      ) : null}

      {kind === 'pool' ? (
        <fieldset className="space-y-1.5">
          <legend className={LABEL}>Share across</legend>
          {members.length === 0 ? (
            <p className="text-xs text-warning">This workspace has no members to share across yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {members.map((m) => (
                <li key={m.userId}>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" name="memberIds" value={m.userId} defaultChecked={rule?.memberIds.includes(m.userId) ?? false} className="h-4 w-4" />
                    {m.name}
                  </label>
                </li>
              ))}
              {/*
                A saved member who has left stays ticked and labelled. Dropping
                them silently would change the rule on the next save without
                anyone deciding to — and saving with them still ticked is
                refused, which says why.
              */}
              {staleMembers.map((id) => (
                <li key={id}>
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" name="memberIds" value={id} defaultChecked className="h-4 w-4" />
                    Someone no longer in this workspace
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ) : null}

      <fieldset className="space-y-1.5">
        <legend className={LABEL}>Route leads from</legend>
        <div className="flex flex-wrap gap-4">
          {ROUTING_SOURCES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="sources" value={s} defaultChecked={sources.includes(s)} className="h-4 w-4" />
              {SOURCE_LABEL[s]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Contacts added by hand are never routed; they stay with whoever added them.</p>
      </fieldset>

      {kind !== 'company_owner' ? (
        <div className="space-y-1.5">
          <label htmlFor={`rule-cap-${rule?.id ?? 'new'}`} className={LABEL}>Cap per person (optional)</label>
          <input id={`rule-cap-${rule?.id ?? 'new'}`} name="maxOpenWorkload" type="number" min={1} step={1} defaultValue={rule?.maxOpenWorkload ?? ''} placeholder="No cap" className={INPUT} />
          <p className="text-xs text-muted">Someone who already owns this many contacts is skipped.</p>
        </div>
      ) : null}

      {rule?.status === 'published' ? (
        <p className="text-xs text-warning">This rule is live. Saving changes routing for every new lead from now on.</p>
      ) : null}

      <div className="flex items-center gap-2">
        <button type="submit" disabled={pending} className={OUTLINE_BUTTON}>
          {pending ? 'Saving…' : rule ? 'Save' : 'Save as draft'}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="rounded-[var(--radius-md)] px-2 py-1.5 text-xs font-medium text-muted hover:text-ink">
            Cancel
          </button>
        ) : null}
      </div>
      <Feedback state={state} />
    </form>
  )
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

function AvailabilityRowView({ person, canManage, minAwayDate }: { person: AvailabilityRow; canManage: boolean; minAwayDate: string }) {
  const [state, action, pending] = useActionState<RoutingActionState, FormData>(setMemberAwayAction, null)
  // `listAvailability` returns a date only while it is still in the future.
  const away = person.awayUntil !== null

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm text-ink">{person.name}</p>
        <p className="text-xs text-muted">
          {person.role}
          {away ? (
            <>
              {' · away until '}
              <LocalTime iso={person.awayUntil!} dateOnly />
            </>
          ) : ' · available'}
        </p>
      </div>

      {canManage ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={person.userId} />
          <label className="sr-only" htmlFor={`away-${person.userId}`}>Away until</label>
          <input id={`away-${person.userId}`} name="awayUntil" type="date" min={minAwayDate} className={`${INPUT} w-auto`} />
          <button type="submit" disabled={pending} className={OUTLINE_BUTTON}>
            {pending ? 'Saving…' : 'Mark away'}
          </button>
          {away ? (
            <button
              type="submit"
              disabled={pending}
              className={TEXT_BUTTON}
              // Clears the date: an empty `awayUntil` means available again.
              onClick={(event) => {
                const form = event.currentTarget.form
                const input = form?.elements.namedItem('awayUntil') as HTMLInputElement | null
                if (input) input.value = ''
              }}
            >
              Available now
            </button>
          ) : null}
          <Feedback state={state} />
        </form>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

function QueueRow({ item, canManage }: { item: QueueItem; canManage: boolean }) {
  const [state, action, pending] = useActionState<RoutingActionState, FormData>(routeContactAgainAction, null)

  return (
    <li className="clay space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/crm/contacts/${item.contactId}`} className="text-sm font-medium text-ink hover:text-accent">
            {item.name}
          </Link>
          <p className="mt-0.5 text-xs text-muted">{describeDecision(item.reason)}</p>
        </div>
        <LocalTime iso={item.decidedAt} className="text-xs text-muted" />
      </div>

      {/*
        Each rule's own reason, in the order routing tried them — the
        difference between "the pool was full" and "the lead had no company" is
        the difference between hiring and fixing the import.
      */}
      {item.evaluated.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted">
          {item.evaluated.map((e, i) => (
            <li key={i}>
              Rule {i + 1}
              {e.kind && e.kind in KIND_LABEL ? ` (${KIND_LABEL[e.kind as RoutingRuleKind].toLowerCase()})` : ''}: {describeRuleSkip(e.reason)}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <form action={action} className="space-y-1">
          <input type="hidden" name="contactId" value={item.contactId} />
          <button type="submit" disabled={pending} className={OUTLINE_BUTTON}>
            {pending ? 'Routing…' : 'Route again'}
          </button>
          <Feedback state={state} />
        </form>
      ) : null}
    </li>
  )
}

/** Announced as well as shown — the same pattern PipelineManager uses. */
function Feedback({ state }: { state: RoutingActionState }) {
  if (!state) return null
  return (
    <p role="status" aria-live="polite" className={`text-xs ${state.ok ? 'text-success' : 'text-danger'}`}>
      {state.ok ? state.message : state.error}
    </p>
  )
}
