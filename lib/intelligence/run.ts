import 'server-only'

import { createHash } from 'node:crypto'

/**
 * The research runner — the thing that turns a plan into answers.
 *
 * Deployment-agnostic, exactly like `lib/worker/process-job.ts`: today it is
 * triggered by `after()`, later by a long-running loop. Neither this file nor
 * the queue semantics change, only the caller.
 *
 * The order of operations IS the cost model, and it is not negotiable:
 *
 *   1. resolve the scope to LEADS
 *   2. collapse those leads to distinct COMPANIES        ← spec §9
 *   3. read what Outlio already knows                    ← spec §8
 *   4. route only the gaps to the minimum providers      ← spec §15
 *   5. execute, isolating failures                       ← spec §49
 *   6. persist evidence with provenance                  ← spec §16
 *
 * Steps 2 and 3 are where the money is saved. Skipping either turns a £2 query
 * into a £200 one.
 */
import { getAllCompanies, getCompaniesByIds, getCompaniesForLeads } from '@/lib/companies/repository'
import { dateRangeBounds } from '@/lib/intelligence/date-range'
import { deriveAll, derivedEvidence } from '@/lib/intelligence/derive'
import { expiresAtFor } from '@/lib/intelligence/ttl'
import { executeTasks, executeTasksInChunks, type ExecutionReport } from '@/lib/intelligence/execute'
import { readEvidence, recordToolCalls, writeEvidence } from '@/lib/intelligence/evidence-store'
import { normalizeMcpResearch, persistMcpDocuments } from '@/lib/intelligence/mcp-research'
import {
  isExecutable,
  researchScopeSchema,
  validatePlan,
  type ResearchPlan,
  type ResearchScope,
} from '@/lib/intelligence/plan'
import { applyClarifications } from '@/lib/intelligence/planner'
import { buildLiveRegistry } from '@/lib/intelligence/providers'
import { planToTasks } from '@/lib/intelligence/router'
import { hasWebSearch } from '@/lib/search'
import { McpLeadResearchClient } from '@/lib/intelligence/providers/mcp-research'
import { preserveExplicitConstraints } from '@/lib/intelligence/filters'
import {
  RESEARCH_FIELD_SPEC,
  type CompanyEntity,
  type EvidenceRecord,
  type PersonEntity,
  type ResearchField,
  type ResearchTask,
  type ToolCategory,
} from '@/lib/intelligence/types'
import { getProfile, saveResults } from '@/lib/qualification/repository'
import { scoreEntity, type QualificationResult } from '@/lib/qualification/score'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

/** Leads read per page. PostgREST caps responses; never use a bare `.limit()`. */
const PAGE_SIZE = 1000

const ACTIVE_RUN_STATUSES = [
  'pending',
  'planning',
  'waiting_for_clarification',
  'running',
] as const

type EvidenceGap = {
  provider: 'web-research-mcp'
  entityType: 'company' | 'person'
  entityId: string
  reason: 'deadline' | 'unavailable' | 'invalid_response'
}

async function updateResearchProgress(
  runId: string,
  userId: string,
  stage: string,
  current = 0,
  total = 0,
  evidenceGaps?: readonly EvidenceGap[],
): Promise<void> {
  const update: Record<string, unknown> = {
    progress_stage: stage,
    progress_current: current,
    progress_total: total,
  }
  if (evidenceGaps) update.evidence_gaps = evidenceGaps

  await createAdminClient()
    .from('research_runs')
    .update(update as never)
    .eq('id', runId)
    .eq('user_id', userId)
}

function mcpEntityLimit(): number {
  const parsed = Number.parseInt(process.env.WEB_RESEARCH_MCP_MAX_ENTITIES ?? '3', 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 10) : 3
}

function knowledgeHas(
  knowledge: ReadonlyMap<string, import('@/lib/intelligence/evidence').FieldKnowledge>,
  entityType: 'company' | 'person',
  entityId: string,
  field: ResearchField,
): boolean {
  return knowledge.get(`${entityType}:${entityId}:${field}`)?.state === 'known'
}

