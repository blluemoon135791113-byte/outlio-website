import 'server-only'

/**
 * Where an upload's automatic enrichment stopped, company by company and
 * person by person.
 *
 * ⚠️ COUNTS ONLY. This is an operator screen across every account, so it never
 * carries a name, an address or a number — only how many companies and people
 * reached each step and why the rest did not. The reasons are the `MISS_…`
 * codes providers write to `research_tool_calls.error_code` (see
 * `MISS_REASONS` in lib/intelligence/types.ts).
 *
 * Jobs enriched before those codes existed show their misses as
 * `unrecorded`: the call ran and found nothing, and nobody wrote down why.
 */
import { MISS_REASONS, missCode, type MissReason } from '@/lib/intelligence/types'
import { createAdminClient } from '@/lib/supabase/admin'

/** Every outcome a company or person can end in, in the order a report reads. */
export type Outcome =
  | 'found'
  | 'no_website'
  | MissReason
  | 'unrecorded'
  | 'timed_out'
  | 'failed'
  | 'not_attempted'

export type ToolCallRow = {
  entity_id: string | null
  provider: string
  status: string
  error_code: string | null
  created_at: string
}

const MISS_BY_CODE = new Map(MISS_REASONS.map((reason) => [missCode(reason), reason]))

/**
 * PURE. The outcome of the LAST call any of `providers` made for an entity.
 *
 * Last, because a run that timed out and a later run that read the site are
 * both in the table, and only the later one describes the site today.
 */
export function lastOutcome(calls: readonly ToolCallRow[], providers: ReadonlySet<string>): Outcome {
  const latest = calls
    .filter((call) => providers.has(call.provider))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
  if (!latest) return 'not_attempted'
  if (latest.status === 'success') return 'found'
  if (latest.status === 'timeout') return 'timed_out'
  if (latest.status === 'error') return 'failed'
  return (latest.error_code && MISS_BY_CODE.get(latest.error_code)) || 'unrecorded'
}

export type CompanyFacts = {
  id: string
  hasDomain: boolean
  hasEmail: boolean
  hasPhone: boolean
}

export type PersonFacts = {
  id: string
  hasEmail: boolean
  hasPhone: boolean
}

export const COMPANY_CONTACT_PROVIDERS = new Set(['company-contact'])
export const PERSON_EMAIL_PROVIDERS = new Set(['search-contact-email'])
export const PERSON_PHONE_PROVIDERS = new Set(['search-contact-phone'])

/** PURE. Where one company's contact search ended. */
export function companyOutcome(company: CompanyFacts, calls: readonly ToolCallRow[]): Outcome {
  if (company.hasEmail || company.hasPhone) return 'found'
  if (!company.hasDomain) return 'no_website'
  return lastOutcome(calls, COMPANY_CONTACT_PROVIDERS)
}

/** PURE. Where one person's email or phone search ended. */
export function personOutcome(
  found: boolean,
  calls: readonly ToolCallRow[],
  providers: ReadonlySet<string>,
): Outcome {
  return found ? 'found' : lastOutcome(calls, providers)
}

export type Tally = Partial<Record<Outcome, number>>

function tally(outcomes: readonly Outcome[]): Tally {
  const counts: Tally = {}
  for (const outcome of outcomes) counts[outcome] = (counts[outcome] ?? 0) + 1
  return counts
}

export type JobFunnel = {
  jobId: string
  createdAt: string
  leads: number
  companies: number
  companiesWithWebsite: number
  companyEmails: number
  companyPhones: number
  personEmails: number
  personPhones: number
  /** Companies with neither an email nor a phone, by where they stopped. */
  company: Tally
  personEmail: Tally
  personPhone: Tally
}

/** PURE. One job's report from the facts and calls loaded for it. */
export function summarizeJob(input: {
  jobId: string
  createdAt: string
  companies: readonly CompanyFacts[]
  people: readonly PersonFacts[]
  calls: readonly ToolCallRow[]
}): JobFunnel {
  const callsFor = new Map<string, ToolCallRow[]>()
  for (const call of input.calls) {
    if (!call.entity_id) continue
    const list = callsFor.get(call.entity_id) ?? []
    list.push(call)
    callsFor.set(call.entity_id, list)
  }
  const of = (id: string) => callsFor.get(id) ?? []

  return {
    jobId: input.jobId,
    createdAt: input.createdAt,
    leads: input.people.length,
    companies: input.companies.length,
    companiesWithWebsite: input.companies.filter((company) => company.hasDomain).length,
    companyEmails: input.companies.filter((company) => company.hasEmail).length,
    companyPhones: input.companies.filter((company) => company.hasPhone).length,
    personEmails: input.people.filter((person) => person.hasEmail).length,
    personPhones: input.people.filter((person) => person.hasPhone).length,
    company: tally(input.companies.map((company) => companyOutcome(company, of(company.id)))),
    personEmail: tally(
      input.people.map((person) => personOutcome(person.hasEmail, of(person.id), PERSON_EMAIL_PROVIDERS)),
    ),
    personPhone: tally(
      input.people.map((person) => personOutcome(person.hasPhone, of(person.id), PERSON_PHONE_PROVIDERS)),
    ),
  }
}

