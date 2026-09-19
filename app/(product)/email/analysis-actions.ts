'use server'

/**
 * Comparing sequences over a period.
 *
 * ⚠️ EVERY EXPORT GATES FIRST. A server action is a public HTTP endpoint
 * (CLAUDE.md rule 8), so the permission check is the first thing each function
 * does, before it reads a field.
 *
 * ⚠️ NOTHING BUT `async function` MAY BE EXPORTED FROM THIS FILE — see the long
 * note in `../crm/pipeline/actions.ts`. A non-function export takes down every
 * action reachable from the page at RUNTIME, and no build step catches it.
 */
import { z } from 'zod'

import {
  analyseEmailStrategy,
  gatherSequenceStats,
  totalsOf,
  caveatFor,
  type EmailAnalysisReport,
  type SequenceStats,
} from '@/lib/email/analysis'
import { assertWorkspacePermission } from '@/lib/workspaces/context'

export type EmailAnalysisState =
  | { ok: true; report: EmailAnalysisReport }
  | { ok: false; error: string }
  | null

export type SequenceComparisonState =
  | { ok: true; sequences: SequenceStats[]; overall: SequenceStats; caveat: string | null }
  | { ok: false; error: string }
  | null

/**
 * `YYYY-MM-DD`, or absent.
 *
 * ⚠️ THE SHAPE IS CHECKED, NOT JUST THE PARSEABILITY. These strings are
 * concatenated into timestamp bounds, so anything that is not a plain calendar
 * date produces a comparison that silently matches nothing — an empty report
 * rather than an error, which reads as "no sequence sent anything".
 */
const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'not a real date')

const WINDOW = z.object({ from: DATE.nullable(), to: DATE.nullable() })

function readWindow(formData: FormData) {
  return WINDOW.safeParse({
    from: emptyToNull(formData.get('from')),
    to: emptyToNull(formData.get('to')),
  })
}

/**
 * The counts only — no model, no credits.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ SEPARATE FROM THE AI ANALYSIS ON PURPOSE.                            ║
 * ║                                                                           ║
 * ║  "Which sequence is working better in this period" is a question about    ║
 * ║  arithmetic, and the arithmetic is the part Outlio can stand behind. It   ║
 * ║  must not cost a credit, must not fail when the model is down, and must   ║
 * ║  not wait several seconds — folding it into the analysis would make the   ║
 * ║  reliable half of this screen depend on the unreliable half.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export async function compareSequencesAction(
  _previous: SequenceComparisonState,
  formData: FormData,
): Promise<SequenceComparisonState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.campaign.view')
  } catch {
    return { ok: false, error: 'You do not have access to email reporting.' }
  }

  const parsed = readWindow(formData)
  if (!parsed.success) return { ok: false, error: 'Check the dates and try again.' }

  /*
   * ⚠️ REFUSED RATHER THAN RETURNING AN EMPTY TABLE. A backwards range matches
   * no rows, and "no sequence sent anything in that period" is a true sentence
   * that sends somebody looking for a data problem they do not have.
   */
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return { ok: false, error: 'The start date is after the end date.' }
  }

  const window = { from: parsed.data.from, to: parsed.data.to, userIds: [] }

  try {
    const sequences = await gatherSequenceStats(ctx.workspace.id, window)
    const overall = totalsOf(sequences)
    return { ok: true, sequences, overall, caveat: caveatFor(overall, window) }
  } catch {
    return { ok: false, error: 'Could not read the numbers for that period.' }
  }
}

/** The AI reading of the copy behind those numbers. */
export async function analyseEmailAction(
  _previous: EmailAnalysisState,
  formData: FormData,
): Promise<EmailAnalysisState> {
  let ctx
  try {
    ctx = await assertWorkspacePermission('email.campaign.view')
  } catch {
    return { ok: false, error: 'You do not have access to email reporting.' }
  }

  if (!ctx.modules.has('email')) {
    return { ok: false, error: 'Email is not included in your plan.' }
  }

  const parsed = readWindow(formData)
  if (!parsed.success) return { ok: false, error: 'Check the dates and try again.' }
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return { ok: false, error: 'The start date is after the end date.' }
  }

  const result = await analyseEmailStrategy({
    workspaceId: ctx.workspace.id,
    userId: ctx.userId!,
    window: {
      from: parsed.data.from,
      to: parsed.data.to,
      /*
       * ⚠️ EMPTY, AND NOT OFFERED. A sequence is a shared workspace artefact
       * — it has no single author to filter by, unlike a LinkedIn message
       * which is written per contact by a named person. Carrying a per-person
       * picker here would be a control that changes nothing.
       */
      userIds: [],
    },
  })

  return result.ok ? { ok: true, report: result.report } : { ok: false, error: result.message }
}

/** An untouched `<input type="date">` submits `''`, which is not a date. */
function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}
