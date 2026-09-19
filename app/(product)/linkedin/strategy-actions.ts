'use server'

/**
 * Prospect messages, AI drafting, and the strategy analysis — Phase 20.
 *
 * ⚠️ EVERY EXPORT GATES FIRST. A server action is a public HTTP endpoint
 * (CLAUDE.md rule 8), so the permission check is the first thing each function
 * does, before it reads a field — and the ids arriving in the form are claims
 * that the library re-checks against the workspace.
 *
 * ⚠️ NOTHING HERE TOUCHES LINKEDIN. Drafting produces text into a textarea a
 * human then edits; the analysis reads Outlio's own rows.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { analyseStrategy, type AnalysisReport } from '@/lib/linkedin/analysis'
import { draftMessage, type DraftPurpose } from '@/lib/linkedin/draft'
import {
  removeProspectMessage,
  saveProspectMessage,
  type ProspectMessageKind,
} from '@/lib/linkedin/prospect-messages'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type ProspectMessageState =
  | { ok: true; message: string }
  | { ok: false; error: string }
  | null

export type DraftState =
  | { ok: true; text: string }
  | { ok: false; error: string }
  | null

export type AnalysisState =
  | { ok: true; report: AnalysisReport }
  | { ok: false; error: string }
  | null

/*
 * ⚠️ `crm.contact.edit` FOR WRITING AND DRAFTING. Writing what you would say to
 * a prospect you own is ordinary setter work — the same argument `actions.ts`
 * makes for releasing a task: "requiring a manager would mean the queue stops
 * when nobody senior is free."
 */
const WRITE = 'crm.contact.edit' as const

/*
 * ⚠️ `report.team.view` FOR THE ANALYSIS, BECAUSE IT SHOWS ONE REP'S NUMBERS TO
 * SOMEBODY ELSE. That is the same disclosure the reports page already governs.
 * Gating it on `crm.contact.edit` would let any setter read a colleague's reply
 * rate and a summary of their private messages.
 */
const ANALYSE = 'report.team.view' as const

async function gate(permission: typeof WRITE | typeof ANALYSE) {
  const ctx = await assertWorkspacePermission(permission)
  if (!ctx.modules.has('linkedin')) throw new Error('module')
  return ctx
}

function denied(error: unknown): string {
  return error instanceof Error && error.message === 'module'
    ? 'The LinkedIn channel is not enabled on your plan.'
    : 'You do not have access to this workspace.'
}

const KIND = z.enum(['OPENER', 'PITCH'])

export async function saveProspectMessageAction(
  _previous: ProspectMessageState,
  formData: FormData,
): Promise<ProspectMessageState> {
  let ctx
  try {
    ctx = await gate(WRITE)
  } catch (error) {
    return { ok: false, error: denied(error) }
  }

  const parsed = z
    .object({
      contactId: z.string().uuid(),
      kind: KIND,
      body: z.string().max(8_000),
    })
    .safeParse({
      contactId: formData.get('contactId'),
      kind: formData.get('kind'),
      body: formData.get('body') ?? '',
    })

  if (!parsed.success) return { ok: false, error: 'That could not be read. Reload and try again.' }

  const result = await saveProspectMessage({
    workspaceId: ctx.workspace.id,
    contactId: parsed.data.contactId,
    kind: parsed.data.kind as ProspectMessageKind,
    body: parsed.data.body,
    // ⚠️ The person writing NOW, never the contact's owner. 0133 says why.
    actorUserId: ctx.userId!,
  })

  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath(`/crm/contacts/${parsed.data.contactId}`)
  return { ok: true, message: 'Saved.' }
}

