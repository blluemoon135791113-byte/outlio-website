/** Scope labels shared by the single-lead and set-wide Hubble surfaces. */
import { RESEARCH_FIELD_SPEC, type ResearchField } from '@/lib/intelligence/types'

export type AnalysisScope = 'micro' | 'macro'

/**
 * Contact fields need row-level output rather than a distribution. They remain
 * set-researchable: public-source and identity checks are enforced by the
 * providers and evidence merger, not by refusing the user's query.
 */
export const CONTACT_FIELDS = new Set<ResearchField>([
  'work_email',
  'email_status',
  'mobile_phone',
  'phone_status',
  'person_social_profiles',
])

export function isContactField(field: ResearchField): boolean {
  return CONTACT_FIELDS.has(field)
}

/** Every sourced field can be researched over the selected set. */
export function macroFields(): ResearchField[] {
  return Object.keys(RESEARCH_FIELD_SPEC) as ResearchField[]
}

/**
 * Whether a question is asking for something macro can actually answer.
 *
 * Used only to explain a refusal well; it never widens what is researched.
 */
export function describesAggregate(question: string): boolean {
  return /\b(how many|what (?:share|percent|proportion|fraction)|distribution|breakdown|trend|pattern|across|most common|average|median|typical|overall|compare|which industries|mix of)\b/i.test(
    question,
  )
}
