import 'server-only'

/**
 * Turning a finished run into the table the user asked for (spec §32).
 *
 * ⚠️ ONLY THE REQUESTED COLUMNS. A question about funding returns founder,
 * company, amount and date — not a 40-column dump of everything we happen to
 * know. Giant lead profiles are explicitly not the product (spec §2).
 *
 * ⚠️ EVERY RESEARCHED CELL CARRIES ITS STATE. A blank is never ambiguous: a
 * cell is `known` with a source, or `unknown` with a reason. "Does not use
 * HubSpot" and "we could not find out" must stay distinguishable all the way to
 * the screen (spec §49).
 */
import { dateRangeBounds } from '@/lib/intelligence/date-range'
import { getAllCompanies } from '@/lib/companies/repository'
import { readEvidence } from '@/lib/intelligence/evidence-store'
import { evidenceKey } from '@/lib/intelligence/evidence'
import { validatePlan, type ResearchScope } from '@/lib/intelligence/plan'
import { dedupeRowsForPlan, shapeRowsForPlan } from '@/lib/intelligence/result-match'
import { RESEARCH_FIELD_SPEC, type ResearchField } from '@/lib/intelligence/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ResearchRunStatus } from '@/types/database'

/** Rows returned to the browser in one response. */
const MAX_ROWS = 500

/**
 * ⚠️ AN UNKNOWN CARRIES ITS REASON.
 *
 * "We looked and found nothing" and "every provider for this field was rate
 * limited or out of quota" are different facts, and a user who cannot tell them
 * apart concludes the product does not work. It was reporting both as a bare
 * `unknown`, which is how a run where Tavily was over its plan limit and GDELT
 * was throttled rendered as a silent wall of Unknown.
 */
export type UnknownReason =
  | 'not_found'
  | 'provider_unavailable'
  | 'no_provider'
  | 'no_company'
  /**
   * A person-level field on a row that has no person — an account-list company.
   *
   * ⚠️ NOT `not_found`. "We searched for their email and found none" and
   * "there is nobody on this row to have an email" are different facts, and
   * collapsing them makes a company row look like a failed person lookup.
   */
  | 'no_person'

/**
 * ⚠️ A KNOWN CELL CARRIES HOW SURE WE ARE, NOT JUST WHAT WE FOUND.
 *
 * The confidence engine computes an answer-level confidence and the list of
 * independent providers that agreed, then this boundary used to discard both.
 * A cell backed by three independent sources rendered identically to one
 * scraped from a single weak page, so a seller had no way to tell a solid
 * contact from a shaky one — and every cell implicitly claimed equal footing.
 */
export type ResultCell =
  | {
      state: 'known'
      value: unknown
      sourceUrl: string | null
      sourceProvider: string
      /** 0–1, the ANSWER's confidence: agreement raises it, dissent lowers it. */
      confidence: number
      /** Other providers that independently reached this same value. */
      corroboratingProviders: readonly string[]
      /** Providers that reached a DIFFERENT value. A conflict is information. */
      conflictingProviders: readonly string[]
    }
  | { state: 'unknown'; reason: UnknownReason }

export type ResultRow = {
  /**
   * NULL for a company that no lead points at.
   *
   * ⚠️ These rows exist so macro analysis can see a saved ACCOUNT LIST. An
   * account list contains companies and no people, so under a lead-derived
   * result table its companies were researched and then silently dropped
   * before the analysis ran — spend with nothing to show. A row without a
   * person is the honest representation, not a lead with blank name fields.
   */
  leadId: string | null
  personName: string | null
  jobTitle: string | null
  linkedinUrl: string | null
  companyId: string | null
  companyName: string | null
  companyDomain: string | null
  /** Keyed by research field. Only the plan's fields are present. */
  fields: Record<string, ResultCell>
  /** Present only when the run was scored against a profile. */
  qualification: {
    score: number
    qualified: boolean
    disqualifiedBy: string | null
    unknownCount: number
    reasons: string[]
  } | null
}

