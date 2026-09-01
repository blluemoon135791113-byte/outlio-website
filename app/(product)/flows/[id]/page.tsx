import type { Metadata } from 'next'

import { RunManually } from '@/components/flows/RunManually'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { FlowBuilder } from '@/components/flows/FlowBuilder'
import { FlowEditor } from '@/components/flows/FlowEditor'
import { creditBearingSteps, validateFlowDefinition } from '@/lib/flows/definition'
import { quoteCredits, type HubbleTask } from '@/lib/hubble/pricing'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspaces/context'
import { can } from '@/lib/workspaces/permissions'

export const metadata: Metadata = {
  title: 'Flow | Outlio',
  robots: { index: false, follow: false },
}

/** Which Hubble task each AI action performs, for pricing the flow. */
const TASK_FOR: Record<string, HubbleTask> = {
  HUBBLE_ICP_SCORE: 'icp_score',
  HUBBLE_RESEARCH: 'research',
  HUBBLE_CLASSIFY: 'classification',
  HUBBLE_PERSONALIZE: 'personalization',
  HUBBLE_REPLY_DRAFT: 'reply_draft',
  HUBBLE_CLASSIFY_REPLY: 'response_classification',
  HUBBLE_ACCOUNT_SUMMARY: 'account_summary',
}

/**
 * One flow.
 *
 * ⚠️ THE EXECUTION LOG IS THE POINT OF THIS PAGE (M7 criterion 5). A flow that
 * "just stopped" is unanswerable; every run shows its steps with status,
 * duration and error, and a halted run shows the reason that halted it.
 */
