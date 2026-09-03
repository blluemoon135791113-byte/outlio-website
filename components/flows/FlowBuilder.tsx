'use client'

import { useActionState, useMemo, useState } from 'react'

import { publishFlow, type ActionState } from '@/app/(product)/flows/actions'
import {
  ACTION_LABEL,
  TRIGGER_LABEL,
  describeStep,
  insertAfter,
  layoutSteps,
  nextStepId,
  removeStep,
  unreachableStepIds,
  updateStep,
} from '@/lib/flows/builder'
import {
  ACTION_TYPES,
  FlowDefinitionError,
  TRIGGER_TYPES,
  validateFlowDefinition,
  type ActionType,
  type FlowDefinition,
} from '@/lib/flows/definition'
import { HUBBLE_TASKS, quoteCredits, type HubbleTask } from '@/lib/hubble/pricing'

const TASK_FOR: Partial<Record<ActionType, HubbleTask>> = {
  HUBBLE_ICP_SCORE: 'icp_score',
  HUBBLE_RESEARCH: 'research',
  HUBBLE_CLASSIFY: 'classification',
  HUBBLE_PERSONALIZE: 'personalization',
  HUBBLE_REPLY_DRAFT: 'reply_draft',
  HUBBLE_CLASSIFY_REPLY: 'response_classification',
  HUBBLE_ACCOUNT_SUMMARY: 'account_summary',
}

const FREE_ACTIONS = (Object.keys(ACTION_TYPES) as ActionType[]).filter(
  (a) => !ACTION_TYPES[a].costsCredits,
)
const AI_ACTIONS = (Object.keys(ACTION_TYPES) as ActionType[]).filter(
  (a) => ACTION_TYPES[a].costsCredits,
)

/**
 * The visual flow builder — M7 Phase 23.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  AI STEPS ARE BADGED WITH THEIR PRICE, EVERYWHERE THEY APPEAR.            ║
 * ║                                                                           ║
 * ║  The brief requires credit steps to be clearly distinguished from free    ║
 * ║  ones. That is not decoration: a customer adding "Research this company"  ║
 * ║  to a flow pointed at 10,000 contacts is committing to 30,000 credits,    ║
 * ║  and the moment to learn that is while choosing the step — not on an      ║
 * ║  invoice.                                                                 ║
 * ║                                                                           ║
 * ║  The free and paid pickers are SEPARATE LISTS rather than one list with   ║
 * ║  markers, so the split is impossible to skim past.                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ EVERY EDIT GOES THROUGH `lib/flows/builder.ts`, which rewires edges. The
 * two ways a builder loses work — an insert that cuts off everything after it,
 * and a delete that leaves dangling targets — are solved there and tested
 * there, not improvised in this component.
 */
