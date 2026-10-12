import 'server-only'

/**
 * Post-extraction enrichment, from FREE sources only.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS PASS SPENDS NOTHING, AND MUST NOT BECOME ABLE TO.               ║
 * ║                                                                          ║
 * ║  It runs automatically after every extraction, so anything metered here  ║
 * ║  would bill on every upload with nobody pressing a button. The registry  ║
 * ║  excludes paid providers unless OUTLIO_ALLOW_PAID_PROVIDERS=true, and    ║
 * ║  this pass steps aside entirely when that flag is on.                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * The pass routes through Outlio's ORDINARY research pipeline — the same
 * two-phase runner the Intelligence console uses — so contact enrichment
 * runs with full evidence, provenance, tool-call telemetry, and cache
 * semantics. SMTP mailbox probing stays OFF here: it is an explicit operator
 * opt-in (SCOUT_SMTP_VERIFY), never a default of a background pass.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ EVERY LEAD, IN BATCHES THAT EACH FIT ONE SERVERLESS WAKE-UP.         ║
 * ║                                                                          ║
 * ║  This used to be ONE run over at most 60 leads, fired and forgotten      ║
 * ║  from a Vercel `after()`. On production (2026-10-12) 17 of 29 such runs  ║
 * ║  had been killed by the function limit, reaped back to `pending`, and    ║
 * ║  never claimed again — most uploads got no enrichment at all.            ║
 * ║                                                                          ║
 * ║  Now an upload becomes a CHAIN of small runs. Each run carries what      ║
 * ║  comes after it (`scope.autoEnrich.next`); finishing one merges it,      ║
 * ║  rebuilds the CSV, and queues the next. Whoever is awake continues the   ║
 * ║  chain — the upload's own `after()` first, then the cron drain — so a    ║
 * ║  killed batch costs one retry, never the rest of the upload.             ║
 * ║                                                                          ║
 * ║  Batches of ONE upload never overlap: each rewrites the same CSV, and    ║
 * ║  two rebuilds racing can land the staler one last.                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import {
  cancelClaimedResearchRun,
  claimNextResearchRun,
  deferClaimedResearchRun,
  createResearchRun,
  processClaimedResearchRun,
  reapStaleResearchRuns,
  researchIdempotencyKey,
  type ResearchOutcome,
} from '@/lib/intelligence/run'
import { mergeRunIntoLeads } from '@/lib/intelligence/merge-store'
import {
  researchScopeSchema,
  validatePlan,
  type AutoEnrich,
  type AutoEnrichStep,
  type ResearchScope,
} from '@/lib/intelligence/plan'
import { paidProvidersEnabled } from '@/lib/intelligence/providers'
import { createAdminClient } from '@/lib/supabase/admin'
import { rebuildAccountListExport } from '@/lib/worker/rebuild-account-export'
import { rebuildJobExport } from '@/lib/worker/rebuild-export'

/**
 * Leads (or companies) per batch. Sized so one batch — MCP acquisition,
 * company phase, contact phase — finishes well inside a 300s function.
 */
export const BATCH_SIZE = 10

/**
 * Time a batch must have left before it is started. A batch started without
 * it is the one that gets killed mid-way and retried.
 */
export const BATCH_RESERVE_MS = 140_000

/**
 * A claim older than this belongs to a function that is already dead: no
 * wake-up that processes research lives longer than 300s.
 */
const STALE_CLAIM_SECONDS = 330

type Stage = AutoEnrich['stage']