export type RunResults = {
  runId: string
  status: ResearchRunStatus
  queryText: string
  /** Field keys the plan asked for, in plan order. Drives the table columns. */
  columns: ResearchField[]
  rows: ResultRow[]
  /** True when more rows exist than were returned. */
  truncated: boolean
  progress: {
    stage: string
    current: number
    total: number
    evidenceGaps: Array<{
      provider: string
      entityType: string
      entityId: string
      reason: string
    }>
  }
  metadata: {
    leadsEvaluated: number
    companiesResearched: number
    qualified: number | null
    cachedResultsUsed: number
    externalCalls: number
    durationMs: number | null
    /** Coverage before filters hide rows, so an empty result can explain why. */
    fieldCoverage: Partial<Record<ResearchField, FieldCoverage>>
  }
  clarification: {
    questions: Array<{ id: string; question: string; options: string[] }>
  } | null
  error: string | null
}

export type FieldCoverage = {
  known: number
  notFound: number
  providerUnavailable: number
  noProvider: number
  noCompany: number
  /** Person fields on a row with no person. Never a lookup failure. */
  noPerson: number
}

function summarizeFieldCoverage(
  rows: readonly ResultRow[],
  columns: readonly ResearchField[],
): Partial<Record<ResearchField, FieldCoverage>> {
  return Object.fromEntries(
    columns.map((field) => {
      const summary: FieldCoverage = {
        known: 0,
        notFound: 0,
        providerUnavailable: 0,
        noProvider: 0,
        noCompany: 0,
        noPerson: 0,
      }

      for (const row of rows) {
        const cell = row.fields[field]
        if (cell?.state === 'known') {
          summary.known += 1
          continue
        }

        if (cell?.reason === 'provider_unavailable') summary.providerUnavailable += 1
        else if (cell?.reason === 'no_provider') summary.noProvider += 1
        else if (cell?.reason === 'no_company') summary.noCompany += 1
        /*
         * ⚠️ MUST NOT FALL INTO `notFound`. An account-list company has no
         * person, so a person field was never looked up — counting it as "not
         * found" would report a coverage failure for work nobody attempted.
         */
        else if (cell?.reason === 'no_person') summary.noPerson += 1
        else summary.notFound += 1
      }

      return [field, summary]
    }),
  )
}

/**
 * Assembles a run's results.
 *
 * Returns `null` when the run does not belong to this user — the same answer as
 * "does not exist", so a run id cannot be probed for existence.
 */