export function FlowBuilder({
  flowId,
  initialDefinition,
  /*
   * ⚠️ RESOLVED ON THE SERVER, NOT FETCHED HERE. The member list is the same
   * one the CRM's assign control uses, and reading it server-side keeps a
   * workspace's roster off any client route — a browser request for "who is in
   * this workspace" is a question no client should be able to ask directly.
   */
  members,
  campaigns,
  mailboxes,
}: {
  flowId: string
  initialDefinition: FlowDefinition
  members: FlowMember[]
  campaigns: FlowCampaign[]
  mailboxes: FlowMailbox[]
}) {
  const [definition, setDefinition] = useState<FlowDefinition>(initialDefinition)
  const [editing, setEditing] = useState<string | null>(null)
  const [addingAfter, setAddingAfter] = useState<string | null | undefined>(undefined)
  const [state, publish, publishing] = useActionState<ActionState, FormData>(publishFlow, null)

  const rows = useMemo(() => layoutSteps(definition), [definition])
  const orphans = useMemo(() => new Set(unreachableStepIds(definition)), [definition])

  const { problems, creditsPerContact } = useMemo(() => {
    let credits = 0
    for (const step of definition.steps) {
      if (step.type === 'ACTION') {
        const task = TASK_FOR[step.action]
        if (task) credits += quoteCredits(task)
      }
    }
    try {
      validateFlowDefinition(definition)
      return { problems: [] as string[], creditsPerContact: credits }
    } catch (error) {
      return {
        problems: error instanceof FlowDefinitionError ? error.problems : ['Invalid flow.'],
        creditsPerContact: credits,
      }
    }
  }, [definition])

  const addStep = (afterId: string | null, action: ActionType) => {
    const id = nextStepId(definition, ACTION_LABEL[action])
    setDefinition(
      insertAfter(definition, afterId, {
        id,
        type: 'ACTION',
        action,
        config: {},
        next: null,
      } as never),
    )
    setAddingAfter(undefined)
    setEditing(id)
  }

  const addWait = (afterId: string | null) => {
    const id = nextStepId(definition, 'wait')
    setDefinition(
      insertAfter(definition, afterId, { id, type: 'WAIT', hours: 24, next: null } as never),
    )
    setAddingAfter(undefined)
    setEditing(id)
  }

  return (
    <div className="space-y-4">
      {/* --- Trigger --- */}
      <div className="clay p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">When</p>
        <select
          value={definition.trigger.type}
          onChange={(e) =>
            setDefinition({
              ...definition,
              trigger: { ...definition.trigger, type: e.target.value as never },
            })
          }
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none transition-colors duration-150 focus-visible:border-accent"
        >
          {TRIGGER_TYPES.map((type) => (
            <option key={type} value={type}>
              {TRIGGER_LABEL[type] ?? type}
            </option>
          ))}
        </select>
      </div>

      <AddHere onAction={(a) => addStep(null, a)} onWait={() => addWait(null)}
        open={addingAfter === null} onOpen={() => setAddingAfter(null)}
        onClose={() => setAddingAfter(undefined)} />

      {/* --- Steps --- */}
      {rows.map((row) => (
        <div key={row.step.id} style={{ marginLeft: row.depth * 20 }} className="space-y-2">
          <div
            className={`clay p-4 ${orphans.has(row.step.id) ? 'border border-warning' : ''}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {row.branchLabel ? (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {row.branchLabel}
                    </span>
                  ) : null}
                  <span className="text-sm font-semibold text-ink">{describeStep(row.step)}</span>
                  {/*
                    ⚠️ THE PRICE, NOT JUST A BADGE. "AI" tells someone it is
                    special; "2 credits" tells them what it costs.
                  */}
                  {row.costsCredits && row.step.type === 'ACTION' ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                      {quoteCredits(TASK_FOR[row.step.action]!)} credits
                    </span>
                  ) : null}
                  {orphans.has(row.step.id) ? (
                    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                      never runs
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted">{row.step.id}</p>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(editing === row.step.id ? null : row.step.id)}
                  className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
                >
                  {editing === row.step.id ? 'Done' : 'Edit'}
                </button>
                <button
                  type="button"
                  onClick={() => setDefinition(removeStep(definition, row.step.id))}
                  className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-danger transition-colors duration-150 hover:bg-danger-soft"
                >
                  Remove
                </button>
              </div>
            </div>

            {editing === row.step.id ? (
              <StepEditor
                step={row.step}
                members={members}
                campaigns={campaigns}
                mailboxes={mailboxes}
                onChange={(patch) => setDefinition(updateStep(definition, row.step.id, patch))}
              />
            ) : null}
          </div>

          <AddHere
            onAction={(a) => addStep(row.step.id, a)}
            onWait={() => addWait(row.step.id)}
            open={addingAfter === row.step.id}
            onOpen={() => setAddingAfter(row.step.id)}
            onClose={() => setAddingAfter(undefined)}
          />
        </div>
      ))}

      {/* --- Cost and problems --- */}
      {creditsPerContact > 0 ? (
        <div className="clay p-4">
          <p className="text-sm font-semibold text-ink">
            {creditsPerContact} credit{creditsPerContact === 1 ? '' : 's'} per contact
          </p>
          <p className="mt-1 text-xs text-muted">
            About {(creditsPerContact * 1000).toLocaleString()} credits per 1,000 contacts. Every
            non-AI step is free.
          </p>
        </div>
      ) : null}

      {problems.length > 0 ? (
        <ul className="clay space-y-1 p-4">
          {problems.map((problem) => (
            <li key={problem} className="text-xs leading-relaxed text-warning">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}

      {/* --- Publish --- */}
      <form action={publish} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="flowId" value={flowId} />
        <input type="hidden" name="definition" value={JSON.stringify(definition)} />
        <button
          type="submit"
          disabled={publishing || problems.length > 0}
          className="rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-semibold text-cream transition-colors duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {publishing ? 'Publishing…' : 'Publish new version'}
        </button>
        {problems.length > 0 ? (
          <span className="text-xs text-muted">Fix the problems above first.</span>
        ) : (
          <span className="text-xs text-muted">
            Runs already in progress finish on the current version.
          </span>
        )}
      </form>

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          aria-live={state.ok ? 'polite' : 'assertive'}
          className={`text-xs leading-relaxed ${state.ok ? 'text-success' : 'text-danger'}`}
        >
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The step picker.
 *
 * ⚠️ FREE AND PAID ARE SEPARATE LISTS, not one list with markers. A marker is
 * skimmable; a heading that says "These cost credits" is not.
 */
function AddHere({
  onAction,
  onWait,
  open,
  onOpen,
  onClose,
}: {
  onAction: (action: ActionType) => void
  onWait: () => void
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-[var(--radius-md)] border border-dashed border-border py-2 text-xs font-semibold text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
      >
        + Add a step
      </button>
    )
  }

  return (
    <div className="clay space-y-4 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Free steps</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onWait}
            className="rounded-[var(--radius-md)] border border-border px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface-muted"
          >
            Wait
          </button>
          {FREE_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              className="rounded-[var(--radius-md)] border border-border px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-150 hover:bg-surface-muted"
            >
              {ACTION_LABEL[action]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">
          These cost credits
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AI_ACTIONS.map((action) => {
            const task = TASK_FOR[action]
            return (
              <button
                key={action}
                type="button"
                onClick={() => onAction(action)}
                className="rounded-[var(--radius-md)] border border-accent bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:opacity-90"
              >
                {ACTION_LABEL[action]}
                {task ? (
                  <span className="ml-1.5 font-semibold">
                    {HUBBLE_TASKS[task].credits}cr
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="text-xs font-medium text-muted transition-colors duration-150 hover:text-ink"
      >
        Cancel
      </button>
    </div>
  )
}

export type FlowMember = { userId: string; name: string }

/**
 * Who a step assigns to.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE FIELD ASKED FOR A UUID AND NOBODY HAS ONE TO HAND.                  ║
 * ║                                                                           ║
 * ║  `ASSIGN_OWNER` was configured through the raw JSON box, so filling it in ║
 * ║  correctly meant already knowing a `auth.users.id`. Observed in           ║
 * ║  production: a published flow with `userId: ""` — left blank not through  ║
 * ║  carelessness but because there was no way to answer the question.        ║
 * ║                                                                           ║
 * ║  The step then failed at run time with "this step has no person           ║
 * ║  configured to assign to", visible only inside a failed run. Publishing   ║
 * ║  now refuses it, but refusing an input nobody can satisfy is only half a  ║
 * ║  fix — this is the other half.                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
function AssigneePicker({
  members,
  value,
  onSelect,
}: {
  members: FlowMember[]
  value: string
  onSelect: (userId: string) => void
}) {
  /*
   * ⚠️ A MEMBER WHO HAS LEFT MUST STILL BE VISIBLE. A saved `userId` that is
   * no longer in the workspace would otherwise vanish from the select, which
   * silently rewrites the step to whatever happens to be selected instead —
   * changing an automation nobody touched. It is shown, marked, and can only
   * be replaced deliberately.
   */
  const known = members.some((m) => m.userId === value)

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="block text-xs font-semibold text-ink" htmlFor="assign-owner">
        Assign to
      </label>
      <select
        id="assign-owner"
        value={value}
        onChange={(event) => onSelect(event.target.value)}
        className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none [color-scheme:light] focus-visible:border-accent"
      >
        {/*
          Named for what it means rather than left blank. An empty option reads
          as "not loaded yet"; this reads as the choice it is — and it is the
          one the publish check refuses.
        */}
        <option value="">Nobody yet — this step cannot run</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.name}
          </option>
        ))}
        {value && !known ? (
          <option value={value}>Someone no longer in this workspace</option>
        ) : null}
      </select>

      {members.length === 0 ? (
        <p className="mt-1 text-xs text-warning">
          This workspace has no members to assign to yet.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">
          The contact that triggered the flow becomes theirs.
        </p>
      )}
    </div>
  )
}

/** Who a round-robin step shares work between. */
function AssigneePoolPicker({
  members,
  value,
  onChange,
}: {
  members: FlowMember[]
  value: string[]
  onChange: (userIds: string[]) => void
}) {
  const toggle = (userId: string) =>
    onChange(
      value.includes(userId) ? value.filter((id) => id !== userId) : [...value, userId],
    )

  return (
    <div className="mt-3 border-t border-border pt-3">
      <span className="block text-xs font-semibold text-ink">Share between</span>

      {members.length === 0 ? (
        <p className="mt-1.5 text-xs text-warning">
          This workspace has no members to share between yet.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {members.map((member) => (
            <li key={member.userId}>
              {/* Label wraps the control, so the name is part of the hit target. */}
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={value.includes(member.userId)}
                  onChange={() => toggle(member.userId)}
                  className="h-4 w-4"
                />
                {member.name}
              </label>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 text-xs text-muted">
        {value.length === 0
          ? 'Nobody selected — this step cannot run.'
          : `Contacts are dealt out evenly between ${value.length} ${
              value.length === 1 ? 'person' : 'people'
            }.`}
      </p>
    </div>
  )
}

export type FlowCampaign = { id: string; name: string; status: string; type: string }

/**
 * Which campaign a sequence step acts on.
 *
 * ⚠️ DRAFTS ARE OFFERED, AND THE STATUS IS SHOWN. A flow is usually built
 * before the campaign it enrols into is launched, so hiding drafts would empty
 * the picker at exactly the moment it is needed. Naming the status lets someone
 * point at a draft on purpose without mistaking it for a live one.
 */
function CampaignPicker({
  campaigns,
  value,
  onSelect,
}: {
  campaigns: FlowCampaign[]
  value: string
  onSelect: (campaignId: string) => void
}) {
  // Same reasoning as the assignee picker: a campaign that was deleted must
  // stay visible rather than silently becoming whatever is selected instead.
  const known = campaigns.some((c) => c.id === value)

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="block text-xs font-semibold text-ink" htmlFor="campaign">
        Campaign
      </label>
      <select
        id="campaign"
        value={value}
        onChange={(event) => onSelect(event.target.value)}
        className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none [color-scheme:light] focus-visible:border-accent"
      >
        <option value="">No campaign yet — this step cannot run</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name} — {campaign.status}
          </option>
        ))}
        {value && !known ? (
          <option value={value}>A campaign that no longer exists</option>
        ) : null}
      </select>

      {campaigns.length === 0 ? (
        <p className="mt-1 text-xs text-warning">
          There are no campaigns yet. Create one under Outreach first.
        </p>
      ) : null}
    </div>
  )
}

/**
 * A task's title, when it is due, and who it lands on.
 *
 * ⚠️ THE TITLE IS THE ONE THAT COULD ONLY EVER FAIL BLANK. `dueInHours` has a
 * sane default of 24 in the handler and `assignTo` is genuinely optional — an
 * unassigned task is a real thing — so only the title is treated as required
 * here, matching `REQUIRED_ACTION_CONFIG`.
 */
function TaskEditor({
  members,
  config,
  titleRequired,
  onChange,
}: {
  members: FlowMember[]
  config: Record<string, unknown>
  /** `CREATE_EMAIL_TASK` defaults its title; `CREATE_TASK` refuses without one. */
  titleRequired: boolean
  onChange: (patch: Record<string, unknown>) => void
}) {
  const title = typeof config.title === 'string' ? config.title : ''
  const assignTo = typeof config.assignTo === 'string' ? config.assignTo : ''
  const dueInHours = Number(config.dueInHours ?? 24)

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div>
        <label className="block text-xs font-semibold text-ink" htmlFor="task-title">
          Task title
        </label>
        <input
          id="task-title"
          type="text"
          value={title}
          maxLength={200}
          placeholder={titleRequired ? 'Research this lead' : 'Send an email'}
          onChange={(event) => onChange({ ...config, title: event.target.value })}
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
        />
        {titleRequired && title.trim() === '' ? (
          <p className="mt-1 text-xs text-warning">
            Without a title this step cannot run.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            What the person who picks this up should do.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-semibold text-ink" htmlFor="task-due">
            Due in (hours)
          </label>
          <input
            id="task-due"
            type="number"
            min={1}
            max={24 * 90}
            value={Number.isFinite(dueInHours) ? dueInHours : 24}
            onChange={(event) =>
              onChange({ ...config, dueInHours: Number(event.target.value) || 24 })
            }
            className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink" htmlFor="task-assignee">
            Assign to
          </label>
          <select
            id="task-assignee"
            value={assignTo}
            onChange={(event) => onChange({ ...config, assignTo: event.target.value })}
            className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none [color-scheme:light] focus-visible:border-accent"
          >
            {/*
              Genuinely optional, and said so. An unassigned task appears in the
              workspace's queue rather than nobody's — which is different from
              the ASSIGN_OWNER step, where blank means the step cannot run.
            */}
            <option value="">Nobody in particular</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}

export type FlowMailbox = { id: string; label: string; status: string }

/** The merge fields `renderTemplate` understands, as offered to the author. */
const TEMPLATE_VARIABLES = [
  'first_name',
  'last_name',
  'full_name',
  'job_title',
  'company_name',
  'owner_name',
] as const

/**
 * The one step that cannot be taken back.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THERE IS NO "I AM AUTHORISED" CHECKBOX HERE, DELIBERATELY.           ║
 * ║                                                                           ║
 * ║  `sendEmail` gates on `config.actorAuthorized`. Exposing that as a field  ║
 * ║  would be self-certification — anyone who can open the builder could tick ║
 * ║  it — which is precisely what the gate exists to prevent. It is stamped   ║
 * ║  server-side from the publisher's own permission, in `publishFlow`.       ║
 * ║                                                                           ║
 * ║  ⚠️ A MISSING VARIABLE REFUSES THE SEND RATHER THAN MAILING "Hi ,".       ║
 * ║  That is `renderTemplate`'s behaviour, and it makes the fallback syntax   ║
 * ║  the single most useful thing to tell an author — so it is shown next to  ║
 * ║  the fields rather than buried in documentation.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
function SendEmailEditor({
  mailboxes,
  config,
  onChange,
}: {
  mailboxes: FlowMailbox[]
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const accountId = typeof config.accountId === 'string' ? config.accountId : ''
  const subject = typeof config.subject === 'string' ? config.subject : ''
  const body = typeof config.body === 'string' ? config.body : ''
  const known = mailboxes.some((m) => m.id === accountId)

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div>
        <label className="block text-xs font-semibold text-ink" htmlFor="send-mailbox">
          Send from
        </label>
        <select
          id="send-mailbox"
          value={accountId}
          onChange={(event) => onChange({ ...config, accountId: event.target.value })}
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none [color-scheme:light] focus-visible:border-accent"
        >
          <option value="">No mailbox yet — this step cannot run</option>
          {mailboxes.map((mailbox) => (
            <option key={mailbox.id} value={mailbox.id}>
              {mailbox.label} — {mailbox.status}
            </option>
          ))}
          {accountId && !known ? (
            <option value={accountId}>A mailbox that no longer exists</option>
          ) : null}
        </select>
        {mailboxes.length === 0 ? (
          <p className="mt-1 text-xs text-warning">
            No mailbox is connected. Connect one under Outreach before this step can send.
          </p>
        ) : null}
      </div>

      <div>
        <label className="block text-xs font-semibold text-ink" htmlFor="send-subject">
          Subject
        </label>
        <input
          id="send-subject"
          type="text"
          value={subject}
          maxLength={200}
          placeholder="Quick question about {{company_name|your team}}"
          onChange={(event) => onChange({ ...config, subject: event.target.value })}
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-ink" htmlFor="send-body">
          Message
        </label>
        <textarea
          id="send-body"
          rows={7}
          value={body}
          spellCheck
          placeholder={'Hi {{first_name|there}},\n\n…'}
          onChange={(event) => onChange({ ...config, body: event.target.value })}
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-ink outline-none focus-visible:border-accent"
        />
      </div>

      {/*
        ⚠️ THE FALLBACK SYNTAX IS THE POINT OF THIS BLOCK. A contact with no
        first name does not get "Hi ," — the send REFUSES, and the run fails
        with MISSING_VARIABLES. Someone who never learns `|there` discovers
        that one failed run at a time.
      */}
      <div className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-2">
        <p className="text-xs font-semibold text-ink">Merge fields</p>
        <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted">
          {TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join('  ')}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Give every one a fallback — <code className="font-mono">{'{{first_name|there}}'}</code>.
          A contact missing the value does not get a blank; the send is refused.
        </p>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        Sends as whoever publishes the flow, and only if they may launch email.
        Suppressions, daily limits and mailbox health are all checked first.
      </p>
    </div>
  )
}

/**
 * The facts a branch can test, exactly as `gatherFacts` names them.
 *
 * ⚠️ THESE KEYS ARE NOT GUESSES. `facts[condition.field]` is a plain lookup, so
 * a field the fact set does not contain reads as `undefined` — and `undefined`
 * makes most operators false, sending every contact down the same path
 * silently. A typo here is a branch that looks configured and never branches.
 */
const BRANCH_FIELDS: { key: string; label: string }[] = [
  { key: 'contact.full_name', label: 'Contact — full name' },
  { key: 'contact.first_name', label: 'Contact — first name' },
  { key: 'contact.last_name', label: 'Contact — last name' },
  { key: 'contact.job_title', label: 'Contact — job title' },
  { key: 'contact.headline', label: 'Contact — headline' },
  { key: 'contact.location', label: 'Contact — location' },
  { key: 'contact.owner_user_id', label: 'Contact — owner' },
  { key: 'contact.company_id', label: 'Contact — company' },
]

const BRANCH_OPERATORS: { key: string; label: string }[] = [
  { key: 'equals', label: 'is exactly' },
  { key: 'not_equals', label: 'is not' },
  { key: 'contains', label: 'contains' },
  { key: 'not_contains', label: 'does not contain' },
  { key: 'is_empty', label: 'is empty' },
  { key: 'is_not_empty', label: 'is not empty' },
  { key: 'greater_than', label: 'is greater than' },
  { key: 'less_than', label: 'is less than' },
  { key: 'in', label: 'is one of' },
  { key: 'not_in', label: 'is none of' },
]

/** Operators that take no value at all. */
const VALUELESS = new Set(['is_empty', 'is_not_empty'])
/** Operators whose value MUST be an array, or they never match. */
const LIST_OPERATORS = new Set(['in', 'not_in'])
/** Operators that coerce with `Number()`. */
const NUMERIC = new Set(['greater_than', 'less_than'])

type BranchCondition = { field: string; operator: string; value?: unknown }

/**
 * Branch conditions.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ `in` AND `not_in` FAIL SILENTLY UNLESS THE VALUE IS AN ARRAY.        ║
 * ║                                                                           ║
 * ║  `evaluateCondition` guards them with `Array.isArray(expected) && …`, so  ║
 * ║  a string there does not error — it returns FALSE, for every contact,     ║
 * ║  forever. Typing `founder, ceo` into a JSON box produced exactly that.    ║
 * ║  This editor stores a real array, which is the whole reason it is worth   ║
 * ║  more than a textarea.                                                    ║
 * ║                                                                           ║
 * ║  ⚠️ `equals` IS STRICT `===`, and every fact is a string or null. So the  ║
 * ║  value is kept as text for those operators and coerced to a number only   ║
 * ║  for the two that call `Number()`. Storing 5 where "5" is meant is a      ║
 * ║  comparison that can never be true.                                       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
function BranchEditor({
  conditions,
  match,
  onChange,
}: {
  conditions: BranchCondition[]
  match: 'all' | 'any'
  onChange: (patch: { conditions?: BranchCondition[]; match?: 'all' | 'any' }) => void
}) {
  const update = (index: number, patch: Partial<BranchCondition>) =>
    onChange({
      conditions: conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    })

  /** Re-shapes the stored value when the operator changes shape. */
  const changeOperator = (index: number, operator: string) => {
    const current = conditions[index]!
    let value: unknown = current.value

    if (VALUELESS.has(operator)) value = undefined
    else if (LIST_OPERATORS.has(operator)) value = Array.isArray(value) ? value : []
    else if (Array.isArray(value)) value = value.join(', ')

    update(index, { operator, value })
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div>
        <label className="block text-xs font-semibold text-ink" htmlFor="branch-match">
          Take the true path when
        </label>
        <select
          id="branch-match"
          value={match}
          onChange={(event) => onChange({ match: event.target.value === 'any' ? 'any' : 'all' })}
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none [color-scheme:light] focus-visible:border-accent"
        >
          <option value="all">every condition holds</option>
          <option value="any">any condition holds</option>
        </select>
      </div>

      <ul className="space-y-2">
        {conditions.map((condition, index) => {
          const valueless = VALUELESS.has(condition.operator)
          const isList = LIST_OPERATORS.has(condition.operator)
          const known = BRANCH_FIELDS.some((f) => f.key === condition.field)

          return (
            <li key={index} className="rounded-[var(--radius-md)] bg-surface-muted p-2.5">
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={condition.field}
                  aria-label={`Condition ${index + 1} field`}
                  onChange={(event) => update(index, { field: event.target.value })}
                  className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none [color-scheme:light]"
                >
                  {BRANCH_FIELDS.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}
                    </option>
                  ))}
                  {/* A field from JSON that the fact set no longer has. Kept
                      visible rather than silently reassigned. */}
                  {condition.field && !known ? (
                    <option value={condition.field}>{condition.field} (unknown)</option>
                  ) : null}
                </select>

                <select
                  value={condition.operator}
                  aria-label={`Condition ${index + 1} operator`}
                  onChange={(event) => changeOperator(index, event.target.value)}
                  className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none [color-scheme:light]"
                >
                  {BRANCH_OPERATORS.map((operator) => (
                    <option key={operator.key} value={operator.key}>
                      {operator.label}
                    </option>
                  ))}
                </select>
              </div>

              {!valueless ? (
                <input
                  type={NUMERIC.has(condition.operator) ? 'number' : 'text'}
                  value={
                    Array.isArray(condition.value)
                      ? condition.value.join(', ')
                      : condition.value === undefined || condition.value === null
                        ? ''
                        : String(condition.value)
                  }
                  aria-label={`Condition ${index + 1} value`}
                  placeholder={isList ? 'Founder, CEO, Owner' : 'Founder'}
                  onChange={(event) => {
                    const raw = event.target.value
                    update(index, {
                      value: isList
                        ? // Split into a REAL array. A string here never matches.
                          raw.split(',').map((part) => part.trim()).filter(Boolean)
                        : NUMERIC.has(condition.operator)
                          ? Number(raw)
                          : raw,
                    })
                  }}
                  className="mt-2 w-full rounded-[var(--radius-md)] border border-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none"
                />
              ) : null}

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted">
                  {isList ? 'Separate each option with a comma.' : valueless ? 'No value needed.' : ''}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ conditions: conditions.filter((_, i) => i !== index) })
                  }
                  /*
                   * ⚠️ THE LAST CONDITION CANNOT BE REMOVED. The schema requires
                   * `min(1)`, so removing it makes the definition invalid and
                   * the flow unpublishable — a dead end reached by clicking a
                   * button that looked available.
                   */
                  disabled={conditions.length <= 1}
                  className="rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium text-muted transition-colors duration-150 hover:text-danger disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={() =>
          onChange({
            conditions: [
              ...conditions,
              { field: BRANCH_FIELDS[0]!.key, operator: 'is_not_empty' },
            ],
          })
        }
        className="rounded-[var(--radius-md)] bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-150 hover:opacity-90"
      >
        Add a condition
      </button>

      {/*
        Routing is edge-wiring, and every edge in this builder goes through
        lib/flows/builder.ts. Saying which part is still JSON is more useful
        than the old blanket "branches are edited in the JSON view".
      */}
      <p className="text-xs leading-relaxed text-muted">
        Which step each path goes to is still set in the JSON editor below.
      </p>
    </div>
  )
}

/** What a flow may write back onto a contact. */
const UPDATABLE_CONTACT_FIELDS: { key: string; label: string }[] = [
  { key: 'job_title', label: 'Job title' },
  { key: 'headline', label: 'Headline' },
  { key: 'location', label: 'Location' },
  { key: 'full_name', label: 'Full name' },
]

/**
 * Setting a field on the contact.
 *
 * ⚠️ THE LIST IS THE HANDLER'S ALLOW-LIST, NOT EVERY COLUMN. `updateField`
 * refuses anything outside `UPDATABLE_FIELDS` with FIELD_NOT_ALLOWED, so
 * offering a wider choice here would just move the failure from publish to run.
 */
function UpdateFieldEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const field = typeof config.field === 'string' ? config.field : ''
  const clearing = config.value === null
  const value = typeof config.value === 'string' ? config.value : ''

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div>
        <label className="block text-xs font-semibold text-ink" htmlFor="update-field">
          Field
        </label>
        <select
          id="update-field"
          value={field}
          onChange={(event) => onChange({ ...config, field: event.target.value })}
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none [color-scheme:light] focus-visible:border-accent"
        >
          <option value="">Nothing chosen — this step cannot run</option>
          {UPDATABLE_CONTACT_FIELDS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-semibold text-ink" htmlFor="update-value">
          Set to
        </label>
        <input
          id="update-value"
          type="text"
          value={value}
          disabled={clearing}
          maxLength={200}
          placeholder="Qualified"
          onChange={(event) => onChange({ ...config, value: event.target.value })}
          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent disabled:opacity-50"
        />
      </div>

      {/*
        ⚠️ CLEARING IS A REAL CHOICE AND IS NOT THE SAME AS AN EMPTY BOX. The
        handler accepts `null` to clear and refuses any non-string otherwise, so
        "" writes an empty string and `null` removes the value. Collapsing the
        two would make one of them unreachable.
      */}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={clearing}
          onChange={(event) =>
            onChange({ ...config, value: event.target.checked ? null : '' })
          }
          className="h-4 w-4"
        />
        Clear the field instead
      </label>
    </div>
  )
}

/** Per-step settings. Deliberately small: config differs by action. */
function StepEditor({
  step,
  members,
  campaigns,
  mailboxes,
  onChange,
}: {
  step: FlowDefinition['steps'][number]
  members: FlowMember[]
  campaigns: FlowCampaign[]
  mailboxes: FlowMailbox[]
  onChange: (patch: Record<string, unknown>) => void
}) {
  if (step.type === 'WAIT') {
    return (
      <div className="mt-3 border-t border-border pt-3">
        <label className="block text-xs font-semibold text-ink">Wait for (hours)</label>
        <input
          type="number"
          min={0}
          max={24 * 90}
          defaultValue={step.hours}
          onChange={(e) => onChange({ hours: Number(e.target.value) })}
          className="mt-1.5 w-32 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
        />
        <p className="mt-1 text-xs text-muted">Up to 90 days. 24 = one day.</p>
      </div>
    )
  }

  if (step.type === 'BRANCH') {
    return (
      <BranchEditor
        conditions={step.conditions}
        match={step.match}
        onChange={(patch) => onChange(patch as Record<string, unknown>)}
      />
    )
  }

  /*
   * ⚠️ THE PICKERS PATCH ONLY THEIR OWN KEY, never the whole config. Replacing
   * `config` wholesale would silently drop any other setting the step carries —
   * and `ASSIGN_OWNER` gaining a second option later would then lose it every
   * time somebody changed the person.
   */
  if (step.action === 'ASSIGN_OWNER') {
    return (
      <AssigneePicker
        members={members}
        value={typeof step.config.userId === 'string' ? step.config.userId : ''}
        onSelect={(userId) => onChange({ config: { ...step.config, userId } })}
      />
    )
  }

  if (step.action === 'ROUND_ROBIN') {
    return (
      <AssigneePoolPicker
        members={members}
        value={
          Array.isArray(step.config.userIds)
            ? step.config.userIds.filter((v): v is string => typeof v === 'string')
            : []
        }
        onChange={(userIds) => onChange({ config: { ...step.config, userIds } })}
      />
    )
  }

  /*
   * All four sequence controls take the same key. Listing them explicitly
   * rather than matching on a name prefix: a future `SEQUENCE_REPORT` that
   * takes no campaign would silently inherit a required picker.
   */
  if (
    step.action === 'ENROLL_SEQUENCE' ||
    step.action === 'REMOVE_SEQUENCE' ||
    step.action === 'PAUSE_SEQUENCE' ||
    step.action === 'RESUME_SEQUENCE'
  ) {
    return (
      <CampaignPicker
        campaigns={campaigns}
        value={typeof step.config.campaignId === 'string' ? step.config.campaignId : ''}
        onSelect={(campaignId) => onChange({ config: { ...step.config, campaignId } })}
      />
    )
  }

  if (step.action === 'UPDATE_FIELD') {
    return (
      <UpdateFieldEditor
        config={step.config}
        onChange={(config) => onChange({ config })}
      />
    )
  }

  if (step.action === 'SEND_EMAIL') {
    return (
      <SendEmailEditor
        mailboxes={mailboxes}
        config={step.config}
        onChange={(config) => onChange({ config })}
      />
    )
  }

  if (step.action === 'CREATE_TASK' || step.action === 'CREATE_EMAIL_TASK') {
    return (
      <TaskEditor
        members={members}
        config={step.config}
        titleRequired={step.action === 'CREATE_TASK'}
        onChange={(config) => onChange({ config })}
      />
    )
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="block text-xs font-semibold text-ink">Settings (JSON)</label>
      <textarea
        rows={4}
        defaultValue={JSON.stringify(step.config, null, 2)}
        spellCheck={false}
        onChange={(e) => {
          try {
            onChange({ config: JSON.parse(e.target.value) })
          } catch {
            // Mid-typing JSON is invalid constantly; the publish-time validator
            // is what refuses, not every keystroke.
          }
        }}
        className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 font-mono text-xs text-ink outline-none focus-visible:border-accent"
      />
    </div>
  )
}