/**
 * Leads (companies, for account-list stages) automatically enriched per
 * calendar month (UTC), across the whole deployment.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THIS PROTECTS THE SITE, NOT THE SEARCH QUOTA.                        ║
 * ║                                                                          ║
 * ║  Vercel Hobby has HARD monthly caps (4 h active CPU, 360 GB-h memory).   ║
 * ║  Hitting one stops the WHOLE project — landing page and dashboard — until║
 * ║  the month turns. Automatic enrichment is the largest variable consumer, ║
 * ║  so it stops first: past the limit, batches are DEFERRED to the 1st of   ║
 * ║  next month, never dropped. Hubble requests are not counted.             ║
 * ║                                                                          ║
 * ║  Set from measured CPU per lead (Vercel → Usage) — 8,000 is a cautious   ║
 * ║  guess until that number exists. `AUTO_ENRICH_MONTHLY_LIMIT=0` pauses    ║
 * ║  the automatic pass entirely.                                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Checked before each batch, so concurrent workers can overshoot by at most
 * one batch each (3 × BATCH_SIZE) — accepted rather than serialising them.
 */
export function monthlyAutoEnrichLimit(): number {
  const parsed = Number.parseInt(process.env.AUTO_ENRICH_MONTHLY_LIMIT ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 8_000
}

/** Retry soon when usage cannot be read: a DB blip must not pause a month. */
const USAGE_UNKNOWN_RETRY_MS = 10 * 60_000

function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

function nextMonthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/**
 * Records researched by automatic batches started this month, or null when
 * it cannot be read.
 *
 * ⚠️ READS EVERY USER'S RUNS ON PURPOSE. The cap it enforces is the
 * deployment's, not a tenant's; nothing but counts leaves this function.
 */
export async function autoEnrichedThisMonth(now = new Date()): Promise<number | null> {
  let total = 0
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await createAdminClient()
      .from('research_runs')
      .select('lead_count, company_count')
      .like('query_text', 'Automatic enrichment for extraction %')
      .gte('started_at', monthStartUtc(now).toISOString())
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) return null
    for (const row of data ?? []) {
      total += Math.max(Number(row.lead_count) || 0, Number(row.company_count) || 0)
    }
    if (!data || data.length < 1_000) return total
  }
}

/*
 * ⚠️ CONTACT DETAILS ONLY — the core of a B2B lead (owner decision,
 * 2026-10-12). The LinkedIn URL already arrives with extraction; this pass
 * adds the person's work email and mobile, and the company's published
 * email and phone. Industry, company LinkedIn and social profiles are left to
 * Hubble, on request: asking for them here woke `social-scout-company` and
 * `search-company-profile` on every lead, the slowest steps of the pass.
 *
 * `company_domain` is not an extra column — it is the prerequisite. Almost
 * every contact found comes from the company's own site, and the contact
 * phase routes on the domain this phase discovers.
 */
const LEAD_PLAN = {
  entityScope: 'companies',
  requiredFields: [
    'company_domain',
    'company_contact_email',
    'company_contact_phone',
    'work_email',
    'email_status',
    'mobile_phone',
    'phone_status',
  ],
  outputFields: [
    'company_name',
    'company_domain',
    'company_contact_email',
    'company_contact_phone',
    'work_email',
    'email_status',
    'mobile_phone',
    'phone_status',
  ],
} as const

const COMPANY_DISCOVERY_PLAN = {
  entityScope: 'companies',
  requiredFields: ['company_domain'],
  outputFields: ['company_name', 'company_domain'],
} as const

/*
 * A separate stage reloads company entities after domain discovery. Asking for
 * contacts in the discovery run would route against the stale, domain-less
 * snapshot and every official-site provider would decline.
 */
const COMPANY_CONTACTS_PLAN = {
  entityScope: 'companies',
  requiredFields: ['company_contact_email', 'company_contact_phone'],
  outputFields: ['company_name', 'company_contact_email', 'company_contact_phone'],
} as const

function planFor(stage: Stage) {
  if (stage === 'company_discovery') return COMPANY_DISCOVERY_PLAN
  if (stage === 'company_contacts') return COMPANY_CONTACTS_PLAN
  return LEAD_PLAN
}

function queryTextFor(jobId: string, stage: Stage): string {
  return `Automatic enrichment for extraction ${jobId} (${stage}).`
}

