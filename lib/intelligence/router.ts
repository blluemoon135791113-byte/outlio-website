/**
 * Tool routing — deciding the MINIMUM external work a question requires.
 *
 * PURE — no I/O, so the economics are unit-testable without a provider or a
 * database.
 *
 * Three reductions happen here, in order, and each one is money:
 *
 *   1. **Company deduplication** (spec §9). 500 employees of one company are
 *      one company task, not 500.
 *   2. **Database first** (spec §8). Anything already covered by fresh evidence
 *      is dropped before a provider is considered.
 *   3. **Minimum categories** (spec §15). Only the tool categories the
 *      requested fields actually need are invoked. "Give me emails" must not
 *      run funding, tech-stack, or web research.
 */
import { DERIVED_FIELDS } from '@/lib/intelligence/derive'
import { evidenceKey, type FieldKnowledge } from '@/lib/intelligence/evidence'
import {
  RESEARCH_FIELD_SPEC,
  type CompanyEntity,
  type PersonEntity,
  type ResearchEntity,
  type ResearchField,
  type ResearchTask,
  type ToolCategory,
} from '@/lib/intelligence/types'

export type RoutingInput = {
  /** Distinct companies behind the selected leads — already deduplicated. */
  companies: readonly CompanyEntity[]
  /** The selected leads themselves. Only used for person-level fields. */
  people: readonly PersonEntity[]
  /** Fields the plan says it needs. Order is irrelevant. */
  requiredFields: readonly ResearchField[]
  /** What Outlio already knows, from `readEvidence`. */
  knowledge?: ReadonlyMap<string, FieldKnowledge>
}

export type RoutingPlan = {
  tasks: ResearchTask[]
  /** Entity+field pairs served from existing evidence. Nothing is bought. */
  cacheHits: number
  /** Entity+field pairs that still need an external call. */
  fieldsToResearch: number
  /** Distinct tool categories that will run. */
  categories: ToolCategory[]
  companiesResearched: number
  peopleResearched: number
}

function taskId(category: ToolCategory, entity: ResearchEntity): string {
  return `${category}:${entity.type}:${entity.id}`
}

/**
 * Turns required fields into the smallest set of provider tasks that can answer
 * them.
 *
 * A field is dropped when `knowledge` already holds a fresh answer for that
 * entity. Expired and never-researched both mean "buy it" — but the caller can
 * still tell them apart in the map for reporting.
 */
export function planToTasks(input: RoutingInput): RoutingPlan {
  const knowledge = input.knowledge ?? new Map<string, FieldKnowledge>()

  /*
   * De-duplicate the request, and drop derived fields.
   *
   * ⚠️ A DERIVED FIELD MUST NEVER BE ROUTED. No provider answers `company_age`
   * or `employee_growth` — they are computed from evidence history — so routing
   * one would emit a task nothing can serve and report a spurious `unknown` for
   * a fact we can work out ourselves.
   */
  const derived = new Set<string>(DERIVED_FIELDS)
  const fields = [...new Set(input.requiredFields)].filter((field) => !derived.has(field))
  const companies = dedupeById(input.companies)
  const people = dedupeById(input.people)

  const byTask = new Map<string, ResearchTask>()
  let cacheHits = 0
  let fieldsToResearch = 0

  for (const field of fields) {
    const spec = RESEARCH_FIELD_SPEC[field]
    const entities: readonly ResearchEntity[] = spec.entity === 'company' ? companies : people

    for (const entity of entities) {
      const known = knowledge.get(evidenceKey(entity.type, entity.id, field))

      // Fresh evidence: reuse it. This is the single most valuable branch in
      // the product — it is the difference between researching a company once
      // and researching it on every query.
      if (known?.state === 'known') {
        cacheHits += 1
        continue
      }

      fieldsToResearch += 1

      const id = taskId(spec.category, entity)
      const existing = byTask.get(id)
      if (existing) {
        // Batch onto the task that already exists for this entity+category:
        // one provider call answers several fields.
        if (!existing.fields.includes(field)) existing.fields.push(field)
      } else {
        byTask.set(id, {
          id,
          category: spec.category,
          entity,
          fields: [field],
        })
      }
    }
  }

  const tasks = [...byTask.values()]

  return {
    tasks,
    cacheHits,
    fieldsToResearch,
    categories: [...new Set(tasks.map((task) => task.category))],
    companiesResearched: new Set(
      tasks.filter((t) => t.entity.type === 'company').map((t) => t.entity.id),
    ).size,
    peopleResearched: new Set(
      tasks.filter((t) => t.entity.type === 'person').map((t) => t.entity.id),
    ).size,
  }
}

function dedupeById<T extends { id: string }>(entities: readonly T[]): T[] {
  const seen = new Map<string, T>()
  for (const entity of entities) {
    if (!seen.has(entity.id)) seen.set(entity.id, entity)
  }
  return [...seen.values()]
}

/**
 * The tool categories a set of fields needs — nothing more.
 *
 * Exposed separately so a caller can show "this will use funding research" (or
 * refuse a job on entitlements) before committing to spend anything.
 */
export function categoriesForFields(
  fields: readonly ResearchField[],
): ToolCategory[] {
  return [...new Set(fields.map((field) => RESEARCH_FIELD_SPEC[field].category))]
}