export async function getRunResults(
  userId: string,
  runId: string,
): Promise<RunResults | null> {
  const supabase = createAdminClient()

  const { data: run } = await supabase
    .from('research_runs')
    // A single literal: PostgREST infers row types from the string, and a
    // concatenation erases that inference entirely.
    .select('id, status, query_text, plan, scope, lead_count, company_count, qualified_count, cache_hit_count, external_call_count, duration_ms, error_message, clarifications, qualification_profile_id, progress_stage, progress_current, progress_total, evidence_gaps')
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!run) return null

  const validation = validatePlan(run.plan)
  const columns: ResearchField[] = validation.ok ? validation.plan.requiredFields : []

  const base: RunResults = {
    runId: run.id,
    status: run.status as RunResults['status'],
    queryText: run.query_text,
    columns,
    rows: [],
    truncated: false,
    progress: {
      stage: run.progress_stage,
      current: run.progress_current,
      total: run.progress_total,
      evidenceGaps: Array.isArray(run.evidence_gaps)
        ? run.evidence_gaps.filter((gap): gap is {
            provider: string
            entityType: string
            entityId: string
            reason: string
          } => Boolean(
            gap &&
            typeof gap === 'object' &&
            typeof (gap as { provider?: unknown }).provider === 'string' &&
            typeof (gap as { entityType?: unknown }).entityType === 'string' &&
            typeof (gap as { entityId?: unknown }).entityId === 'string' &&
            typeof (gap as { reason?: unknown }).reason === 'string',
          ))
        : [],
    },
    metadata: {
      leadsEvaluated: run.lead_count,
      companiesResearched: run.company_count,
      qualified: run.qualification_profile_id ? run.qualified_count : null,
      cachedResultsUsed: run.cache_hit_count,
      externalCalls: run.external_call_count,
      durationMs: run.duration_ms,
      fieldCoverage: {},
    },
    clarification: null,
    error: run.error_message,
  }

  if (run.status === 'waiting_for_clarification') {
    return { ...base, clarification: { questions: askedQuestions(run.clarifications) } }
  }

  // Only a finished run has anything to show. A running one returns metadata so
  // the screen can show progress without pretending to have results.
  if (run.status !== 'completed' && run.status !== 'partially_complete') return base

  const scope = run.scope as { type?: string; leadIds?: string[] }
  const loaded = await loadRows(userId, run.id, scope, columns, Boolean(run.qualification_profile_id))
  const candidates = validation.ok
    ? dedupeRowsForPlan(loaded.rows, validation.plan)
    : loaded.rows
  const rows = validation.ok ? shapeRowsForPlan(loaded.rows, validation.plan) : loaded.rows

  return {
    ...base,
    rows,
    truncated: loaded.truncated,
    metadata: {
      ...base.metadata,
      fieldCoverage: summarizeFieldCoverage(candidates, columns),
    },
  }
}

/**
 * Pulls the questions out of the run's clarification history.
 *
 * The history is jsonb written by this codebase, but it is still parsed
 * defensively: a hand-edited row must degrade to "no questions" rather than
 * crash the results screen.
 */
function askedQuestions(
  history: unknown,
): Array<{ id: string; question: string; options: string[] }> {
  if (!Array.isArray(history)) return []

  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue
    const questions = (entry as { questions?: unknown }).questions
    if (!Array.isArray(questions)) continue

    return questions
      .filter(
        (question): question is { id: string; question: string; options?: string[] } =>
          Boolean(
            question &&
              typeof question === 'object' &&
              typeof (question as { id?: unknown }).id === 'string' &&
              typeof (question as { question?: unknown }).question === 'string',
          ),
      )
      .map((question) => ({
        id: question.id,
        question: question.question,
        options: Array.isArray(question.options) ? question.options : [],
      }))
  }

  return []
}

/**
 * Maps each requested field to the reason it may be missing.
 *
 * Reads `research_tool_calls`, which the executor writes for every provider
 * attempt with its status. A category where every attempt failed is
 * `provider_unavailable`; one where providers ran and simply found nothing is
 * `not_found`; one with no attempts at all had no provider configured.
 */
async function unknownReasons(
  runId: string,
  columns: readonly ResearchField[],
): Promise<Map<ResearchField, UnknownReason>> {
  const supabase = createAdminClient()
  const reasons = new Map<ResearchField, UnknownReason>()

  const { data } = await supabase
    .from('research_tool_calls')
    .select('tool, status')
    .eq('research_run_id', runId)

  const byCategory = new Map<string, { total: number; failed: number }>()
  for (const call of data ?? []) {
    const bucket = byCategory.get(call.tool) ?? { total: 0, failed: 0 }
    bucket.total += 1
    // `not_found` means the provider answered; the rest mean it never did.
    if (call.status !== 'success' && call.status !== 'not_found') bucket.failed += 1
    byCategory.set(call.tool, bucket)
  }

  for (const field of columns) {
    const category = RESEARCH_FIELD_SPEC[field].category
    const bucket = byCategory.get(category)

    if (!bucket || bucket.total === 0) {
      reasons.set(field, 'no_provider')
    } else if (bucket.failed === bucket.total) {
      reasons.set(field, 'provider_unavailable')
    } else {
      reasons.set(field, 'not_found')
    }
  }

  return reasons
}