/** Leads of one job, by the order every batch of it agrees on. */
async function jobLeadPage(
  jobId: string,
  userId: string,
  offset: number,
): Promise<{ ids: string[]; more: boolean } | null> {
  const { data, error } = await createAdminClient()
    .from('extracted_leads')
    .select('id')
    // Service role bypasses RLS — scoping by user_id is mandatory.
    .eq('user_id', userId)
    .eq('extraction_job_id', jobId)
    .eq('is_duplicate', false)
    .order('created_at', { ascending: false })
    /*
     * ⚠️ A STABLE TIEBREAKER, AND THIS IS THE WORST PLACE TO LACK ONE.
     * Every lead in an extraction job is inserted in ONE transaction, so
     * `created_at` is identical across the whole batch. Without a second key,
     * paging returns some rows twice and NEVER returns others — and the ones
     * never returned are silently never enriched.
     */
    .order('id', { ascending: true })
    // One extra row answers "is there another batch?" without a count.
    .range(offset, offset + BATCH_SIZE)
  if (error) return null
  const ids = (data ?? []).map((row) => row.id as string)
  return { ids: ids.slice(0, BATCH_SIZE), more: ids.length > BATCH_SIZE }
}

/**
 * Queues the next batch of `steps`, skipping steps with nothing left.
 *
 * Returns the batch's run id; `existed` when that exact batch was already
 * created (by a parallel finisher, or before a crash) — the chain is then
 * already continuing from there. Null when the chain is complete.
 */
async function queueNextBatch(
  jobId: string,
  userId: string,
  steps: readonly AutoEnrichStep[],
): Promise<{ runId: string; existed: boolean } | null> {
  const remaining = [...steps]

  while (remaining.length > 0) {
    const step = remaining.shift()!
    let stage: Stage
    let ids: string[]
    let next: AutoEnrichStep[]

    if (step.stage === 'job_leads') {
      const page = await jobLeadPage(jobId, userId, step.offset)
      if (!page) return null
      if (page.ids.length === 0) continue
      stage = 'job_leads'
      ids = page.ids
      next = page.more
        ? [{ stage: 'job_leads', offset: step.offset + BATCH_SIZE }, ...remaining]
        : remaining
    } else {
      stage = step.stage
      ids = step.ids.slice(0, BATCH_SIZE)
      const rest = step.ids.slice(BATCH_SIZE)
      next = rest.length > 0 ? [{ stage: step.stage, ids: rest }, ...remaining] : remaining
    }

    const autoEnrich: AutoEnrich = { jobId, stage, next }
    const scope: ResearchScope =
      stage === 'company_discovery' || stage === 'company_contacts'
        ? { type: 'company_ids', companyIds: ids, autoEnrich }
        : { type: 'lead_ids', leadIds: ids, autoEnrich }
    const queryText = queryTextFor(jobId, stage)
    const plan = planFor(stage)

    /*
     * ⚠️ IDEMPOTENT ACROSS EVERY STATUS. `createResearchRun` only joins an
     * ACTIVE run with the same key; a batch that already FINISHED would be
     * created a second time. Looking the key up across all statuses is what
     * lets a failed-chain sweep and a live finisher both call this safely.
     */
    const validated = validatePlan(plan)
    if (!validated.ok) return null
    const key = researchIdempotencyKey({ queryText, scope, plan: validated.plan })
    const { data: existing } = await createAdminClient()
      .from('research_runs')
      .select('id')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) return { runId: existing.id as string, existed: true }

    const created = await createResearchRun(userId, { queryText, scope, plan })
    if (!created.ok || created.status !== 'queued') return null
    return { runId: created.runId, existed: false }
  }

  return null
}

/**
 * Queues the first batch of an upload's enrichment. Fast — it researches
 * nothing. Returns null when there is nothing to do or the pass must not run.
 *
 * `leadIds` names leads explicitly (an account list's recommended contacts,
 * which can belong to older jobs); otherwise the job's own leads are walked.
 */