export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireWorkspace()
  const db = createAdminClient()

  const { data: flow } = await db
    .from('flows')
    .select('id, name, description, status, published_version_id, max_runs_per_contact_per_day, max_chain_depth')
    .eq('workspace_id', ctx.workspace.id)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!flow) notFound()

  const [{ data: versions }, { data: runs }] = await Promise.all([
    db.from('flow_versions').select('id, version, definition, published_at')
      .eq('flow_id', id).order('version', { ascending: false }).limit(10),
    db.from('flow_runs')
      .select('id, status, trigger_type, halt_reason, started_at, finished_at, version_id, chain_depth')
      .eq('flow_id', id).order('started_at', { ascending: false }).limit(20),
  ])

  const current = versions?.find((v) => v.id === flow.published_version_id) ?? versions?.[0]
  const versionNumber = new Map((versions ?? []).map((v) => [v.id, v.version]))

  // Step logs for the runs shown.
  const runIds = (runs ?? []).map((r) => r.id)
  type StepRow = {
    run_id: string
    step_id: string
    step_type: string
    status: string
    duration_ms: number | null
    error_code: string | null
    error_message: string | null
    credits_used: number
  }

  const { data: stepRuns } = runIds.length
    ? await db.from('flow_step_runs')
        .select('run_id, step_id, step_type, status, duration_ms, error_code, error_message, credits_used')
        .in('run_id', runIds).order('started_at')
    : { data: [] as StepRow[] }

  const stepsByRun = new Map<string, StepRow[]>()
  for (const step of stepRuns ?? []) {
    const list = stepsByRun.get(step.run_id) ?? []
    list.push(step)
    stepsByRun.set(step.run_id, list)
  }

  // What this flow costs per contact, answered BEFORE it runs.
  let creditSteps: string[] = []
  let creditsPerContact = 0
  let parsedDefinition: ReturnType<typeof validateFlowDefinition> | null = null
  try {
    if (current?.definition) {
      const definition = validateFlowDefinition(current.definition)
      parsedDefinition = definition
      creditSteps = creditBearingSteps(definition)
      for (const step of definition.steps) {
        if (step.type === 'ACTION' && TASK_FOR[step.action]) {
          creditsPerContact += quoteCredits(TASK_FOR[step.action]!)
        }
      }
    }
  } catch {
    // A published version that no longer validates is possible if the schema
    // tightened; the page must still render its run history.
  }

  const canManage = can({ role: ctx.role, modules: ctx.modules }, 'flow.manage')

  /*
   * ⚠️ ONLY FOR A PUBLISHED FLOW WHOSE TRIGGER IS `manual`. Offering "Run now"
   * on a `contact_created` flow would fire real actions against someone the
   * flow was never meant to touch, and the person clicking would reasonably
   * expect a rehearsal rather than a live run.
   */
  const currentDefinition = (current?.definition ?? null) as
    | { trigger?: { type?: string } }
    | null
  const isManual =
    flow.status === 'published' && currentDefinition?.trigger?.type === 'manual'

  const manualContacts = isManual
    ? await (async () => {
        // Bounded: a picker, not the whole book.
        const { data } = await createAdminClient()
          .from('crm_contacts')
          .select('id, full_name')
          .eq('workspace_id', ctx.workspace.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(50)
        return (data ?? []).map((c) => ({
          id: c.id,
          name: c.full_name ?? 'Unnamed contact',
        }))
      })()
    : []

  return (
    <div className="space-y-5">
      <div>
        <Link href="/flows" className="text-xs text-muted hover:text-ink">← Flows</Link>
        <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-ink">{flow.name}</h2>
        <p className="mt-0.5 text-xs text-muted">
          {flow.published_version_id
            ? `Live on version ${versionNumber.get(flow.published_version_id) ?? '?'} · ${flow.status}`
            : 'Never published — nothing triggers this yet'}
          {' · '}
          stops a contact after {flow.max_runs_per_contact_per_day} runs a day
        </p>
      </div>

      {creditsPerContact > 0 ? (
        <div className="clay p-4">
          <p className="text-sm font-semibold text-ink">
            {creditsPerContact} credit{creditsPerContact === 1 ? '' : 's'} per contact
          </p>
          {/*
            ⚠️ THE PRICE IS SHOWN BEFORE PUBLISHING, which the brief requires.
            A customer pointing this at 10,000 contacts must be able to see the
            bill while they can still change it.
          */}
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {creditSteps.length} AI step{creditSteps.length === 1 ? '' : 's'} ({creditSteps.join(', ')}).
            Running this over 1,000 contacts would use about {creditsPerContact * 1000} credits.
            Every other step is free.
          </p>
        </div>
      ) : null}

      {isManual && canManage ? (
        <section className="clay p-4">
          <h3 className="text-sm font-semibold text-ink">Run this flow</h3>
          <p className="mt-0.5 mb-3 text-xs text-muted">
            This flow is triggered by hand rather than by an event.
          </p>
          <RunManually flowId={flow.id} contacts={manualContacts} />
        </section>
      ) : null}

      {canManage ? (
        <>
          {/*
            ⚠️ THE BUILDER IS THE DEFAULT, and the JSON editor stays as the
            escape hatch. The builder covers triggers, actions and waits; branch
            CONDITIONS are still JSON, and a published version that no longer
            validates (because the schema tightened) can only be repaired as
            text. Hiding that would strand someone with an unfixable flow.
          */}
          <FlowBuilder
            flowId={id}
            initialDefinition={parsedDefinition ?? validateFlowDefinition(JSON.parse(STARTER_DEFINITION))}
          />
          <details className="clay p-4">
            <summary className="cursor-pointer text-xs font-semibold text-muted">
              Edit as JSON
            </summary>
            <div className="mt-3">
              <FlowEditor
                flowId={id}
                status={flow.status}
                definition={
                  current?.definition
                    ? JSON.stringify(current.definition, null, 2)
                    : STARTER_DEFINITION
                }
              />
            </div>
          </details>
        </>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Recent runs</h3>
        {(runs ?? []).length === 0 ? (
          <div className="clay p-6 text-center">
            <p className="text-sm text-muted">
              This flow has not run yet. It starts when its trigger fires — and only once
              published.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {(runs ?? []).map((run) => (
              <details key={run.id} className="clay p-4">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <RunPill status={run.status} />
                  <span className="font-semibold text-ink">{run.trigger_type}</span>
                  <span className="text-xs text-muted">
                    v{versionNumber.get(run.version_id) ?? '?'} ·{' '}
                    {new Date(run.started_at).toLocaleString()}
                  </span>
                  {run.chain_depth > 0 ? (
                    <span className="text-xs text-muted">· depth {run.chain_depth}</span>
                  ) : null}
                </summary>

                {/*
                  ⚠️ THE HALT REASON IS SHOWN IN FULL. Criterion 2 requires it
                  to be surfaced, and "halted" without a cause is exactly the
                  unanswerable state the column exists to prevent.
                */}
                {run.halt_reason ? (
                  <p className="mt-3 rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning">
                    {run.halt_reason}
                  </p>
                ) : null}

                <ol className="mt-3 space-y-1.5">
                  {(stepsByRun.get(run.id) ?? []).map((step) => (
                    <li key={`${step.run_id}-${step.step_id}`} className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span
                        className={
                          step.status === 'succeeded'
                            ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-success'
                            : step.status === 'failed'
                              ? 'h-1.5 w-1.5 shrink-0 rounded-full bg-danger'
                              : 'h-1.5 w-1.5 shrink-0 rounded-full bg-muted'
                        }
                      />
                      <span className="font-semibold text-ink">{step.step_id}</span>
                      <span className="text-muted">{step.step_type}</span>
                      {step.duration_ms !== null ? (
                        <span className="text-muted">{step.duration_ms}ms</span>
                      ) : null}
                      {step.credits_used > 0 ? (
                        <span className="rounded-full bg-accent-soft px-1.5 text-[10px] font-semibold text-accent">
                          {step.credits_used} credit{step.credits_used === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {step.error_message ? (
                        <span className="w-full text-danger">{step.error_message}</span>
                      ) : null}
                    </li>
                  ))}
                  {(stepsByRun.get(run.id) ?? []).length === 0 ? (
                    <li className="text-xs text-muted">No steps ran.</li>
                  ) : null}
                </ol>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** A minimal, valid definition so a new flow starts from something that works. */
const STARTER_DEFINITION = JSON.stringify(
  {
    trigger: { type: 'contact_created', config: {} },
    entryStepId: 'assign',
    steps: [
      { id: 'assign', type: 'ACTION', action: 'ASSIGN_OWNER', config: { userId: '' }, next: 'task' },
      {
        id: 'task', type: 'ACTION', action: 'CREATE_TASK',
        config: { title: 'Research this lead', dueInHours: 24 }, next: null,
      },
    ],
    allowReEnrollment: false,
  },
  null,
  2,
)

function RunPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    completed: 'bg-success-soft text-success',
    running: 'bg-accent-soft text-accent',
    waiting: 'bg-accent-soft text-accent',
    failed: 'bg-danger-soft text-danger',
    halted: 'bg-warning-soft text-warning',
    cancelled: 'bg-surface-muted text-muted',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone[status] ?? 'bg-surface-muted text-muted'}`}>
      {status}
    </span>
  )
}