async function loadRows(
  userId: string,
  runId: string,
  scope: { type?: string; leadIds?: string[] },
  columns: readonly ResearchField[],
  scored: boolean,
): Promise<{ rows: ResultRow[]; truncated: boolean }> {
  const supabase = createAdminClient()

  let query = supabase
    .from('extracted_leads')
    .select('id, full_name, job_title, linkedin_url, company_id, company_name')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS + 1)

  if (scope.type === 'lead_ids' && scope.leadIds?.length) {
    query = query.in('id', scope.leadIds.slice(0, 1000))
  }

  /*
   * Why each field came back empty, read from the tool calls the run recorded.
   *
   * A provider that errored, timed out or was rate-limited means the field was
   * never actually looked up — reporting that as "not found" tells the user
   * these companies have no funding when what happened is that the funding
   * providers were unavailable.
   */
  const reasonByField = await unknownReasons(runId, columns)

  const { data: leadRows } = await query
  const leads = leadRows ?? []
  const truncated = leads.length > MAX_ROWS
  const visible = leads.slice(0, MAX_ROWS)

  const companyIds = [...new Set(visible.map((lead) => lead.company_id).filter(Boolean))] as string[]

  const { data: companies } = companyIds.length
    ? await supabase
        .from('companies')
        .select('id, name, normalized_domain')
        .eq('user_id', userId)
        .in('id', companyIds)
    : { data: [] }

  const companyById = new Map(
    (companies ?? []).map((company) => [company.id, company] as const),
  )

  const companyFields = columns.filter((field) => RESEARCH_FIELD_SPEC[field].entity === 'company')
  const personFields = columns.filter((field) => RESEARCH_FIELD_SPEC[field].entity === 'person')

  const knowledge = await readEvidence(userId, [
    { entityType: 'company', entityIds: companyIds, fields: companyFields },
    { entityType: 'person', entityIds: visible.map((lead) => lead.id), fields: personFields },
  ])

  const scores = scored ? await loadScores(userId, runId) : new Map()

  const rows: ResultRow[] = visible.map((lead) => {
    const company = lead.company_id ? companyById.get(lead.company_id) : undefined
    const fields: Record<string, ResultCell> = {}

    for (const field of columns) {
      const isCompanyField = RESEARCH_FIELD_SPEC[field].entity === 'company'
      const entityId = isCompanyField ? lead.company_id : lead.id

      if (!entityId) {
        // The lead was never linked to a company, so a company-level field had
        // nothing to attach to. Not a provider failure.
        fields[field] = { state: 'unknown', reason: 'no_company' }
        continue
      }

      const found = knowledge.get(
        evidenceKey(isCompanyField ? 'company' : 'person', entityId, field),
      )

      fields[field] =
        found?.state === 'known'
          ? {
              state: 'known',
              value: found.record.value,
              sourceUrl: found.record.sourceUrl,
              sourceProvider: found.record.sourceProvider,
              confidence: found.confidence,
              // Deduplicated: one provider is one source however many rows it
              // filed, which is the same rule the confidence engine scores by.
              corroboratingProviders: [
                ...new Set(found.corroborating.map((record) => record.sourceProvider)),
              ],
              conflictingProviders: [
                ...new Set(found.conflicting.map((record) => record.sourceProvider)),
              ],
            }
          : { state: 'unknown', reason: reasonByField.get(field) ?? 'not_found' }
    }

    return {
      leadId: lead.id,
      personName: lead.full_name,
      jobTitle: lead.job_title,
      linkedinUrl: lead.linkedin_url,
      companyId: lead.company_id,
      companyName: company?.name ?? lead.company_name,
      companyDomain: company?.normalized_domain ?? null,
      fields,
      qualification: lead.company_id ? (scores.get(lead.company_id) ?? null) : null,
    }
  })

  /*
   * ---- companies no lead points at ---------------------------------------
   *
   * ╔══════════════════════════════════════════════════════════════════════╗
   * ║  WITHOUT THIS, RESEARCHING AN ACCOUNT LIST PRODUCES NOTHING TO READ. ║
   * ║                                                                      ║
   * ║  Every row above is a lead. A saved account list has no people in    ║
   * ║  it, so its companies are researched under the `workspace` scope and ║
   * ║  then dropped here — the run spends, reports success, and the macro  ║
   * ║  analysis covers only the companies that happened to have employees. ║
   * ║  Silently analysing a fraction of what was paid for is worse than    ║
   * ║  failing, because nothing on screen says so.                         ║
   * ╚══════════════════════════════════════════════════════════════════════╝
   *
   * Only for `workspace`, the one scope that researches companies directly
   * without being handed a lead list.
   */
  const companyOnly =
    scope.type === 'workspace' && rows.length <= MAX_ROWS
      ? await loadCompanyOnlyRows(userId, {
          columns,
          alreadyShown: new Set(companyIds),
          budget: MAX_ROWS - rows.length,
          reasonByField,
          scores,
        })
      : { rows: [], truncated: false }

  return {
    rows: [...rows, ...companyOnly.rows],
    truncated: truncated || companyOnly.truncated,
  }
}