export async function startAutoEnrichment(
  jobId: string,
  userId: string,
  input: { leadIds?: readonly string[]; companyIds?: readonly string[] } = {},
): Promise<string | null> {
  /*
   * If someone has switched paid providers on, this automatic pass steps aside.
   * Enabling them is a decision about deliberate, user-initiated research — not
   * a licence for a background job to bill on every upload.
   */
  if (paidProvidersEnabled()) return null

  const steps: AutoEnrichStep[] = []
  if (input.leadIds) {
    const leadIds = [...new Set(input.leadIds)]
    if (leadIds.length > 0) steps.push({ stage: 'leads', ids: leadIds })
  } else {
    steps.push({ stage: 'job_leads', offset: 0 })
  }
  const companyIds = [...new Set(input.companyIds ?? [])]
  if (companyIds.length > 0) {
    steps.push({ stage: 'company_discovery', ids: companyIds })
    steps.push({ stage: 'company_contacts', ids: companyIds })
  }

  try {
    const first = await queueNextBatch(jobId, userId, steps)
    return first?.runId ?? null
  } catch {
    // The extraction stands on its own; enrichment is additive.
    return null
  }
}

type RunContext =
  | { kind: 'chain'; scope: ResearchScope; autoEnrich: AutoEnrich }
  | { kind: 'legacy'; jobId: string; steps: AutoEnrichStep[] }
  | { kind: 'other'; createdAt: string | null }

/**
 * A console run the drain finds stranded longer than this is cancelled, not
 * researched. Nobody is waiting on a question asked days ago, and running it
 * unattended weeks late is a surprise — and a bill, if paid providers are on.
 */
const ABANDONED_CONSOLE_RUN_MS = 24 * 60 * 60 * 1000

/*
 * The single-run pass (before 2026-10-12) marked its runs only by query text.
 * Those runs are each up to 60 leads — too large to finish in one wake-up —
 * so when one is claimed it is re-planned as a chain instead of processed.
 */
const LEGACY_PATTERNS: Array<{ pattern: RegExp; stage: 'leads' | 'company_discovery' | 'company_contacts' }> = [
  { pattern: /^Automatic enrichment for extraction ([0-9a-f-]{36})\.$/, stage: 'leads' },
  { pattern: /^Automatic company enrichment for Account List ([0-9a-f-]{36})\.$/, stage: 'company_discovery' },
  { pattern: /^Automatic company contacts for Account List ([0-9a-f-]{36})\.$/, stage: 'company_contacts' },
]

async function loadRunContext(runId: string, userId: string): Promise<RunContext> {
  const { data } = await createAdminClient()
    .from('research_runs')
    .select('scope, query_text, created_at')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return { kind: 'other', createdAt: null }
  const other = { kind: 'other' as const, createdAt: data.created_at as string }

  const parsed = researchScopeSchema.safeParse(data.scope)
  if (!parsed.success) return other
  const scope = parsed.data

  if ((scope.type === 'lead_ids' || scope.type === 'company_ids') && scope.autoEnrich) {
    return { kind: 'chain', scope, autoEnrich: scope.autoEnrich }
  }

  for (const { pattern, stage } of LEGACY_PATTERNS) {
    const match = pattern.exec(data.query_text as string)
    if (!match) continue
    const jobId = match[1]!
    if (stage === 'leads' && scope.type === 'lead_ids') {
      return { kind: 'legacy', jobId, steps: [{ stage: 'leads', ids: scope.leadIds }] }
    }
    if (stage !== 'leads' && scope.type === 'company_ids') {
      const steps: AutoEnrichStep[] = [{ stage, ids: scope.companyIds }]
      // A legacy discovery run was followed by a contacts run that was never
      // created, because the run that would have created it was killed.
      if (stage === 'company_discovery') steps.push({ stage: 'company_contacts', ids: scope.companyIds })
      return { kind: 'legacy', jobId, steps }
    }
  }
  return other
}

/** Rewrites the job's CSV from the rows as they now are. Never throws. */
async function rebuildExport(jobId: string, userId: string): Promise<void> {
  try {
    const { data: job } = await createAdminClient()
      .from('extraction_jobs')
      .select('kind')
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!job) return
    if (job.kind === 'account_list') await rebuildAccountListExport(jobId, userId)
    else await rebuildJobExport(jobId, userId)
  } catch {
    // The rows are right in the database either way; the next batch rebuilds.
  }
}

