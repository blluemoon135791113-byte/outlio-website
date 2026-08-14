/**
 * The ResearchPlan (spec §6).
 *
 * PURE — schema and validation only.
 *
 * ⚠️ **NO EXTERNAL RESEARCH RUNS WITHOUT ONE OF THESE.** The plan is the
 * contract between "what the user asked" and "what we are about to spend money
 * on". In Phase 4 an LLM will produce it from natural language, and this schema
 * is what stops unstructured model output from reaching a paid API directly:
 * the model proposes a plan, Zod validates it, and only the validated shape is
 * ever executed.
 */
import { z } from 'zod'

import { RESEARCH_FIELDS, researchFieldSchema } from '@/lib/intelligence/types'

/** Which leads the question applies to (spec §31). */
export const researchScopeSchema = z.discriminatedUnion('type', [
  /** Explicitly chosen leads. The safest scope, and the default from the UI. */
  z.object({ type: z.literal('lead_ids'), leadIds: z.array(z.string().uuid()).min(1).max(10_000) }),
  /** Everything from one extraction run. */
  z.object({ type: z.literal('extraction_job'), extractionJobId: z.string().uuid() }),
  /**
   * Every lead the user owns. Deliberately its own case rather than a default,
   * so a missing scope can never silently become "spend money on everything".
   */
  z.object({ type: z.literal('all_leads') }),
])

export type ResearchScope = z.infer<typeof researchScopeSchema>

export const researchPlanSchema = z.object({
  /** Whether the question is about companies or the people at them. */
  entityScope: z.enum(['companies', 'people']).default('companies'),
  /**
   * Fields the question needs. This list alone decides which providers run and
   * therefore what the query costs (spec §15).
   */
  requiredFields: z.array(researchFieldSchema).min(1).max(RESEARCH_FIELDS.length),
  /** Columns to show. Purely presentational; never widens what is researched. */
  outputFields: z.array(z.string().min(1).max(64)).max(32).default([]),
  /**
   * Qualification criteria, applied deterministically after research. Free-form
   * here because the qualification engine (Phase 6) owns their meaning.
   */
  filters: z.record(z.string(), z.unknown()).default({}),
  clarificationRequired: z.boolean().default(false),
  clarificationQuestions: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        question: z.string().min(1).max(500),
        options: z.array(z.string().min(1).max(120)).max(8).default([]),
      }),
    )
    .max(5)
    .default([]),
})

export type ResearchPlan = z.infer<typeof researchPlanSchema>

export type PlanValidation =
  | { ok: true; plan: ResearchPlan }
  | { ok: false; reason: string }

/**
 * Validates a proposed plan.
 *
 * Returns a reason describing the SHAPE that was wrong, never echoing the
 * offending value — a rejected plan reaches logs, and a query string can carry
 * a customer's lead names.
 */
export function validatePlan(candidate: unknown): PlanValidation {
  const parsed = researchPlanSchema.safeParse(candidate)
  if (parsed.success) return { ok: true, plan: parsed.data }

  return {
    ok: false,
    reason: parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join('; '),
  }
}

/**
 * Whether a plan may be executed right now.
 *
 * A plan awaiting clarification is a real, valid plan — it just must not spend
 * anything until the user has answered (spec §7).
 */
export function isExecutable(plan: ResearchPlan): boolean {
  return !plan.clarificationRequired && plan.requiredFields.length > 0
}