async function runMcpAcquisitionStage(input: {
  runId: string
  userId: string
  companies: readonly CompanyEntity[]
  people: readonly PersonEntity[]
  companyFields: readonly ResearchField[]
  personFields: readonly ResearchField[]
  knowledge: ReadonlyMap<string, import('@/lib/intelligence/evidence').FieldKnowledge>
}): Promise<{
  evidenceWritten: number
  externalCalls: number
  gaps: EvidenceGap[]
}> {
  const client = new McpLeadResearchClient()
  const limit = mcpEntityLimit()
  if (!client.isConfigured() || limit === 0) {
    return { evidenceWritten: 0, externalCalls: 0, gaps: [] }
  }

  const companyById = new Map(input.companies.map((company) => [company.id, company]))
  const candidates: Array<{
    company: CompanyEntity
    person?: PersonEntity
    fields: ResearchField[]
  }> = []
  const representedCompanies = new Set<string>()

  for (const person of input.people) {
    if (candidates.length >= limit) break
    if (!person.companyId) continue
    const company = companyById.get(person.companyId)
    if (!company) continue
    const fields = input.personFields.filter((field) =>
      !knowledgeHas(input.knowledge, 'person', person.id, field),
    )
    if (fields.length === 0) continue
    const companyGaps = input.companyFields.filter((field) =>
      !knowledgeHas(input.knowledge, 'company', company.id, field),
    )
    candidates.push({ company, person, fields: [...new Set([...fields, ...companyGaps])] })
    representedCompanies.add(company.id)
  }

  for (const company of input.companies) {
    if (candidates.length >= limit) break
    if (representedCompanies.has(company.id)) continue
    const fields = input.companyFields.filter((field) =>
      !knowledgeHas(input.knowledge, 'company', company.id, field),
    )
    if (fields.length > 0) candidates.push({ company, fields })
  }

  if (candidates.length === 0) return { evidenceWritten: 0, externalCalls: 0, gaps: [] }

  const gaps: EvidenceGap[] = []
  let evidenceWritten = 0
  let externalCalls = 0
  const deadlineAt = Date.now() + 150_000

  await updateResearchProgress(input.runId, input.userId, 'web_research', 0, candidates.length)

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!
    const displayName = candidate.person?.fullName ?? candidate.company.name ?? candidate.company.domain
    const companyName = candidate.company.name ?? candidate.company.domain
    if (!displayName || !companyName) continue

    const attempt = await client.research({
      name: displayName,
      jobTitle: candidate.person?.jobTitle ?? null,
      company: companyName,
      companyDomain: candidate.company.domain,
      linkedinUrl: candidate.person?.linkedinUrl ?? candidate.company.linkedinUrl,
    }, candidate.fields, deadlineAt)
    externalCalls += 1

    if (!attempt.ok) {
      if (attempt.reason !== 'not_configured') {
        gaps.push({
          provider: 'web-research-mcp',
          entityType: candidate.person ? 'person' : 'company',
          entityId: candidate.person?.id ?? candidate.company.id,
          reason: attempt.reason,
        })
      }
      await recordToolCalls(input.userId, input.runId, [{
        provider: 'web-research-mcp',
        tool: 'web_research',
        entityType: candidate.person ? 'person' : 'company',
        entityId: candidate.person?.id ?? candidate.company.id,
        status: attempt.reason === 'deadline' ? 'timeout' : 'error',
        latencyMs: attempt.latencyMs,
        estimatedCostMicros: 0,
        errorCode: attempt.reason === 'deadline' ? 'ERR_TIMEOUT' : 'ERR_PROVIDER_UNAVAILABLE',
      }])
    } else {
      const evidence = normalizeMcpResearch(attempt.result, {
        company: candidate.company,
        person: candidate.person,
      })
      evidenceWritten += (await writeEvidence(input.userId, input.runId, evidence)).written
      await persistMcpDocuments(input.userId, candidate.company.id, attempt.result).catch(() => ({
        pages: 0,
        chunks: 0,
      }))
      await recordToolCalls(input.userId, input.runId, [{
        provider: 'web-research-mcp',
        tool: 'web_research',
        entityType: candidate.person ? 'person' : 'company',
        entityId: candidate.person?.id ?? candidate.company.id,
        status: evidence.length > 0 || attempt.result.documents.length > 0 ? 'success' : 'not_found',
        latencyMs: attempt.latencyMs,
        estimatedCostMicros: 0,
        errorCode: null,
      }])
    }

    await updateResearchProgress(
      input.runId,
      input.userId,
      'web_research',
      index + 1,
      candidates.length,
      gaps,
    )
  }

  return { evidenceWritten, externalCalls, gaps }
}

export type ResearchOutcome = {
  runId: string
  status: 'completed' | 'partially_complete' | 'failed'
  leadCount: number
  companyCount: number
  cacheHits: number
  externalCalls: number
  evidenceWritten: number
  estimatedCostMicros: number
  /** Entities that met the profile. Null when the run scored nothing. */
  qualifiedCount: number | null
}