const IN_CHUNK = 200

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; start < ids.length; start += IN_CHUNK) {
    rows.push(...(await read(ids.slice(start, start + IN_CHUNK))))
  }
  return rows
}

/**
 * The most recent finished upload jobs, each with its funnel.
 *
 * ⚠️ SERVICE ROLE, ACROSS ACCOUNTS: the caller must have passed
 * `requireAdmin()`. Every read below is still scoped to the job's own
 * `user_id`, so one account's rows never count towards another's job.
 *
 * Throws on a read error: a report that silently undercounts is worse than a
 * page that says it could not load.
 */
export async function loadEnrichmentFunnels(limit = 10): Promise<JobFunnel[]> {
  const db = createAdminClient()
  const { data: jobs, error: jobsError } = await db
    .from('extraction_jobs')
    .select('id, user_id, created_at')
    .in('status', ['completed', 'partially_completed'])
    .is('trashed_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (jobsError) throw new Error(`funnel: jobs read failed (${jobsError.code ?? 'unknown'})`)

  const funnels: JobFunnel[] = []
  for (const job of jobs ?? []) {
    const userId = job.user_id as string

    const { data: leads, error: leadsError } = await db
      .from('extracted_leads')
      .select('id, company_id')
      .eq('user_id', userId)
      .eq('extraction_job_id', job.id)
      .eq('is_duplicate', false)
    if (leadsError) throw new Error(`funnel: leads read failed (${leadsError.code ?? 'unknown'})`)
    const leadIds = (leads ?? []).map((lead) => lead.id as string)
    const companyIds = [...new Set((leads ?? []).map((lead) => lead.company_id).filter(Boolean))] as string[]

    const companies = await inChunks(companyIds, async (chunk) => {
      const { data, error } = await db
        .from('companies')
        .select('id, normalized_domain, contact_email, contact_phone')
        .eq('user_id', userId)
        .in('id', chunk)
      if (error) throw new Error(`funnel: companies read failed (${error.code ?? 'unknown'})`)
      return data ?? []
    })

    const evidence = await inChunks(leadIds, async (chunk) => {
      const { data, error } = await db
        .from('research_evidence')
        .select('entity_id, field')
        .eq('user_id', userId)
        .eq('entity_type', 'person')
        .in('field', ['work_email', 'mobile_phone'])
        .in('entity_id', chunk)
      if (error) throw new Error(`funnel: evidence read failed (${error.code ?? 'unknown'})`)
      return data ?? []
    })
    const emailed = new Set(evidence.filter((row) => row.field === 'work_email').map((row) => row.entity_id))
    const phoned = new Set(evidence.filter((row) => row.field === 'mobile_phone').map((row) => row.entity_id))

    const { data: runs, error: runsError } = await db
      .from('research_runs')
      .select('id')
      .eq('user_id', userId)
      .eq('scope->autoEnrich->>jobId', job.id)
    if (runsError) throw new Error(`funnel: runs read failed (${runsError.code ?? 'unknown'})`)

    const calls = await inChunks((runs ?? []).map((run) => run.id as string), async (chunk) => {
      const { data, error } = await db
        .from('research_tool_calls')
        .select('entity_id, provider, status, error_code, created_at')
        .eq('user_id', userId)
        .in('research_run_id', chunk)
        .in('provider', [
          ...COMPANY_CONTACT_PROVIDERS,
          ...PERSON_EMAIL_PROVIDERS,
          ...PERSON_PHONE_PROVIDERS,
        ])
      if (error) throw new Error(`funnel: calls read failed (${error.code ?? 'unknown'})`)
      return (data ?? []) as ToolCallRow[]
    })

    funnels.push(
      summarizeJob({
        jobId: job.id as string,
        createdAt: job.created_at as string,
        companies: companies.map((company) => ({
          id: company.id as string,
          hasDomain: Boolean(company.normalized_domain),
          hasEmail: Boolean(company.contact_email),
          hasPhone: Boolean(company.contact_phone),
        })),
        people: leadIds.map((id) => ({ id, hasEmail: emailed.has(id), hasPhone: phoned.has(id) })),
        calls,
      }),
    )
  }
  return funnels
}