/**
 * After a batch: merge its known values onto the leads, rebuild the CSV, and
 * queue the next batch — strictly in that order, so the next batch's rebuild
 * can never start before this one's has landed.
 *
 * ⚠️ EVIDENCE IS NOT EXPORTABLE — the enrichment COLUMN is. The console merges
 * deliberately; an automatic pass must merge automatically, or the rebuilt CSV
 * ships without what the batch found. `mergeRunIntoLeads` merges only KNOWN
 * cells and re-scopes by user.
 */
async function finishBatch(
  runId: string,
  userId: string,
  autoEnrich: AutoEnrich,
  outcome: ResearchOutcome | null,
): Promise<string | null> {
  let leadsUpdated = 0
  const researched = outcome && (outcome.status === 'completed' || outcome.status === 'partially_complete')

  if (researched && (autoEnrich.stage === 'job_leads' || autoEnrich.stage === 'leads')) {
    const merged = await mergeRunIntoLeads(userId, runId)
    if (merged.ok) leadsUpdated = merged.leadsUpdated
  }
  if (researched && (outcome.evidenceWritten > 0 || leadsUpdated > 0)) {
    await rebuildExport(autoEnrich.jobId, userId)
  }

  const next = await queueNextBatch(autoEnrich.jobId, userId, autoEnrich.next)
  // An `existed` batch is already someone else's to continue.
  return next && !next.existed ? next.runId : null
}

/** What became of a run once this caller held its claim. */
async function researchClaimed(runId: string, userId: string): Promise<string | null> {
  const context = await loadRunContext(runId, userId)

  if (context.kind === 'legacy') {
    await cancelClaimedResearchRun(runId, userId, 'Re-planned as batched automatic enrichment.')
    if (paidProvidersEnabled()) return null
    const first = await queueNextBatch(context.jobId, userId, context.steps)
    return first && !first.existed ? first.runId : null
  }

  if (context.kind === 'chain' && paidProvidersEnabled()) {
    await cancelClaimedResearchRun(runId, userId, 'Automatic enrichment is off while paid providers are enabled.')
    return null
  }

  if (context.kind === 'chain') {
    const used = await autoEnrichedThisMonth()
    if (used === null) {
      await deferClaimedResearchRun(runId, userId, new Date(Date.now() + USAGE_UNKNOWN_RETRY_MS), 'Waiting: monthly usage could not be read.')
      return null
    }
    if (used >= monthlyAutoEnrichLimit()) {
      const resumesAt = nextMonthStartUtc()
      await deferClaimedResearchRun(runId, userId, resumesAt, `Monthly automatic enrichment limit reached; resumes ${resumesAt.toISOString().slice(0, 10)}.`)
      console.warn('[enrich] monthly automatic limit reached; batch deferred', { used, limit: monthlyAutoEnrichLimit() })
      return null
    }
  }

  if (
    context.kind === 'other' &&
    context.createdAt &&
    Date.now() - Date.parse(context.createdAt) > ABANDONED_CONSOLE_RUN_MS
  ) {
    await cancelClaimedResearchRun(runId, userId, 'Abandoned: queued over a day ago and never processed.')
    return null
  }

  let outcome: ResearchOutcome | null = null
  try {
    outcome = await processClaimedResearchRun(runId, userId)
  } catch {
    // Requeued for another attempt, or failed for good. A failed batch must
    // not strand the rest of the upload — continue past it below.
  }

  if (context.kind !== 'chain') return null
  if (!outcome) {
    const { data } = await createAdminClient()
      .from('research_runs')
      .select('status')
      .eq('id', runId)
      .eq('user_id', userId)
      .maybeSingle()
    if (data?.status !== 'failed') return null
  }
  return finishBatch(runId, userId, context.autoEnrich, outcome)
}