function concise(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? ''
  const stripped = first.startsWith('<') ? 'upstream returned HTML' : first
  return stripped.length > 160 ? `${stripped.slice(0, 160)}…` : stripped
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function researchIdempotencyKey(input: {
  queryText: string
  scope: ResearchScope
  plan: ResearchPlan
  qualificationProfileId?: string | null
}): string {
  return createHash('sha256').update(canonicalJson({
    query: input.queryText.toLowerCase().replace(/\s+/g, ' ').trim(),
    scope: input.scope,
    plan: input.plan,
    qualificationProfileId: input.qualificationProfileId ?? null,
    version: 1,
  })).digest('hex')
}

export type CreateRunResult =
  | { ok: true; runId: string; status: 'queued' }
  | {
      ok: true
      runId: string
      status: 'waiting_for_clarification'
      questions: ResearchPlan['clarificationQuestions']
    }
  | { ok: false; reason: string }

/**
 * Creates a run.
 *
 * A plan that still needs clarification is STORED BUT NOT ENQUEUED. That is the
 * whole point of spec §7: while a question is open, nothing is researched and
 * nothing is charged. The run sits in `waiting_for_clarification` until the
 * user answers, and `answerClarifications` is the only thing that releases it.
 *
 * The plan is validated before the row exists, so an invalid plan can never
 * occupy the queue or appear in history as something that was attempted.
 */
export async function createResearchRun(
  userId: string,
  input: {
    queryText: string
    scope: ResearchScope
    plan: unknown
    /** ICP to score against. NULL means research only, no scoring. */
    qualificationProfileId?: string | null
  },
): Promise<CreateRunResult> {
  const validation = validatePlan(input.plan)
  if (!validation.ok) return { ok: false, reason: validation.reason }

  const plan = validation.plan
  const needsClarification = !isExecutable(plan)
  const idempotencyKey = researchIdempotencyKey({
    queryText: input.queryText,
    scope: input.scope,
    plan,
    qualificationProfileId: input.qualificationProfileId,
  })

  const supabase = createAdminClient()

  const { data: active } = await supabase
    .from('research_runs')
    .select('id, status')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .in('status', [...ACTIVE_RUN_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (active) {
    return active.status === 'waiting_for_clarification'
      ? {
          ok: true,
          runId: active.id,
          status: 'waiting_for_clarification',
          questions: plan.clarificationQuestions,
        }
      : { ok: true, runId: active.id, status: 'queued' }
  }

  const { data, error } = await supabase
    .from('research_runs')
    .insert({
      user_id: userId,
      idempotency_key: idempotencyKey,
      status: needsClarification ? 'waiting_for_clarification' : 'pending',
      progress_stage: needsClarification ? 'waiting_for_clarification' : 'queued',
      query_text: input.queryText,
      // Validated above, so serialising to jsonb is safe. The cast exists
      // because a Zod-inferred shape is structurally wider than `Json`.
      scope: input.scope as unknown as Json,
      plan: plan as unknown as Json,
      qualification_profile_id: input.qualificationProfileId ?? null,
      clarifications: (needsClarification
        ? [{ askedAt: new Date().toISOString(), questions: plan.clarificationQuestions }]
        : []) as unknown as Json,
    })
    .select('id')
    .single()

  if (error || !data) {
    // The partial unique index closes the race between the lookup above and
    // this insert. If another request won, join its run rather than surfacing
    // a duplicate-key error to the user.
    const { data: raced } = await supabase
      .from('research_runs')
      .select('id, status')
      .eq('user_id', userId)
      .eq('idempotency_key', idempotencyKey)
      .in('status', [...ACTIVE_RUN_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (raced) {
      return raced.status === 'waiting_for_clarification'
        ? {
            ok: true,
            runId: raced.id,
            status: 'waiting_for_clarification',
            questions: plan.clarificationQuestions,
          }
        : { ok: true, runId: raced.id, status: 'queued' }
    }
    return { ok: false, reason: concise(error?.message ?? 'run could not be created') }
  }

  if (needsClarification) {
    return {
      ok: true,
      runId: data.id,
      status: 'waiting_for_clarification',
      questions: plan.clarificationQuestions,
    }
  }

  const { error: queueError } = await supabase.rpc('enqueue_research_run', { p_run_id: data.id })
  if (queueError) {
    await supabase
      .from('research_runs')
      .update({
        status: 'failed',
        progress_stage: 'failed',
        error_code: 'ERR_QUEUE_UNAVAILABLE',
        error_message: 'The research run could not be queued.',
        completed_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .eq('user_id', userId)
    return { ok: false, reason: concise(queueError.message) }
  }

  return { ok: true, runId: data.id, status: 'queued' }
}

/**
 * Folds the user's answers into a waiting run and releases it to the queue.
 *
 * Both halves of the exchange are appended to `clarifications`, so a run always
 * records what was asked and what the user actually chose — which is the
 * difference between a reproducible result and one nobody can explain later.
 *
 * Idempotent in the way that matters: a run that is not waiting is left alone
 * rather than being re-queued, so a double-submitted form cannot run twice.
 */
export async function answerClarifications(
  userId: string,
  runId: string,
  answers: Record<string, string>,
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  const supabase = createAdminClient()

  const { data: run, error } = await supabase
    .from('research_runs')
    .select('id, status, query_text, plan, clarifications')
    .eq('id', runId)
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return { ok: false, reason: concise(error.message) }
  if (!run) return { ok: false, reason: 'That research run could not be found.' }

  if (run.status !== 'waiting_for_clarification') {
    return { ok: false, reason: 'That research run is not waiting for an answer.' }
  }

  const validation = validatePlan(run.plan)
  if (!validation.ok) return { ok: false, reason: 'The stored plan was not valid.' }

  const updated = preserveExplicitConstraints(
    run.query_text,
    applyClarifications(validation.plan, answers),
  )
  if (!isExecutable(updated)) {
    return { ok: false, reason: 'That answer did not resolve the question.' }
  }

  const history = Array.isArray(run.clarifications) ? run.clarifications : []

  const { error: updateError } = await supabase
    .from('research_runs')
    .update({
      status: 'pending',
      progress_stage: 'queued',
      plan: updated as unknown as Json,
      clarifications: [
        ...history,
        { answeredAt: new Date().toISOString(), answers },
      ] as unknown as Json,
    })
    .eq('id', runId)
    .eq('user_id', userId)
    .eq('status', 'waiting_for_clarification')

  if (updateError) return { ok: false, reason: concise(updateError.message) }

  const { error: queueError } = await supabase.rpc('enqueue_research_run', { p_run_id: runId })
  if (queueError) {
    await supabase
      .from('research_runs')
      .update({
        status: 'failed',
        progress_stage: 'failed',
        error_code: 'ERR_QUEUE_UNAVAILABLE',
        error_message: 'The research run could not be queued.',
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('user_id', userId)
    return { ok: false, reason: concise(queueError.message) }
  }

  return { ok: true, runId }
}

/** Resolves a scope to lead ids, paging properly. Always user-scoped. */
async function resolveScope(userId: string, scope: ResearchScope): Promise<string[]> {
  if (scope.type === 'lead_ids') return scope.leadIds

  /*
   * ⚠️ THE SCOPES ALLOWED TO REACH THE QUERY BELOW ARE NAMED, NOT ASSUMED.
   *
   * That query returns the user's ENTIRE lead table unless a branch narrows
   * it, and the narrowing branches are opt-in. So without this guard any scope
   * type added later inherits the widest possible read simply by matching no
   * branch — an unbounded spend arriving through an omission. Of the four
   * named, only `all_leads` and `workspace` actually mean every lead; the
   * other two narrow below.
   */
  if (
    scope.type !== 'all_leads' &&
    scope.type !== 'workspace' &&
    scope.type !== 'extraction_job' &&
    scope.type !== 'date_range'
  ) {
    return []
  }

  const supabase = createAdminClient()
  const ids: string[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('extracted_leads')
      .select('id')
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (scope.type === 'extraction_job') {
      query = query.eq('extraction_job_id', scope.extractionJobId)
    }

    if (scope.type === 'date_range') {
      const bounds = dateRangeBounds(scope.from, scope.to)
      // A range that will not parse must resolve to NOTHING, never to every
      // lead the user owns — the difference is a large unintended spend.
      if (!bounds) return []
      query = query
        .gte('created_at', bounds.fromInclusive)
        .lt('created_at', bounds.toExclusive)
    }

    const { data, error } = await query
    if (error) throw new Error(`scope resolution failed: ${concise(error.message)}`)

    const rows = data ?? []
    ids.push(...rows.map((row) => row.id))
    if (rows.length < PAGE_SIZE) break
  }

  return ids
}

/**
 * Writes a discovered domain back onto the company row.
 *
 * This closes the loop that makes the whole chain work: a domain found by
 * Wikidata or discovery becomes the company's stored identity, so every later
 * run — and every provider that needs a website — starts from it instead of
 * paying to rediscover it.
 *
 * Guarded: another company may already own that domain, and a unique-index
 * collision is not a reason to fail a run whose evidence is already written.
 */
async function persistDiscoveredDomains(
  userId: string,
  evidence: readonly { field: string; entityId: string; value: Record<string, unknown> }[],
): Promise<void> {
  const supabase = createAdminClient()

  for (const item of evidence) {
    if (item.field !== 'company_domain') continue
    const domain = item.value.domain
    if (typeof domain !== 'string' || !domain) continue

    try {
      await supabase
        .from('companies')
        .update({ domain, normalized_domain: domain })
        .eq('id', item.entityId)
        .eq('user_id', userId)
        .is('normalized_domain', null)
    } catch {
      // Evidence is the source of truth; this column is a convenience.
    }
  }
}

/** Processes one claimed run end to end. Never throws for a provider problem. */
export async function processResearchRun(
  runId: string,
  userId: string,
): Promise<ResearchOutcome> {
  const supabase = createAdminClient()
  const startedAt = Date.now()

  const { data: run } = await supabase
    .from('research_runs')
    .select('id, user_id, scope, plan, qualification_profile_id')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!run) throw new Error('processResearchRun: run not found for this user')

  const validation = validatePlan(run.plan)
  if (!validation.ok) {
    await failRun(runId, userId, 'ERR_VALIDATION', 'The research plan was not valid.')
    return emptyOutcome(runId, 'failed')
  }

  const plan: ResearchPlan = validation.plan

  // The scope was validated when the run was created, but it has been through
  // jsonb since. Re-validating costs nothing and keeps a hand-edited row from
  // steering a paid job at the wrong leads.
  const parsedScope = researchScopeSchema.safeParse(run.scope)
  if (!parsedScope.success) {
    await failRun(runId, userId, 'ERR_VALIDATION', 'The research scope was not valid.')
    return emptyOutcome(runId, 'failed')
  }
  const scope: ResearchScope = parsedScope.data

  // ---- 1. scope → leads --------------------------------------------------
  await updateResearchProgress(runId, userId, 'resolving_scope')
  const leadIds = scope.type === 'company_ids' ? [] : await resolveScope(userId, scope)

  // ---- 2. scope target → distinct companies (spec §9) ---------------------
  /*
   * A `company_ids` scope names its companies directly and skips the lead
   * hop entirely — that is its reason to exist: companies linked to no
   * surviving lead are unreachable through any lead-scoped read, and people
   * loading below already short-circuits on an empty lead list.
   */
  const { companies } =
    scope.type === 'company_ids'
      ? { companies: await getCompaniesByIds(userId, scope.companyIds) }
      : scope.type === 'workspace'
        ? /*
           * ⚠️ NOT `getCompaniesForLeads(everyLead)`. That walks leads to reach
           * companies, so it can never return a company no lead points at —
           * which is every company a saved ACCOUNT LIST produced. Reading the
           * companies directly is the only way macro analysis sees them.
           */
          { companies: await getAllCompanies(userId) }
        : await getCompaniesForLeads(userId, leadIds)

  const companyEntities: CompanyEntity[] = companies.map((company) => ({
    type: 'company',
    id: company.id,
    name: company.name,
    domain: company.normalizedDomain,
    linkedinUrl: company.normalizedLinkedInUrl,
  }))

  const peopleEntities: PersonEntity[] = await loadPeople(userId, leadIds, plan)

  await supabase
    .from('research_runs')
    .update({
      lead_count: leadIds.length,
      company_count: companyEntities.length,
    })
    .eq('id', runId)
    .eq('user_id', userId)

  // ---- 3. what we already know (spec §8) ---------------------------------
  const companyFields = plan.requiredFields.filter(
    (field) => RESEARCH_FIELD_SPEC[field].entity === 'company',
  )
  const personFields = plan.requiredFields.filter(
    (field) => RESEARCH_FIELD_SPEC[field].entity === 'person',
  )

  /*
   * ⚠️ COMPANY FACTS RUN FIRST, AND CONTACT TASKS ARE ROUTED AFTER THEM.
   *
   * The contact waterfall keys on a company domain — and for a fresh
   * extraction that domain often does not exist until THIS run's
   * company-profile phase discovers it. Routing contact tasks against the
   * pre-run snapshot makes every provider decline (no domain), the run report
   * `unknown`, and the discovery we just paid for sit unused. So: company
   * phase → persist → reload people with fresh domains → contact phase.
   */
  await updateResearchProgress(runId, userId, 'checking_cache')
  let knowledge = await readEvidence(userId, [
    { entityType: 'company', entityIds: companyEntities.map((c) => c.id), fields: companyFields },
    { entityType: 'person', entityIds: peopleEntities.map((p) => p.id), fields: personFields },
  ])

  // Hubble owns this durable run. The MCP performs bounded acquisition only;
  // it does not create a second job or persist a parallel result bundle.
  const mcpStage = await runMcpAcquisitionStage({
    runId,
    userId,
    companies: companyEntities,
    people: peopleEntities,
    companyFields,
    personFields,
    knowledge,
  })
  if (mcpStage.evidenceWritten > 0) {
    knowledge = await readEvidence(userId, [
      { entityType: 'company', entityIds: companyEntities.map((c) => c.id), fields: companyFields },
      { entityType: 'person', entityIds: peopleEntities.map((p) => p.id), fields: personFields },
    ])
  }

  await updateResearchProgress(runId, userId, 'provider_research')

  const executionOptions = {
    registry: buildLiveRegistry(),
    // The operator-owned service is paced at the HTTP layer. Eight overlapping
    // requests keeps a visible 25-lead search responsive without bursting the
    // upstream engines; third-party categories retain the conservative four.
    concurrency:
      hasWebSearch() &&
      (companyFields.length > 0 ||
        plan.requiredFields.some((field) =>
          ['funding', 'web_research', 'company_profile'].includes(
            RESEARCH_FIELD_SPEC[field].category,
          ),
        ))
        ? 2
        : undefined,
  }

  const chunked =
    scope.type === 'all_leads' || scope.type === 'company_ids' || scope.type === 'workspace'
  const runChunk = async (tasks: readonly ResearchTask[]) =>
    chunked ? executeTasksInChunks(tasks, executionOptions, 25) : executeTasks(tasks, executionOptions)

  // ---- 4a. company phase --------------------------------------------------
  const companyRouting =
    companyFields.length > 0
      ? planToTasks({
          companies: companyEntities,
          people: [],
          requiredFields: companyFields,
          filters: plan.filters,
          knowledge,
        })
      : { tasks: [], cacheHits: 0, categories: [] as ToolCategory[] }

  const companyReport =
    companyRouting.tasks.length > 0 ? await runChunk(companyRouting.tasks) : null

  // ---- 5. persist with provenance (spec §16) -----------------------------
  let writtenTotal = mcpStage.evidenceWritten

  if (companyReport) {
    const writtenCompany = await writeEvidence(userId, runId, companyReport.evidence)
    writtenTotal += writtenCompany.written
    // Windfall facts are worth exactly as much as requested ones next time,
    // and they were already paid for.
    writtenTotal += (await writeEvidence(userId, runId, companyReport.bonusEvidence)).written
    await recordToolCalls(userId, runId, companyReport.toolCalls)
    // Discovery must reach the companies table BEFORE the contact phase
    // routes — that persistence IS the handoff.
    await persistDiscoveredDomains(userId, [
      ...companyReport.evidence,
      ...companyReport.bonusEvidence,
    ])
  }

  // ---- 4b/5b. contact phase, against freshly resolved domains -------------
  let peopleForContact: PersonEntity[] = []
  let personReport: ExecutionReport | null = null
  let personCacheHits = 0
  let personCategories: ToolCategory[] = []

  if (personFields.length > 0 && leadIds.length > 0) {
    peopleForContact = await loadPeople(userId, leadIds, plan)
    const personKnowledge = await readEvidence(userId, [
      { entityType: 'person', entityIds: peopleForContact.map((p) => p.id), fields: personFields },
    ])

    const personRouting = planToTasks({
      companies: [],
      people: peopleForContact,
      requiredFields: personFields,
      filters: plan.filters,
      knowledge: personKnowledge,
    })
    personCacheHits = personRouting.cacheHits
    personCategories = personRouting.categories

    if (personRouting.tasks.length > 0) {
      personReport = await runChunk(personRouting.tasks)
      writtenTotal += (await writeEvidence(userId, runId, personReport.evidence)).written
      writtenTotal += (await writeEvidence(userId, runId, personReport.bonusEvidence)).written
      await recordToolCalls(userId, runId, personReport.toolCalls)
      await persistDiscoveredDomains(userId, [
        ...personReport.evidence,
        ...personReport.bonusEvidence,
      ])
    }
  }

  // ---- combined report ----------------------------------------------------
  const mergedResults = [
    ...(companyReport?.results ?? []),
    ...(personReport?.results ?? []),
  ]
  const report = {
    results: mergedResults,
    externalCallCount:
      mcpStage.externalCalls +
      (companyReport?.externalCallCount ?? 0) +
      (personReport?.externalCallCount ?? 0),
    estimatedCostMicros:
      (companyReport?.estimatedCostMicros ?? 0) + (personReport?.estimatedCostMicros ?? 0),
  }
  const cacheHits = companyRouting.cacheHits + personCacheHits
  const categories: ToolCategory[] = [...new Set([
    ...(mcpStage.externalCalls > 0 ? ['web_research' as const] : []),
    ...companyRouting.categories,
    ...personCategories,
  ])]

  // ---- 6b. derive, for free ----------------------------------------------
  const derivedCount = await deriveForCompanies(
    userId,
    runId,
    companyEntities.map((entity) => entity.id),
  )

  // ---- 7. qualify (spec §19) ---------------------------------------------
  await updateResearchProgress(runId, userId, 'qualifying')
  const qualifiedCount = await qualifyRun(
    userId,
    runId,
    run.qualification_profile_id,
    companyEntities.map((entity) => ({ id: entity.id, type: 'company' as const })),
    plan.requiredFields,
  )

  /*
   * A run is `completed` only when nothing was left unanswered. Anything else
   * is `partially_complete` — an honest status a user can act on, rather than a
   * green tick over a table full of blanks.
   */
  const anyUnknown = report.results.some((result) => result.unknownFields.length > 0)
  const routedTaskCount = (companyRouting.tasks?.length ?? 0) + (personReport ? 1 : 0)
  const status: ResearchOutcome['status'] =
    routedTaskCount === 0 || !anyUnknown ? 'completed' : 'partially_complete'

  await supabase
    .from('research_runs')
    .update({
      status,
      tools_used: categories,
      external_call_count: report.externalCallCount,
      cache_hit_count: cacheHits,
      estimated_cost_micros: report.estimatedCostMicros,
      actual_cost_micros: report.estimatedCostMicros,
      qualified_count: qualifiedCount ?? 0,
      duration_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
      progress_stage: 'completed',
      progress_current: 1,
      progress_total: 1,
    })
    .eq('id', runId)
    .eq('user_id', userId)

  await supabase.from('research_job_queue').update({ status: 'done' }).eq('research_run_id', runId)

  return {
    runId,
    status,
    leadCount: leadIds.length,
    companyCount: companyEntities.length,
    cacheHits,
    externalCalls: report.externalCallCount,
    evidenceWritten: writtenTotal + derivedCount,
    estimatedCostMicros: report.estimatedCostMicros,
    qualifiedCount,
  }
}

/**
 * Computes trend facts from evidence already held. Costs nothing.
 *
 * Runs AFTER this run's own findings are written, so a company researched for
 * the first time today can still contribute its history to a derivation
 * tomorrow. Non-fatal: a derived fact is recomputable at any time from the
 * observations, which are the durable product.
 */
async function deriveForCompanies(
  userId: string,
  runId: string,
  companyIds: readonly string[],
): Promise<number> {
  if (companyIds.length === 0) return 0

  try {
    const supabase = createAdminClient()
    let written = 0

    for (let i = 0; i < companyIds.length; i += 100) {
      const batch = companyIds.slice(i, i + 100)

      const { data } = await supabase
        .from('research_evidence')
        .select('id, entity_type, entity_id, field, value_json, source_provider, source_url, source_confidence, confidence, retrieved_at, expires_at, research_run_id')
        // Service role bypasses RLS — scoping by user_id is mandatory.
        .eq('user_id', userId)
        .eq('entity_type', 'company')
        .in('entity_id', batch)
        .order('retrieved_at', { ascending: true })

      const byCompany = new Map<string, EvidenceRecord[]>()
      for (const row of data ?? []) {
        const record: EvidenceRecord = {
          id: row.id,
          entityType: 'company',
          entityId: row.entity_id,
          field: row.field as EvidenceRecord['field'],
          value: (row.value_json ?? {}) as Record<string, unknown>,
          sourceProvider: row.source_provider,
          sourceUrl: row.source_url,
          sourceConfidence: row.source_confidence as 'low' | 'medium' | 'high',
          confidence: Number(row.confidence),
          retrievedAt: row.retrieved_at,
          expiresAt: row.expires_at,
          researchRunId: row.research_run_id,
        }
        const bucket = byCompany.get(row.entity_id) ?? []
        bucket.push(record)
        byCompany.set(row.entity_id, bucket)
      }

      for (const [companyId, history] of byCompany) {
        const facts = deriveAll(history)
        if (facts.length === 0) continue

        const evidence = derivedEvidence(facts, companyId, (field, at) =>
          expiresAtFor(field, at),
        )
        const result = await writeEvidence(userId, runId, evidence)
        written += result.written
      }
    }

    return written
  } catch {
    // Derived facts are pure arithmetic over stored evidence and can always be
    // recomputed. Never fail a run whose evidence is already committed.
    return 0
  }
}

/**
 * Scores the run's entities against its profile, if it has one.
 *
 * ⚠️ EVIDENCE IS RE-READ HERE, AFTER the run's own findings were written.
 * Scoring against the pre-research snapshot would ignore everything this run
 * just paid for — every freshly researched company would score as `unknown`.
 *
 * Non-fatal: the evidence is already committed and is the durable product.
 * A scoring failure costs a re-score, not the run.
 */
async function qualifyRun(
  userId: string,
  runId: string,
  profileId: string | null,
  entities: ReadonlyArray<{ id: string; type: 'company' }>,
  researchedFields: readonly ResearchField[],
): Promise<number | null> {
  if (!profileId || entities.length === 0) return null

  try {
    const profile = await getProfile(userId, profileId)
    // Scoped by user id, so another tenant's profile resolves to null rather
    // than scoring this run against criteria its owner never configured.
    if (!profile || profile.criteria.length === 0) return null

    // The union of what the plan researched and what the profile asks about:
    // a profile may score on facts a previous run already established.
    const fields = [
      ...new Set<ResearchField>([
        ...researchedFields,
        ...profile.criteria.map((criterion) => criterion.field),
      ]),
    ]

    const knowledge = await readEvidence(userId, [
      { entityType: 'company', entityIds: entities.map((entity) => entity.id), fields },
    ])

    const results: QualificationResult[] = entities.map((entity) =>
      scoreEntity(profile, entity, knowledge, { qualifyAtOrAbove: profile.qualifyAt }),
    )

    await saveResults(userId, runId, profileId, results)

    return results.filter((result) => result.qualified).length
  } catch {
    // Scoring is recomputable from stored evidence; the evidence is not.
    return null
  }
}

/** Person entities are loaded only when the plan actually needs person fields. */
async function loadPeople(
  userId: string,
  leadIds: readonly string[],
  plan: ResearchPlan,
): Promise<PersonEntity[]> {
  const needsPeople = plan.requiredFields.some(
    (field) => RESEARCH_FIELD_SPEC[field].entity === 'person',
  )
  if (!needsPeople || leadIds.length === 0) return []

  const supabase = createAdminClient()
  const people: PersonEntity[] = []

  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await supabase
      .from('extracted_leads')
      .select('id, full_name, linkedin_url, job_title, company_name, company_website_url, company_id, location')
      .eq('user_id', userId)
      .in('id', leadIds.slice(i, i + 200))

    // The research-grade domain beats the captured one: discovery may have
    // resolved a website this lead never carried, and every contact provider
    // keys on it.
    const companyIdsToResolve = [
      ...new Set(
        (data ?? [])
          .filter((row) => !row.company_website_url && row.company_id)
          .map((row) => row.company_id as string),
      ),
    ]

    const resolvedDomains = new Map<string, string>()
    for (let j = 0; j < companyIdsToResolve.length; j += 100) {
      const { data: companyRows } = await supabase
        .from('companies')
        .select('id, normalized_domain')
        .eq('user_id', userId)
        .in('id', companyIdsToResolve.slice(j, j + 100))

      for (const row of companyRows ?? []) {
        if (row.normalized_domain) resolvedDomains.set(row.id, row.normalized_domain)
      }
    }

    for (const row of data ?? []) {
      people.push({
        type: 'person',
        id: row.id,
        fullName: row.full_name,
        linkedinUrl: row.linkedin_url,
        jobTitle: row.job_title,
        location: row.location,
        companyName: row.company_name,
        companyDomain:
          row.company_website_url ??
          (row.company_id ? resolvedDomains.get(row.company_id) ?? null : null),
        companyId: row.company_id,
      })
    }
  }

  return people
}

async function failRun(
  runId: string,
  userId: string,
  code: string,
  message: string,
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('research_runs')
    .update({
      status: 'failed',
      error_code: code,
      error_message: message,
      completed_at: new Date().toISOString(),
      progress_stage: 'failed',
    })
    .eq('id', runId)
    .eq('user_id', userId)

  await supabase.from('research_job_queue').update({ status: 'failed' }).eq('research_run_id', runId)
}

function emptyOutcome(runId: string, status: ResearchOutcome['status']): ResearchOutcome {
  return {
    runId,
    status,
    leadCount: 0,
    companyCount: 0,
    cacheHits: 0,
    externalCalls: 0,
    evidenceWritten: 0,
    estimatedCostMicros: 0,
    qualifiedCount: null,
  }
}

/**
 * Atomically claims the run that caused this wake-up, then processes it.
 *
 * Returns null when another worker already has it — which is the correct,
 * quiet outcome, not an error.
 */
export async function claimAndProcessResearchRun(
  runId: string,
  userId: string,
  claimedBy: string,
): Promise<ResearchOutcome | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('claim_research_run', {
    p_run_id: runId,
    p_user_id: userId,
    p_claimed_by: claimedBy,
  })
  if (error) throw new Error(`research claim failed: ${concise(error.message)}`)

  const claim = Array.isArray(data) ? data[0] : null
  if (!claim) return null

  try {
    return await processResearchRun(runId, userId)
  } catch (e) {
    const message = concise(e instanceof Error ? e.message : 'research failed')

    const { data: queue } = await supabase
      .from('research_job_queue')
      .select('attempts, max_attempts')
      .eq('research_run_id', runId)
      .maybeSingle()

    const exhausted = (queue?.attempts ?? 1) >= (queue?.max_attempts ?? 3)

    if (exhausted) {
      await failRun(runId, userId, 'ERR_RESEARCH_FAILED', message)
    } else {
      // Back to the queue for another attempt rather than losing the run.
      await supabase
        .from('research_runs')
        .update({ status: 'pending', error_message: message })
        .eq('id', runId)
        .eq('user_id', userId)
      await supabase
        .from('research_job_queue')
        .update({ status: 'pending', claimed_at: null, claimed_by: null, last_error: message })
        .eq('research_run_id', runId)
    }

    throw e
  }
}
