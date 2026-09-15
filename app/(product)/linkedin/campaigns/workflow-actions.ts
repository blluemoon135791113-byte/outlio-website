'use server'

/**
 * Saving a campaign's workflow — Phase 20.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ NOTHING HERE TOUCHES LINKEDIN. It writes down what a human intends to  ║
 * ║  do, in what order, with what gaps. Rule 1 is not worked around; it is     ║
 * ║  why a "workflow" in Outlio is a list of instructions rather than a        ║
 * ║  program that runs against somebody's account.                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ A SERVER ACTION IS A PUBLIC HTTP ENDPOINT. Gating is the first thing the
 * exported function does, before it reads a single field, and the campaign id
 * arriving in the form is a claim that `saveWorkflow` re-checks against the
 * workspace — hiding the page is not access control (CLAUDE.md rule 8).
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { MAX_STEPS, MAX_WAIT_DAYS } from '@/lib/linkedin/workflow'
import { saveWorkflow } from '@/lib/linkedin/workflow-store'
import { STEP_ACTIONS } from '@/lib/linkedin/steps'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type WorkflowActionState =
  | { ok: true; message: string }
  | { ok: false; error: string; problems?: { stepId: string | null; message: string }[] }
  | null

/*
 * ⚠️ THE SAME PERMISSION THE INBOX USES. Building the sequence you will then
 * perform yourself is ordinary setter work, not an administrative act —
 * `actions.ts` makes the same argument for releasing a task: "requiring a
 * manager would mean the queue stops when nobody senior is free."
 */
const PERMISSION = 'crm.contact.edit' as const

/**
 * ⚠️ ZOD, BECAUSE THIS IS EXTERNAL INPUT (CLAUDE.md). The payload is a JSON
 * string from the browser, so every field is attacker-controlled: the action
 * must be one this build knows, `waitDays` must be a whole number in range, and
 * the array must be bounded before it reaches a loop that writes a row each.
 */
const StepSchema = z.object({
  id: z.string().uuid().optional(),
  action: z.enum(STEP_ACTIONS),
  body: z.string().max(8_000).nullable(),
  waitDays: z.number().int().min(1).max(MAX_WAIT_DAYS).nullable(),
})

const PayloadSchema = z.object({
  campaignId: z.string().uuid(),
  steps: z.array(StepSchema).max(MAX_STEPS),
})

export async function saveWorkflowAction(
  _previous: WorkflowActionState,
  formData: FormData,
): Promise<WorkflowActionState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission(PERMISSION)
    if (!ctx.modules.has('linkedin')) throw new Error('module')
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message === 'module'
          ? 'The LinkedIn channel is not enabled on your plan.'
          : 'You do not have access to this workspace.',
    }
  }

  const parsed = PayloadSchema.safeParse(safeJson(formData.get('payload')))
  if (!parsed.success) {
    /*
     * ⚠️ NO ZOD DETAIL IN THE MESSAGE. It names internal field paths, and this
     * failure is not something the operator can act on anyway — the builder
     * constructs the payload, so a rejection here means a bug or a forged
     * request rather than a typo.
     */
    return { ok: false, error: 'That workflow could not be read. Reload the page and try again.' }
  }

  const result = await saveWorkflow({
    workspaceId: ctx.workspace.id,
    campaignId: parsed.data.campaignId,
    steps: parsed.data.steps.map((step) => ({
      id: step.id,
      action: step.action,
      // An empty textarea is no body, not an empty one — the column is nullable
      // and the CHECK constraints are written against NULL.
      body: step.body?.trim() ? step.body : null,
      waitDays: step.waitDays,
    })),
  })

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.problems.length === 1
          ? result.problems[0]!.message
          : `${result.problems.length} steps need fixing before this can be saved.`,
      problems: [...result.problems],
    }
  }

  revalidatePath(`/linkedin/campaigns/${parsed.data.campaignId}`)

  return {
    ok: true,
    message:
      result.steps.length === 1
        ? 'Workflow saved — 1 step.'
        : `Workflow saved — ${result.steps.length} steps.`,
  }
}

/** Parsing must not throw inside an action; a bad body is a validation failure. */
function safeJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