/**
 * Continues one upload's chain from `runId` while a batch still fits before
 * `deadlineAt`. Whatever is left stays queued for the cron drain.
 *
 * ⚠️ NEVER THROWS. It runs after a successful extraction, and a provider
 * outage must not make a completed extraction look failed.
 */
export async function continueAutoEnrichment(
  runId: string | null,
  userId: string,
  deadlineAt: number,
  claimedBy: string,
): Promise<void> {
  let current = runId
  while (current && Date.now() + BATCH_RESERVE_MS <= deadlineAt) {
    // Not claimable or failed: the queue is durable and the cron drain picks
    // up where this stopped.
    const next = await claimAndProcessNext(current, userId, claimedBy)
    if (next === undefined) return
    current = next
  }
}

/**
 * Continues chains whose batch FAILED for good (killed past its last attempt
 * and failed by the reaper), so one bad batch never strands the rest of an
 * upload. Idempotent: an already-continued chain is detected by key.
 */
async function continueFailedChains(): Promise<void> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const { data } = await createAdminClient()
    .from('research_runs')
    .select('id, user_id, scope')
    .eq('status', 'failed')
    .like('query_text', 'Automatic enrichment for extraction %')
    .gte('created_at', since)
    // Newest first: an upload in progress outranks one whose chain is long
    // since continued (those are no-ops, found by key).
    .order('created_at', { ascending: false })
    .limit(25)

  for (const row of data ?? []) {
    const parsed = researchScopeSchema.safeParse(row.scope)
    if (!parsed.success) continue
    const scope = parsed.data
    if ((scope.type !== 'lead_ids' && scope.type !== 'company_ids') || !scope.autoEnrich) continue
    await queueNextBatch(scope.autoEnrich.jobId, row.user_id as string, scope.autoEnrich.next)
  }
}

export type DrainOutcome = { reaped: number; batches: number }

/**
 * The untargeted research drain, called by the cron after its tick.
 *
 * Reaps dead claims, continues failed chains, then runs `workers` loops that
 * each claim the oldest due run and — for an automatic batch — keep following
 * that upload's chain while a batch still fits before `deadlineAt`.
 *
 * Also picks up Intelligence console runs whose own `after()` was cut short;
 * those are researched but never auto-merged (merging is the user's choice).
 */
export async function drainResearchQueue(input: {
  deadlineAt: number
  workers: number
  claimedBy: string
}): Promise<DrainOutcome> {
  const outcome: DrainOutcome = { reaped: 0, batches: 0 }

  try {
    outcome.reaped = await reapStaleResearchRuns(STALE_CLAIM_SECONDS)
  } catch {
    // Reaping is recovery; a failure here must not stop live work below.
  }
  try {
    await continueFailedChains()
  } catch {
    // Retried next tick.
  }

  const worker = async (index: number) => {
    while (Date.now() + BATCH_RESERVE_MS <= input.deadlineAt) {
      let claim: { runId: string; userId: string } | null
      try {
        claim = await claimNextResearchRun(`${input.claimedBy}:${index}`)
      } catch {
        return
      }
      if (!claim) return

      outcome.batches += 1
      let next = await researchClaimed(claim.runId, claim.userId).catch(() => null)
      while (next && Date.now() + BATCH_RESERVE_MS <= input.deadlineAt) {
        const claimed = await claimAndProcessNext(next, claim.userId, `${input.claimedBy}:${index}`)
        if (claimed === undefined) break
        outcome.batches += 1
        next = claimed
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, input.workers) }, (_, index) => worker(index)))
  return outcome
}

/** Targeted claim of a chain's next batch. `undefined` when not claimable. */
async function claimAndProcessNext(
  runId: string,
  userId: string,
  claimedBy: string,
): Promise<string | null | undefined> {
  try {
    const { data, error } = await createAdminClient().rpc('claim_research_run', {
      p_run_id: runId,
      p_user_id: userId,
      p_claimed_by: claimedBy,
    })
    if (error || !Array.isArray(data) || !data[0]) return undefined
    return await researchClaimed(runId, userId)
  } catch {
    return undefined
  }
}