export async function removeProspectMessageAction(
  _previous: ProspectMessageState,
  formData: FormData,
): Promise<ProspectMessageState> {
  let ctx
  try {
    ctx = await gate(WRITE)
  } catch (error) {
    return { ok: false, error: denied(error) }
  }

  const parsed = z
    .object({ contactId: z.string().uuid(), kind: KIND })
    .safeParse({ contactId: formData.get('contactId'), kind: formData.get('kind') })

  if (!parsed.success) return { ok: false, error: 'That could not be read.' }

  const removed = await removeProspectMessage({
    workspaceId: ctx.workspace.id,
    contactId: parsed.data.contactId,
    kind: parsed.data.kind as ProspectMessageKind,
  })

  if (!removed) return { ok: false, error: 'That could not be removed.' }

  revalidatePath(`/crm/contacts/${parsed.data.contactId}`)
  return { ok: true, message: 'Removed.' }
}

export async function draftAction(
  _previous: DraftState,
  formData: FormData,
): Promise<DraftState> {
  let ctx
  try {
    ctx = await gate(WRITE)
  } catch (error) {
    return { ok: false, error: denied(error) }
  }

  const parsed = z
    .object({
      purpose: z.enum(['CONNECTION_NOTE', 'DIRECT_MESSAGE', 'INMAIL', 'OPENER', 'PITCH']),
      instruction: z.string().max(2_000),
      current: z.string().max(8_000).optional(),
    })
    .safeParse({
      purpose: formData.get('purpose'),
      instruction: formData.get('instruction') ?? '',
      current: formData.get('current') ?? undefined,
    })

  if (!parsed.success) return { ok: false, error: 'That could not be read.' }

  const result = await draftMessage({
    workspaceId: ctx.workspace.id,
    userId: ctx.userId!,
    purpose: parsed.data.purpose as DraftPurpose,
    instruction: parsed.data.instruction,
    current: parsed.data.current ?? null,
  })

  /*
   * ⚠️ THE DRAFT IS RETURNED, NOT SAVED. The operator reads and edits it before
   * anything is written — they are the author, and a button that silently
   * replaced their copy with a model's would make that false.
   */
  return result.ok ? { ok: true, text: result.text } : { ok: false, error: result.message }
}

/**
 * `YYYY-MM-DD`, or absent.
 *
 * ⚠️ THE SHAPE IS CHECKED, NOT JUST THE PARSEABILITY. These strings are
 * concatenated into timestamp bounds in `analysis.ts`, so anything that is not
 * a plain calendar date produces a comparison that silently matches nothing —
 * an empty report rather than an error, which reads as "we did no work".
 */
const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'not a real date')

export async function analyseAction(
  _previous: AnalysisState,
  formData: FormData,
): Promise<AnalysisState> {
  let ctx
  try {
    ctx = await gate(ANALYSE)
  } catch (error) {
    return { ok: false, error: denied(error) }
  }

  const parsed = z
    .object({
      from: DATE.nullable(),
      to: DATE.nullable(),
      /*
       * ⚠️ BOUNDED. These become an `.in()` clause; an unbounded list is an
       * unbounded query, and no real team needs more than this.
       */
      userIds: z.array(z.string().uuid()).max(200),
    })
    .safeParse({
      from: emptyToNull(formData.get('from')),
      to: emptyToNull(formData.get('to')),
      userIds: formData.getAll('userId').map(String).filter(Boolean),
    })

  if (!parsed.success) {
    return { ok: false, error: 'Check the dates and try again.' }
  }

  /*
   * ⚠️ REFUSED HERE RATHER THAN RETURNING AN EMPTY REPORT. A backwards range
   * matches no rows, and "nothing was recorded in that period" is a true
   * sentence that sends somebody looking for a data problem they do not have.
   */
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return { ok: false, error: 'The start date is after the end date.' }
  }

  const result = await analyseStrategy({
    workspaceId: ctx.workspace.id,
    userId: ctx.userId!,
    window: {
      from: parsed.data.from,
      to: parsed.data.to,
      // Empty means the whole team. See `AnalysisWindow`.
      userIds: parsed.data.userIds,
    },
  })

  return result.ok ? { ok: true, report: result.report } : { ok: false, error: result.message }
}

/** An untouched `<input type="date">` submits `''`, which is not a date. */
function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}