/**
 * Result rows for companies that no lead points at.
 *
 * These are almost always account-list companies. They carry company fields
 * only: there is no person, so a person field is `no_person` rather than
 * `not_found` — the difference between "we looked and found nothing" and
 * "there was nobody here to look for", which a reader cannot otherwise tell.
 */
async function loadCompanyOnlyRows(
  userId: string,
  input: {
    columns: readonly ResearchField[]
    alreadyShown: ReadonlySet<string>
    budget: number
    reasonByField: ReadonlyMap<ResearchField, UnknownReason>
    scores: ReadonlyMap<string, ScoreSummary>
  },
): Promise<{ rows: ResultRow[]; truncated: boolean }> {
  if (input.budget <= 0) return { rows: [], truncated: true }

  const companies = (await getAllCompanies(userId)).filter(
    (company) => !input.alreadyShown.has(company.id),
  )

  if (companies.length === 0) return { rows: [], truncated: false }

  const visible = companies.slice(0, input.budget)
  const companyFields = input.columns.filter(
    (field) => RESEARCH_FIELD_SPEC[field].entity === 'company',
  )

  const knowledge = await readEvidence(userId, [
    { entityType: 'company', entityIds: visible.map((company) => company.id), fields: companyFields },
  ])

  const rows: ResultRow[] = visible.map((company) => {
    const fields: Record<string, ResultCell> = {}

    for (const field of input.columns) {
      if (RESEARCH_FIELD_SPEC[field].entity !== 'company') {
        fields[field] = { state: 'unknown', reason: 'no_person' }
        continue
      }

      const found = knowledge.get(evidenceKey('company', company.id, field))

      fields[field] =
        found?.state === 'known'
          ? {
              state: 'known',
              value: found.record.value,
              sourceUrl: found.record.sourceUrl,
              sourceProvider: found.record.sourceProvider,
              confidence: found.confidence,
              corroboratingProviders: [
                ...new Set(found.corroborating.map((record) => record.sourceProvider)),
              ],
              conflictingProviders: [
                ...new Set(found.conflicting.map((record) => record.sourceProvider)),
              ],
            }
          : { state: 'unknown', reason: input.reasonByField.get(field) ?? 'not_found' }
    }

    return {
      leadId: null,
      personName: null,
      jobTitle: null,
      linkedinUrl: null,
      companyId: company.id,
      companyName: company.name,
      companyDomain: company.normalizedDomain,
      fields,
      qualification: input.scores.get(company.id) ?? null,
    }
  })

  return { rows, truncated: companies.length > visible.length }
}

type ScoreSummary = NonNullable<ResultRow['qualification']>

