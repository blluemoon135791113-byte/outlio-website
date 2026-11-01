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
import { externalContactTask } from '@/lib/intelligence/providers/search-company-contact'
import { withRunObservation } from '@/lib/intelligence/observe'
import { hubbleExecute } from '@/lib/hubble/execute'
import {
  liveAgentTools,
  researchSubject,
  type AgentOutcome,
  type AgentSubject,
  type ContactKind,
} from '@/lib/intelligence/research-agent'
import { verifyEmail as verifySmtpMailbox } from '@/lib/intelligence/providers/scout'
import { regionFromLocation, verifyContactEvidence, type MailboxProbe } from '@/lib/intelligence/verify-contact'
import { preserveExplicitConstraints } from '@/lib/intelligence/filters'
import {
  RESEARCH_FIELD_SPEC,
  type CompanyEntity,
  type EvidenceRecord,
  type NormalizedEvidence,
  type PersonEntity,
  type ResearchField,
  type ResearchTask,
  type ToolCallRecord,
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

/**
 * PURE. Companies that started the run with no domain and gained one from
 * this run's evidence — the ones whose contact lookup was declined against the
 * start-of-run snapshot and must be asked again.
 */
export function companiesThatGainedADomain(
  companies: readonly CompanyEntity[],
  evidence: readonly NormalizedEvidence[],
): CompanyEntity[] {
  const gained = new Set(
    evidence
      .filter((item) => item.field === 'company_domain' && item.entityType === 'company')
      .map((item) => item.entityId),
  )
  return companies.filter((company) => !company.domain && gained.has(company.id))
}

/** Overlapping tasks for a search-backed run. Env-tunable, clamped to 1–16. */
export function searchTaskConcurrency(): number {
  const parsed = Number.parseInt(process.env.RESEARCH_SEARCH_CONCURRENCY ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 16) : 6
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
      const verified = (await verifyContactEvidence(evidence, new Map(input.people.map((person) => [person.id, person.location])), { mailbox: mailboxProbe() })).kept
      evidenceWritten += (await writeEvidence(input.userId, input.runId, verified)).written
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

/**
 * Leads the research agent works per run. One enrichment batch is 10 leads,
 * so by default every lead still missing a contact gets the agent.
 */
function agentSubjectLimit(): number {
  const value = Number(process.env.ENRICHMENT_AGENT_LEADS_PER_RUN ?? 10)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 10
}

/** Leads researched at once. */
const AGENT_CONCURRENCY = 3

/**
 * ⚠️ THE STAGE GETS WHAT IS LEFT OF THE BATCH'S WINDOW, NOT A FIXED SLICE.
 *
 * A batch is started only with 140 s left of its function (BATCH_RESERVE_MS
 * in lib/worker/enrich-free.ts), and the phases before this stage have
 * already spent part of it. The stage ends TAIL_MS before that window closes,
 * so verification, writing and the derive step still fit; with less than
 * AGENT_MIN_MS to work in, it does not start. A killed function would lose
 * the stage's work and retry the batch, searches and model calls included.
 */
const RUN_WINDOW_MS = 140_000
const AGENT_STAGE_MS = 90_000
const AGENT_TAIL_MS = 20_000
const AGENT_MIN_MS = 30_000

/** A lead or company the agent researched recently is not researched again. */
const AGENT_COOLDOWN_DAYS = 30

const PERSON_KIND: Partial<Record<ResearchField, ContactKind>> = { work_email: 'person_email', mobile_phone: 'person_phone' }
const COMPANY_KIND: Partial<Record<ResearchField, ContactKind>> = {
  company_contact_email: 'company_email',
  company_contact_phone: 'company_phone',
}

/** The workspace a user's metered calls are attributed to: their own, else their first. */
async function workspaceFor(userId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const { data: owned } = await supabase
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
  if (owned?.[0]?.id) return owned[0].id as string
  const { data: member } = await supabase
    .from('workspace_memberships')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
  return (member?.[0]?.workspace_id as string | undefined) ?? null
}

/**
 * ⚠️ THE MODEL IN UPLOAD ENRICHMENT — after every deterministic pass, for
 * what they left missing (lib/intelligence/research-agent.ts).
 *
 * The providers above are fixed phrasings and fixed page guesses; for a lead
 * the public web names only in a press release or a speaker page they find
 * nothing. The agent reads the lead's title, employer and location, decides
 * where such a person is named, and follows the trail a few steps. What it
 * proposes is checked by code against the page before it is stored, then
 * verified like every other contact.
 *
 * One metered `hubbleExecute` call covers the stage. No workspace, no model,
 * or a refused call: the stage records why and the run carries on with what
 * the deterministic passes found.
 */
async function runResearchAgentStage(input: {
  runId: string
  userId: string
  /** When the run's window closes; the stage ends AGENT_TAIL_MS before it. */
  windowEndsAt: number
  people: readonly PersonEntity[]
  companies: readonly CompanyEntity[]
  personFields: readonly ResearchField[]
  companyFields: readonly ResearchField[]
}): Promise<{ evidenceWritten: number; externalCalls: number }> {
  const none = { evidenceWritten: 0, externalCalls: 0 }
  const limit = agentSubjectLimit()
  const personKinds = input.personFields.flatMap((field) => PERSON_KIND[field] ?? [])
  const companyKinds = input.companyFields.flatMap((field) => COMPANY_KIND[field] ?? [])
  if (limit === 0 || personKinds.length + companyKinds.length === 0 || !hasWebSearch()) return none

  const knowledge = await readEvidence(input.userId, [
    { entityType: 'person', entityIds: input.people.map((person) => person.id), fields: ['work_email', 'mobile_phone'] },
    { entityType: 'company', entityIds: input.companies.map((company) => company.id), fields: ['company_contact_email', 'company_contact_phone'] },
  ])
  const missing = (type: 'person' | 'company', id: string, field: ResearchField) => !knowledgeHas(knowledge, type, id, field)
  // ⚠️ A MISS IS NOT FREE TO REPEAT: every batch of every upload would
  // otherwise re-research the same leads and the same company lines.
  const recently = await searchedExternallyWithin(
    input.userId,
    [...input.people.map((person) => person.id), ...input.companies.map((company) => company.id)],
    AGENT_COOLDOWN_DAYS,
    'research-agent',
  )
  const companyById = new Map(input.companies.map((company) => [company.id, company]))
  const companyClaimed = new Set<string>()
  const subjects: AgentSubject[] = []

  for (const person of input.people) {
    if (subjects.length >= limit) break
    const company = person.companyId ? companyById.get(person.companyId) : undefined
    if (!person.fullName || !company || !(company.name || company.domain || person.companyName)) continue
    if (recently.has(person.id)) continue
    const subjectCompany: CompanyEntity = {
      ...company,
      name: company.name ?? person.companyName,
      domain: company.domain ?? person.companyDomain,
    }
    const wants: ContactKind[] = [
      ...(personKinds.includes('person_email') && missing('person', person.id, 'work_email') ? ['person_email' as const] : []),
      ...(personKinds.includes('person_phone') && missing('person', person.id, 'mobile_phone') ? ['person_phone' as const] : []),
    ]
    // A company's line is looked for once per run, with its first lead.
    if (!companyClaimed.has(company.id) && !recently.has(company.id)) {
      if (companyKinds.includes('company_email') && missing('company', company.id, 'company_contact_email')) wants.push('company_email')
      if (companyKinds.includes('company_phone') && missing('company', company.id, 'company_contact_phone')) wants.push('company_phone')
      companyClaimed.add(company.id)
    }
    if (wants.length > 0) subjects.push({ person, company: subjectCompany, wants })
  }
  if (subjects.length === 0) return none

  // A skipped stage is logged per lead, so the enrichment report says why.
  const skipped = async (errorCode: string) => {
    await recordToolCalls(input.userId, input.runId, subjects.map((subject) => ({
      provider: 'research-agent',
      tool: 'web_research' as const,
      entityType: 'person' as const,
      entityId: subject.person!.id,
      status: 'skipped' as const,
      latencyMs: 0,
      estimatedCostMicros: 0,
      errorCode,
    })))
    return none
  }

  const workspaceId = await workspaceFor(input.userId)
  if (!workspaceId) return skipped('AGENT_NO_WORKSPACE')

  const deadlineAt = Math.min(Date.now() + AGENT_STAGE_MS, input.windowEndsAt - AGENT_TAIL_MS)
  if (deadlineAt - Date.now() < AGENT_MIN_MS) return skipped('AGENT_NO_TIME')

  await updateResearchProgress(input.runId, input.userId, 'web_research', 0, subjects.length)
  const tools = liveAgentTools(deadlineAt)
  const outcomes = new Map<AgentSubject, AgentOutcome & { latencyMs: number }>()
  const failed = new Set<AgentSubject>()

  const metered = await hubbleExecute(
    'enrichment.research',
    { workspaceId, userId: input.userId, source: 'worker:upload-enrichment-agent' },
    async ({ llm }) => {
      if (!llm.isConfigured()) return 'not_configured' as const
      let next = 0
      let done = 0
      await Promise.all(Array.from({ length: Math.min(AGENT_CONCURRENCY, subjects.length) }, async () => {
        while (next < subjects.length) {
          const subject = subjects[next++]!
          const startedAt = Date.now()
          // One lead failing must not discard what the others found.
          try {
            const outcome = await researchSubject(llm, subject, tools, deadlineAt)
            outcomes.set(subject, { ...outcome, latencyMs: Date.now() - startedAt })
          } catch {
            failed.add(subject)
          }
          done += 1
          await updateResearchProgress(input.runId, input.userId, 'web_research', done, subjects.length).catch(() => undefined)
        }
      }))
      return 'ran' as const
    },
  )

  if (!metered.ok) return skipped(metered.reason === 'no_credits' ? 'AGENT_NO_CREDITS' : `AGENT_${metered.code}`)
  if (metered.result === 'not_configured') return skipped('AGENT_MODEL_NOT_CONFIGURED')

  const found = [...outcomes.values()].flatMap((outcome) => outcome.evidence)
  const locations = await contactLocations(input.userId, subjects.map((subject) => subject.company), input.people)
  const verified = (await verifyContactEvidence(found, locations, { mailbox: mailboxProbe() })).kept
  const evidenceWritten = (await writeEvidence(input.userId, input.runId, verified)).written
  // Fill an empty company column only: the agent ran because it was empty.
  await persistCompanyContacts(input.userId, verified, true)
  const calls: ToolCallRecord[] = []
  for (const [subject, outcome] of outcomes) {
    const status = outcome.found.length > 0 ? ('success' as const) : outcome.stoppedBy === 'model_unavailable' ? ('error' as const) : ('not_found' as const)
    const row = {
      provider: 'research-agent',
      tool: 'web_research' as const,
      status,
      latencyMs: outcome.latencyMs,
      estimatedCostMicros: 0,
      errorCode: outcome.found.length > 0 ? null : `AGENT_${outcome.stoppedBy.toUpperCase()}`,
    }
    calls.push({ ...row, entityType: 'person', entityId: subject.person!.id })
    // The company's line was looked for too: its own row starts its cooldown.
    if (subject.wants.some((kind) => kind.startsWith('company_'))) {
      calls.push({ ...row, entityType: 'company', entityId: subject.company.id })
    }
  }
  for (const subject of failed) {
    calls.push({
      provider: 'research-agent', tool: 'web_research', entityType: 'person', entityId: subject.person!.id,
      status: 'error', latencyMs: 0, estimatedCostMicros: 0, errorCode: 'AGENT_FAILED',
    })
  }
  await recordToolCalls(input.userId, input.runId, calls)

  return {
    evidenceWritten,
    externalCalls: [...outcomes.values()].reduce((sum, outcome) => sum + outcome.searches + outcome.pagesOpened, 0),
  }
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

/** The SMTP mailbox probe, only where outbound port 25 exists (a self-hosted worker). */
function mailboxProbe(): MailboxProbe | null {
  // Never on Vercel: outbound port 25 is blocked there, so a probe only burns the run's time.
  return process.env.SCOUT_SMTP_VERIFY === 'true' && !process.env.VERCEL
    ? (email) => verifySmtpMailbox(email)
    : null
}

/** Verifies a phase's contacts; drops what fails. Counts only are logged. */
async function vetReport(
  report: ExecutionReport,
  locations: ReadonlyMap<string, string | null>,
): Promise<ExecutionReport> {
  const options = { mailbox: mailboxProbe() }
  const [evidence, bonus] = await Promise.all([
    verifyContactEvidence(report.evidence, locations, options),
    verifyContactEvidence(report.bonusEvidence, locations, options),
  ])
  const dropped = { ...evidence.dropped }
  for (const [reason, count] of Object.entries(bonus.dropped)) dropped[reason] = (dropped[reason] ?? 0) + count
  if (Object.keys(dropped).length > 0) console.info('[verify] contacts dropped', dropped)
  return { ...report, evidence: evidence.kept, bonusEvidence: bonus.kept }
}

/** Where each lead is, and where each company is headquartered — for phone countries. */
async function contactLocations(
  userId: string,
  companies: readonly CompanyEntity[],
  people: readonly PersonEntity[],
): Promise<Map<string, string | null>> {
  const locations = new Map<string, string | null>(people.map((person) => [person.id, person.location]))
  const ids = companies.map((company) => company.id)
  const supabase = createAdminClient()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('companies')
      .select('id, headquarters')
      .eq('user_id', userId)
      .in('id', ids.slice(i, i + 200))
    for (const row of data ?? []) locations.set(row.id as string, (row.headquarters as string | null) ?? null)
  }
  /*
   * A company with no captured headquarters takes the country its leads are
   * in. Measured 2026-10-31: 7 of 11 company phones went unchecked for want
   * of one, on a list whose every lead named their US city.
   */
  for (const company of companies) {
    if (regionFromLocation(locations.get(company.id))) continue
    const fromLead = people.find((person) => person.companyId === company.id && regionFromLocation(person.location))
    if (fromLead) locations.set(company.id, fromLead.location)
  }
  return locations
}

/** Projects public company contacts for bounded list/export reads. */
async function persistCompanyContacts(
  userId: string,
  evidence: readonly { field: string; entityId: string; value: Record<string, unknown> }[],
  /**
   * Fill an empty column only. For third-party listings: the column was empty
   * when the pass chose the company, but a concurrent run or a person may have
   * filled it since, and a medium-confidence listing must not replace that.
   */
  onlyIfEmpty = false,
): Promise<void> {
  const supabase = createAdminClient()
  for (const item of evidence) {
    const patch = item.field === 'company_contact_email'
      ? {
          contact_email: typeof item.value.email === 'string' ? item.value.email : null,
          contact_email_status: typeof item.value.status === 'string' ? item.value.status : 'publicly_found',
        }
      : item.field === 'company_contact_phone'
        ? {
            contact_phone: typeof item.value.phone === 'string' ? item.value.phone : null,
            contact_phone_status: typeof item.value.status === 'string' ? item.value.status : 'publicly_found',
          }
        : null
    if (!patch || (!patch.contact_email && !patch.contact_phone)) continue
    try {
      let update = supabase.from('companies').update(patch).eq('id', item.entityId).eq('user_id', userId)
      if (onlyIfEmpty) update = update.is(patch.contact_email ? 'contact_email' : 'contact_phone', null)
      await update
    } catch {
      // Evidence is durable; this projection can be repaired later.
    }
  }
}

/**
 * The off-site search's bounds.
 *
 * ⚠️ A MISS IS NOT FREE TO REPEAT. Up to two searches and three page reads per
 * company, and nothing about a company's listings changes overnight; without
 * a cooldown every run re-searched every company that had no contact. The cap
 * keeps one run inside the 300 s function window: 25 tasks at the search
 * concurrency is a few 13 s rounds, after the site passes have run.
 */
const EXTERNAL_RESEARCH_COOLDOWN_DAYS = 30
const EXTERNAL_CONTACT_TASKS_PER_RUN = 25

/** Companies the off-site search already ran for, recently, whatever it found. */
async function searchedExternallyWithin(
  userId: string,
  companyIds: readonly string[],
  days: number,
  provider = 'search-company-contact',
): Promise<Set<string>> {
  const searched = new Set<string>()
  if (companyIds.length === 0) return searched
  const supabase = createAdminClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  for (let i = 0; i < companyIds.length; i += 200) {
    const { data, error } = await supabase
      .from('research_tool_calls')
      .select('entity_id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .in('status', ['success', 'not_found'])
      .gte('created_at', since)
      .in('entity_id', companyIds.slice(i, i + 200))
    // Unknown history: search rather than silently skip a company forever.
    if (error) return new Set()
    for (const row of data ?? []) if (row.entity_id) searched.add(row.entity_id as string)
  }
  return searched
}

/**
 * Which requested company-contact fields each company still lacks, with what
 * the off-site search needs to know about it. Read from the row
 * `persistCompanyContacts` keeps current, scoped to the user.
 */
async function companiesMissingContacts(
  userId: string,
  companyIds: readonly string[],
  fields: readonly ResearchField[],
): Promise<Map<string, { fields: ResearchField[]; domain: string | null; location: string | null }>> {
  const supabase = createAdminClient()
  const missing = new Map<string, { fields: ResearchField[]; domain: string | null; location: string | null }>()
  for (let i = 0; i < companyIds.length; i += 200) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, normalized_domain, headquarters, contact_email, contact_phone')
      .eq('user_id', userId)
      .in('id', companyIds.slice(i, i + 200))
    // A failed read skips the pass rather than searching blind.
    if (error) return new Map()
    for (const row of data ?? []) {
      const lacking = fields.filter((field) =>
        field === 'company_contact_email' ? !row.contact_email : !row.contact_phone)
      if (lacking.length > 0) {
        missing.set(row.id as string, {
          fields: lacking,
          domain: (row.normalized_domain as string | null) ?? null,
          location: (row.headquarters as string | null) ?? null,
        })
      }
    }
  }
  return missing
}

/**
 * Processes one claimed run end to end. Never throws for a provider problem.
 *
 * Every page read and search made inside is logged for /admin/enrichment
 * (lib/intelligence/observe.ts) and written once when the run ends.
 */
export async function processResearchRun(
  runId: string,
  userId: string,
): Promise<ResearchOutcome> {
  return withRunObservation(userId, runId, () => processResearchRunObserved(runId, userId))
}

async function processResearchRunObserved(
  runId: string,
  userId: string,
): Promise<ResearchOutcome> {
  const runStartedAt = Date.now()
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

  /*
   * ⚠️ EVERY CONTACT IS VERIFIED BEFORE IT IS STORED (lib/intelligence/verify-contact.ts).
   * Each phase's report is vetted as it returns, so the evidence written, the
   * company row's contact columns and the export all see only contacts that
   * passed: an address on a domain with no mail server, or a number that is
   * not a real one for its country, is dropped.
   */
  const locations = await contactLocations(userId, companyEntities, peopleEntities)
  const vet = (report: ExecutionReport) => vetReport(report, locations)

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
    /*
     * Search-backed runs overlap `searchTaskConcurrency()` tasks; third-party
     * categories keep the executor's conservative default.
     *
     * ⚠️ THIS WAS 2, and it was the main reason a 19-lead run took 476s on
     * production (2026-10-12 telemetry): most of a task's time is a company
     * site or a slow probe timing out, not the search engine. A search engine
     * that pushes back records zero results and trips the circuit breaker —
     * it is never worked around — so a too-high value costs hit rate, not
     * a block evasion. Tune with RESEARCH_SEARCH_CONCURRENCY.
     */
    concurrency:
      hasWebSearch() &&
      (companyFields.length > 0 ||
        plan.requiredFields.some((field) =>
          ['funding', 'web_research', 'company_profile'].includes(
            RESEARCH_FIELD_SPEC[field].category,
          ),
        ))
        ? searchTaskConcurrency()
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
    companyRouting.tasks.length > 0 ? await vet(await runChunk(companyRouting.tasks)) : null

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
    await persistCompanyContacts(userId, [
      ...companyReport.evidence,
      ...companyReport.bonusEvidence,
    ])
  }

  /*
   * ---- 4a'. company contacts for domains discovered in 4a ----------------
   *
   * ⚠️ THE COMPANY PHASE IS ROUTED FROM THE SNAPSHOT TAKEN AT RUN START.
   * `company-contact` needs a domain, so for a company whose domain was only
   * discovered in 4a it had already declined — and nothing asked again. On
   * production (2026-10-13) it ran 28 times for 104 companies that had a
   * domain by the end, while being the best source of any contact (36%).
   * Reload the companies that just gained a domain and ask for the contact
   * fields alone.
   */
  let companyContactReport: ExecutionReport | null = null
  const companyContactFields = companyFields.filter(
    (field) => field === 'company_contact_email' || field === 'company_contact_phone',
  )
  if (companyReport && companyContactFields.length > 0) {
    const candidates = companiesThatGainedADomain(companyEntities, [
      ...companyReport.evidence,
      ...companyReport.bonusEvidence,
    ])
    if (candidates.length > 0) {
      // What was PERSISTED is the truth: a discovery that conflicted with an
      // existing domain is not adopted, so it must not be read here either.
      const refreshed: CompanyEntity[] = (await getCompaniesByIds(userId, candidates.map((c) => c.id)))
        .filter((company) => company.normalizedDomain)
        .map((company) => ({
          type: 'company',
          id: company.id,
          name: company.name,
          domain: company.normalizedDomain,
          linkedinUrl: company.normalizedLinkedInUrl,
        }))
      const contactRouting = planToTasks({
        companies: refreshed,
        people: [],
        requiredFields: companyContactFields,
        filters: plan.filters,
        knowledge,
      })
      if (contactRouting.tasks.length > 0) {
        companyContactReport = await vet(await runChunk(contactRouting.tasks))
        writtenTotal += (await writeEvidence(userId, runId, companyContactReport.evidence)).written
        writtenTotal += (await writeEvidence(userId, runId, companyContactReport.bonusEvidence)).written
        await recordToolCalls(userId, runId, companyContactReport.toolCalls)
        await persistCompanyContacts(userId, [
          ...companyContactReport.evidence,
          ...companyContactReport.bonusEvidence,
        ])
      }
    }
  }

  /*
   * ---- 4a''. company contacts from OTHER sources --------------------------
   *
   * The company's own site has now been read wherever one is known. A company
   * still without a requested contact — no website, or a site that publishes
   * none (14 of 30 measured 2026-10-29) — is searched for by name in the
   * listings that state it elsewhere. Last, so a search is never spent on a
   * company whose site would have answered.
   */
  let externalContactReport: ExecutionReport | null = null
  if (companyContactFields.length > 0 && companyEntities.length > 0) {
    const stillMissing = await companiesMissingContacts(
      userId,
      companyEntities.map((company) => company.id),
      companyContactFields,
    )
    const recentlySearched = await searchedExternallyWithin(
      userId,
      [...stillMissing.keys()],
      EXTERNAL_RESEARCH_COOLDOWN_DAYS,
    )
    const tasks = companyEntities.flatMap((company) => {
      const missing = stillMissing.get(company.id)
      if (!missing || missing.fields.length === 0) return []
      if (recentlySearched.has(company.id)) return []
      return [externalContactTask(
        { ...company, domain: missing.domain ?? company.domain, location: missing.location },
        missing.fields,
      )]
    })
    if (tasks.length > 0) {
      externalContactReport = await vet(await runChunk(tasks.slice(0, EXTERNAL_CONTACT_TASKS_PER_RUN)))
      writtenTotal += (await writeEvidence(userId, runId, externalContactReport.evidence)).written
      writtenTotal += (await writeEvidence(userId, runId, externalContactReport.bonusEvidence)).written
      await recordToolCalls(userId, runId, externalContactReport.toolCalls)
      await persistCompanyContacts(userId, [
        ...externalContactReport.evidence,
        ...externalContactReport.bonusEvidence,
      ], true)
    }
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
      personReport = await vet(await runChunk(personRouting.tasks))
      writtenTotal += (await writeEvidence(userId, runId, personReport.evidence)).written
      writtenTotal += (await writeEvidence(userId, runId, personReport.bonusEvidence)).written
      await recordToolCalls(userId, runId, personReport.toolCalls)
      await persistDiscoveredDomains(userId, [
        ...personReport.evidence,
        ...personReport.bonusEvidence,
      ])
      await persistCompanyContacts(userId, [
        ...personReport.evidence,
        ...personReport.bonusEvidence,
      ])
    }
  }

  // ---- 4c. the research agent, for what every pass above left missing ------
  // Upload batches only: a console run is not chunked into 10 leads, and its
  // window is the request's, not a batch's.
  const agentStage = 'autoEnrich' in scope && scope.autoEnrich && (personFields.length > 0 || companyFields.length > 0)
    ? await runResearchAgentStage({
        runId,
        userId,
        windowEndsAt: runStartedAt + RUN_WINDOW_MS,
        people: peopleForContact.length > 0 ? peopleForContact : await loadPeople(userId, leadIds, plan),
        companies: companyEntities,
        personFields,
        companyFields,
      })
    : { evidenceWritten: 0, externalCalls: 0 }
  writtenTotal += agentStage.evidenceWritten

  // ---- combined report ----------------------------------------------------
  const mergedResults = [
    ...(companyReport?.results ?? []),
    ...(companyContactReport?.results ?? []),
    ...(externalContactReport?.results ?? []),
    ...(personReport?.results ?? []),
  ]
  const report = {
    results: mergedResults,
    externalCallCount:
      mcpStage.externalCalls +
      agentStage.externalCalls +
      (companyReport?.externalCallCount ?? 0) +
      (companyContactReport?.externalCallCount ?? 0) +
      (externalContactReport?.externalCallCount ?? 0) +
      (personReport?.externalCallCount ?? 0),
    estimatedCostMicros:
      (companyReport?.estimatedCostMicros ?? 0) +
      (companyContactReport?.estimatedCostMicros ?? 0) +
      (externalContactReport?.estimatedCostMicros ?? 0) +
      (personReport?.estimatedCostMicros ?? 0),
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

  return processClaimedResearchRun(runId, userId)
}

/**
 * Claims the oldest due run of ANY user — the untargeted drain.
 *
 * ⚠️ WHY THIS EXISTS. `claim_next_research_run` sat uncalled from 0045 until
 * 2026-10-12, so a run whose `after()` was cut short was reaped back to
 * `pending` and then never picked up again: 17 automatic enrichments were
 * found parked that way, the oldest for seven weeks. Same defect, same fix as
 * `claimAndProcessOne` for extraction.
 */
export async function claimNextResearchRun(
  claimedBy: string,
): Promise<{ runId: string; userId: string } | null> {
  const { data, error } = await createAdminClient().rpc('claim_next_research_run', {
    p_claimed_by: claimedBy,
  })
  if (error) throw new Error(`research claim failed: ${concise(error.message)}`)

  const claim = Array.isArray(data) ? data[0] : null
  return claim ? { runId: claim.research_run_id, userId: claim.user_id } : null
}

/** Returns claimed-but-abandoned runs to the queue. Count of runs touched. */
export async function reapStaleResearchRuns(timeoutSeconds: number): Promise<number> {
  const { data, error } = await createAdminClient().rpc('reap_stale_research_runs', {
    p_timeout_seconds: timeoutSeconds,
  })
  if (error) throw new Error(`research reap failed: ${concise(error.message)}`)
  return data ?? 0
}

/**
 * Retires a claimed run without researching it, e.g. one superseded by a
 * re-planned chain. `cancelled` is terminal, so it can never be claimed again.
 */
export async function cancelClaimedResearchRun(
  runId: string,
  userId: string,
  message: string,
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('research_runs')
    .update({
      status: 'cancelled',
      error_message: message,
      completed_at: new Date().toISOString(),
      progress_stage: 'cancelled',
    })
    .eq('id', runId)
    .eq('user_id', userId)
  await supabase.from('research_job_queue').update({ status: 'done' }).eq('research_run_id', runId)
}

/**
 * Hands a claimed run back to the queue, not to be claimed before `until`.
 *
 * The claim's attempt is refunded: a run paused by a quota did not fail, and
 * three pauses must not exhaust it into `failed`.
 */
export async function deferClaimedResearchRun(
  runId: string,
  userId: string,
  until: Date,
  message: string,
): Promise<void> {
  const supabase = createAdminClient()
  const { data: queue } = await supabase
    .from('research_job_queue')
    .select('attempts')
    .eq('research_run_id', runId)
    .maybeSingle()

  await supabase
    .from('research_job_queue')
    .update({
      status: 'pending',
      claimed_at: null,
      claimed_by: null,
      next_attempt_at: until.toISOString(),
      attempts: Math.max(0, (queue?.attempts ?? 1) - 1),
    })
    .eq('research_run_id', runId)
  await supabase
    .from('research_runs')
    // `started_at` cleared: usage is counted by start month, and a batch
    // deferred into next month must count against next month.
    .update({ status: 'pending', progress_stage: 'queued', error_message: message, started_at: null })
    .eq('id', runId)
    .eq('user_id', userId)
}

/**
 * Processes a run this caller has ALREADY claimed. A failure goes back to the
 * queue for another attempt, or fails the run once attempts are exhausted —
 * then rethrows.
 */
export async function processClaimedResearchRun(
  runId: string,
  userId: string,
): Promise<ResearchOutcome> {
  const supabase = createAdminClient()

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
