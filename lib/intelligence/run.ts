import 'server-only'

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
import { getCompaniesForLeads } from '@/lib/companies/repository'
import { executeTasks } from '@/lib/intelligence/execute'
import { readEvidence, recordToolCalls, writeEvidence } from '@/lib/intelligence/evidence-store'
import {
  researchScopeSchema,
  validatePlan,
  type ResearchPlan,
  type ResearchScope,
} from '@/lib/intelligence/plan'
import { buildLiveRegistry } from '@/lib/intelligence/providers'
import { planToTasks } from '@/lib/intelligence/router'
import {
  RESEARCH_FIELD_SPEC,
  type CompanyEntity,
  type PersonEntity,
} from '@/lib/intelligence/types'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

/** Leads read per page. PostgREST caps responses; never use a bare `.limit()`. */
const PAGE_SIZE = 1000

export type ResearchOutcome = {
  runId: string
  status: 'completed' | 'partially_complete' | 'failed'
  leadCount: number
  companyCount: number
  cacheHits: number
  externalCalls: number
  evidenceWritten: number
  estimatedCostMicros: number
}

function concise(message: string): string {
  const first = message.split('\n')[0]?.trim() ?? ''
  const stripped = first.startsWith('<') ? 'upstream returned HTML' : first
  return stripped.length > 160 ? `${stripped.slice(0, 160)}…` : stripped
}

/**
 * Creates a run and puts it on the queue.
 *
 * The plan is validated BEFORE the row exists, so an invalid plan can never
 * occupy the queue or appear in history as something that was attempted.
 */
export async function createResearchRun(
  userId: string,
  input: { queryText: string; scope: ResearchScope; plan: unknown },
): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  const validation = validatePlan(input.plan)
  if (!validation.ok) return { ok: false, reason: validation.reason }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('research_runs')
    .insert({
      user_id: userId,
      status: 'pending',
      query_text: input.queryText,
      // Validated above, so serialising to jsonb is safe. The cast exists
      // because a Zod-inferred shape is structurally wider than `Json`.
      scope: input.scope as unknown as Json,
      plan: validation.plan as unknown as Json,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, reason: concise(error?.message ?? 'run could not be created') }
  }

  const { error: queueError } = await supabase.rpc('enqueue_research_run', { p_run_id: data.id })
  if (queueError) return { ok: false, reason: concise(queueError.message) }

  return { ok: true, runId: data.id }
}

/** Resolves a scope to lead ids, paging properly. Always user-scoped. */
async function resolveScope(userId: string, scope: ResearchScope): Promise<string[]> {
  if (scope.type === 'lead_ids') return scope.leadIds

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
    .select('id, user_id, scope, plan')
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
  const leadIds = await resolveScope(userId, scope)

  // ---- 2. leads → distinct companies (spec §9) ---------------------------
  const { companies, companyIdByLeadId } = await getCompaniesForLeads(userId, leadIds)

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

  const knowledge = await readEvidence(userId, [
    { entityType: 'company', entityIds: companyEntities.map((c) => c.id), fields: companyFields },
    { entityType: 'person', entityIds: peopleEntities.map((p) => p.id), fields: personFields },
  ])

  // ---- 4. route only the gaps (spec §15) ---------------------------------
  const routing = planToTasks({
    companies: companyEntities,
    people: peopleEntities,
    requiredFields: plan.requiredFields,
    knowledge,
  })

  // ---- 5. execute, isolating failures (spec §49) -------------------------
  const report = await executeTasks(routing.tasks, { registry: buildLiveRegistry() })

  // ---- 6. persist with provenance (spec §16) -----------------------------
  const written = await writeEvidence(userId, runId, report.evidence)
  await recordToolCalls(userId, runId, report.toolCalls)
  await persistDiscoveredDomains(userId, report.evidence)

  /*
   * A run is `completed` only when nothing was left unanswered. Anything else
   * is `partially_complete` — an honest status a user can act on, rather than a
   * green tick over a table full of blanks.
   */
  const anyUnknown = report.results.some((result) => result.unknownFields.length > 0)
  const status: ResearchOutcome['status'] =
    routing.tasks.length === 0 || !anyUnknown ? 'completed' : 'partially_complete'

  await supabase
    .from('research_runs')
    .update({
      status,
      tools_used: routing.categories,
      external_call_count: report.externalCallCount,
      cache_hit_count: routing.cacheHits,
      estimated_cost_micros: report.estimatedCostMicros,
      actual_cost_micros: report.estimatedCostMicros,
      duration_ms: Date.now() - startedAt,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('user_id', userId)

  await supabase.from('research_job_queue').update({ status: 'done' }).eq('research_run_id', runId)

  void companyIdByLeadId

  return {
    runId,
    status,
    leadCount: leadIds.length,
    companyCount: companyEntities.length,
    cacheHits: routing.cacheHits,
    externalCalls: report.externalCallCount,
    evidenceWritten: written.written,
    estimatedCostMicros: report.estimatedCostMicros,
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
      .select('id, full_name, linkedin_url, job_title, company_name, company_website_url')
      .eq('user_id', userId)
      .in('id', leadIds.slice(i, i + 200))

    for (const row of data ?? []) {
      people.push({
        type: 'person',
        id: row.id,
        fullName: row.full_name,
        linkedinUrl: row.linkedin_url,
        jobTitle: row.job_title,
        companyName: row.company_name,
        companyDomain: row.company_website_url,
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