async function loadScores(userId: string, runId: string): Promise<Map<string, ScoreSummary>> {
  const { data } = await createAdminClient()
    .from('qualification_results')
    .select('entity_id, score, qualified, disqualified_by, unknown_count, breakdown')
    .eq('user_id', userId)
    .eq('research_run_id', runId)

  const byEntity = new Map<string, ScoreSummary>()

  for (const row of data ?? []) {
    const breakdown = Array.isArray(row.breakdown)
      ? (row.breakdown as Array<{ field?: string; outcome?: string; observed?: unknown }>)
      : []

    byEntity.set(row.entity_id, {
      score: row.score,
      qualified: row.qualified,
      disqualifiedBy: row.disqualified_by,
      unknownCount: row.unknown_count,
      // Built from the stored per-criterion outcomes, so the reason shown
      // always matches the arithmetic that produced the score (spec §33).
      reasons: breakdown
        .filter((entry) => entry.outcome === 'met')
        .map((entry) => `${entry.field}: ${formatValue(entry.observed)}`)
        .slice(0, 6),
    })
  }

  return byEntity
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'unknown'
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === 'object' && 'name' in item
          ? String((item as { name: unknown }).name)
          : String(item),
      )
      .join(', ')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Pre-flight estimate shown BEFORE a run starts (spec §31).
 *
 * The point is that a user never accidentally spends a large amount because a
 * scope selector defaulted to "everything". It reports leads and — crucially —
 * DISTINCT COMPANIES, because that is what actually gets researched and
 * therefore what the cost tracks.
 */
export async function estimateScope(
  userId: string,
  scope: ResearchScope,
): Promise<{ leadCount: number; companyCount: number }> {
  const supabase = createAdminClient()

  if (scope.type === 'lead_ids') {
    const ids = scope.leadIds ?? []
    if (ids.length === 0) return { leadCount: 0, companyCount: 0 }

    const { data } = await supabase
      .from('extracted_leads')
      .select('company_id')
      .eq('user_id', userId)
      .in('id', ids.slice(0, 1000))

    return {
      leadCount: ids.length,
      companyCount: new Set((data ?? []).map((row) => row.company_id).filter(Boolean)).size,
    }
  }

  if (scope.type === 'company_ids') {
    const { count } = await supabase
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('id', scope.companyIds)

    return { leadCount: 0, companyCount: count ?? 0 }
  }

  if (scope.type === 'workspace') {
    const [{ count: leadCount }, { count: companyCount }] = await Promise.all([
      supabase
        .from('extracted_leads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ])

    return { leadCount: leadCount ?? 0, companyCount: companyCount ?? 0 }
  }

  /*
   * Every remaining scope is lead-derived. Count the leads and their DISTINCT
   * linked companies from the same paged rows, so an extraction/date estimate
   * cannot accidentally display the workspace-wide company total. Paging is
   * required because PostgREST otherwise returns only its first 1,000 rows.
   */
  const companies = new Set<string>()
  let leadCount = 0
  const PAGE = 1000
  const bounds = scope.type === 'date_range' ? dateRangeBounds(scope.from, scope.to) : null
  if (scope.type === 'date_range' && !bounds) return { leadCount: 0, companyCount: 0 }

  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from('extracted_leads')
      .select('company_id')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (scope.type === 'extraction_job') {
      query = query.eq('extraction_job_id', scope.extractionJobId)
    }

    if (scope.type === 'date_range' && bounds) {
      query = query
        .gte('created_at', bounds.fromInclusive)
        .lt('created_at', bounds.toExclusive)
    }

    const { data, error } = await query
    if (error) throw new Error('Could not estimate the selected research scope.')

    const rows = data ?? []
    leadCount += rows.length
    for (const row of rows) if (row.company_id) companies.add(row.company_id)
    if (rows.length < PAGE) break
  }

  return { leadCount, companyCount: companies.size }
}
