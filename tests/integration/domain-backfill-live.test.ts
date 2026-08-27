/**
 * Production domain discovery — explicit, opt-in, and intentionally slow.
 *
 * This is not a benchmark: it writes normalized evidence, provenance, usage,
 * and the discovered domain back to each company through Outlio's ordinary
 * research runner.
 *
 *   RUN_DOMAIN_BACKFILL=1 npx vitest run \
 *     tests/integration/domain-backfill-live.test.ts --disable-console-intercept
 *
 * ⚠️ Runs tenants sequentially. Each run already has bounded provider
 * concurrency; parallel tenants would multiply that limit and invite 429s.
 *
 * Cost model changed 2026-08-25: with OUTLIO_ALLOW_PAID_PROVIDERS unset the
 * registry contains only free providers, so a pass costs time, not credit.
 * Two operator knobs bound an invocation:
 *
 *   BACKFILL_RESWEEP=1        retry tenants whose prior maintenance pass
 *                             completed under the OLD waterfall — GLEIF and
 *                             domain-probe have never seen those misses.
 *   BACKFILL_MAX_TENANT_SIZE  skip tenants larger than N, for bounded pilots.
 */
import { describe, expect, it } from 'vitest'

import {
  claimAndProcessResearchRun,
  createResearchRun,
  type ResearchOutcome,
} from '@/lib/intelligence/run'
import { adminClient, hasSupabaseEnv } from './helpers'

const enabled = process.env.RUN_DOMAIN_BACKFILL === '1'
const describeIf = enabled && hasSupabaseEnv ? describe : describe.skip

if (!enabled) {
  console.warn(
    '[domain-backfill] SKIPPED. Set RUN_DOMAIN_BACKFILL=1 to run discovery and persist domains.',
  )
}

async function usersWithMissingDomains(): Promise<
  Array<{ userId: string; companiesMissingDomain: number }>
> {
  const rows: Array<{ user_id: string }> = []

  for (let from = 0; ; from += 1_000) {
    const { data, error } = await adminClient()
      .from('companies')
      .select('user_id')
      .is('normalized_domain', null)
      .order('user_id', { ascending: true })
      .range(from, from + 999)

    if (error) throw new Error(`Could not enumerate companies: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1_000) break
  }

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1)

  const candidates = [...counts].map(([userId, companiesMissingDomain]) => ({
    userId,
    companiesMissingDomain,
  }))

  if (candidates.length === 0) return []

  // Bounded pilots: exclude large tenants so an invocation measures the new
  // waterfall on a sample before committing hours to the full sweep.
  const maxSize = Number.parseInt(process.env.BACKFILL_MAX_TENANT_SIZE ?? '', 10)
  if (Number.isFinite(maxSize)) {
    const bounded = candidates.filter((candidate) => candidate.companiesMissingDomain <= maxSize)
    console.log(
      `[domain-backfill] BACKFILL_MAX_TENANT_SIZE=${maxSize}: ` +
        `${bounded.length}/${candidates.length} tenants qualify`,
    )
    return bounded
  }

  const { data: runs, error: runError } = await adminClient()
    .from('research_runs')
    .select('user_id, status, external_call_count, created_at')
    .eq('query_text', 'Maintenance: discover missing company domains.')
    .in('user_id', candidates.map((candidate) => candidate.userId))
    .order('created_at', { ascending: false })

  if (runError) throw new Error(`Could not inspect completed runs: ${runError.message}`)

  const runsByUser = new Map<
    string,
    Array<{ status: string; externalCallCount: number }>
  >()
  for (const run of runs ?? []) {
    const userRuns = runsByUser.get(run.user_id) ?? []
    userRuns.push({
      status: run.status,
      externalCallCount: run.external_call_count,
    })
    runsByUser.set(run.user_id, userRuns)
  }

  // Resweep mode: retry tenants whose prior maintenance pass completed under
  // the OLD waterfall. GLEIF and domain-probe have never seen those misses,
  // and with paid providers gated off a pass costs time rather than credit.
  // Only a live `running` run still blocks — recovery of stale runs belongs
  // to the queue reaper.
  if (process.env.BACKFILL_RESWEEP === '1') {
    console.log(
      '[domain-backfill] BACKFILL_RESWEEP=1: prior completed passes will be retried under the free-only waterfall',
    )
    return candidates.filter((candidate) => {
      const userRuns = runsByUser.get(candidate.userId) ?? []
      return !userRuns.some((run) => run.status === 'running')
    })
  }

  return candidates.filter((candidate) => {
    const userRuns = runsByUser.get(candidate.userId) ?? []

    // Never create a competing job while another worker owns a run. Recovery
    // of a genuinely stale `running` run belongs to the queue reaper.
    if (userRuns.some((run) => run.status === 'running')) return false

    // Any prior pass means its unresolved companies have already been tried.
    // Looking only at the latest row is unsafe: a later zero-call failure must
    // not erase the cost history of an older completed pass.
    if (userRuns.some((run) => run.externalCallCount > 0)) return false

    if (
      userRuns.some(
        (run) => run.status === 'completed' || run.status === 'partially_complete',
      )
    ) {
      return false
    }

    // A failed run that never reached a provider did not have its paid pass.
    // It is safe to replace after an infrastructure fix. Pending zero-call
    // runs are resumed by `runTenant`; users with no prior run start normally.
    return true
  })
}

/**
 * Every tenant holding domain-less companies, with NO resume guard.
 *
 * The orphan pass subtracts lead-linked companies itself, so the pass-history
 * filtering in `usersWithMissingDomains` — correct for lead-scoped retries —
 * would wrongly hide tenants whose prior passes never could reach their
 * orphans.
 */
async function tenantsWithMissingDomains(): Promise<
  Array<{ userId: string; companiesMissingDomain: number }>
> {
  const rows: Array<{ user_id: string }> = []

  for (let from = 0; ; from += 1_000) {
    const { data, error } = await adminClient()
      .from('companies')
      .select('user_id')
      .is('normalized_domain', null)
      .order('user_id', { ascending: true })
      .range(from, from + 999)

    if (error) throw new Error(`Could not enumerate companies: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as Array<{ user_id: string }>))
    if (data.length < 1_000) break
  }

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1)

  return [...counts].map(([userId, companiesMissingDomain]) => ({
    userId,
    companiesMissingDomain,
  }))
}

async function remainingDomains(userId: string): Promise<number> {  const { count, error } = await adminClient()
    .from('companies')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('normalized_domain', null)

  if (error) throw new Error(`Could not count remaining companies: ${error.message}`)
  return count ?? 0
}

async function pendingDomainRun(userId: string): Promise<string | null> {
  const { data, error } = await adminClient()
    .from('research_runs')
    .select('id')
    .eq('user_id', userId)
    .eq('query_text', 'Maintenance: discover missing company domains.')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not inspect pending runs: ${error.message}`)
  return data?.id ?? null
}

async function runTenant(
  userId: string,
): Promise<ResearchOutcome> {
  let runId = await pendingDomainRun(userId)

  if (!runId) {
    const created = await createResearchRun(userId, {
      queryText: 'Maintenance: discover missing company domains.',
      scope: { type: 'all_leads' },
      plan: {
        entityScope: 'companies',
        requiredFields: ['company_domain'],
        outputFields: ['company_name', 'company_domain'],
      },
    })

    if (!created.ok || created.status !== 'queued') {
      throw new Error(
        `Could not queue domain run for ${userId}: ` +
          `${created.ok ? created.status : created.reason}`,
      )
    }
    runId = created.runId
  } else {
    console.log(`  resuming pending run ${runId}`)
  }

  // The runner itself returns a transient infrastructure failure to `pending`
  // with its attempt count preserved. Retry the SAME run so a flaky Supabase
  // read cannot create a duplicate paid job.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const outcome = await claimAndProcessResearchRun(runId, userId, 'domain-backfill-live')
      if (outcome) return outcome
    } catch (error) {
      if (attempt === 3) throw error
      const message = error instanceof Error ? error.message : 'unknown error'
      console.warn(`  attempt ${attempt} failed (${message}); retrying the same run`)
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
    }
  }

  throw new Error(`Could not claim domain run ${runId}`)
}

describeIf('production domain backfill', () => {
  /**
   * ORPHAN COMPANIES.
   *
   * Over a thousand domain-less companies are linked to NO surviving lead, so
   * every lead-scoped pass below is structurally unable to reach them. This
   * pass names them directly through the `company_ids` scope, in bounded
   * chunks (~20 minutes of free waterfall each).
   *
   *   RUN_DOMAIN_BACKFILL=1 BACKFILL_ORPHANS=1 npx vitest run ...
   */
  it(
    'researches domain-less companies that no lead references',
    async () => {
      const tenants = await tenantsWithMissingDomains()
      if (tenants.length === 0) {
        console.log('\n=== Orphan backfill: nothing to do ===')
        return
      }

      const admin = adminClient()

      for (const tenant of tenants) {
        // Linked company ids, paged — the subtraction target.
        const linked = new Set<string>()
        for (let from = 0; ; from += 1_000) {
          const { data, error } = await admin
            .from('extracted_leads')
            .select('company_id')
            .eq('user_id', tenant.userId)
            .not('company_id', 'is', null)
            .range(from, from + 999)
          if (error) throw new Error(`Could not read lead links: ${error.message}`)
          if (!data?.length) break
          for (const row of data) if (row.company_id) linked.add(row.company_id as string)
          if (data.length < 1_000) break
        }

        const orphans: string[] = []
        for (let from = 0; ; from += 1_000) {
          const { data, error } = await admin
            .from('companies')
            .select('id')
            .eq('user_id', tenant.userId)
            .is('normalized_domain', null)
            .range(from, from + 999)
          if (error) throw new Error(`Could not enumerate companies: ${error.message}`)
          if (!data?.length) break
          for (const row of data) if (!linked.has(row.id)) orphans.push(row.id)
          if (data.length < 1_000) break
        }

        console.log(`\n[orphan] ${tenant.userId}: ${orphans.length} unreachable by lead scope`)
        if (orphans.length === 0) continue

        for (let start = 0; start < orphans.length; start += 150) {
          const chunk = orphans.slice(start, start + 150)
          const created = await createResearchRun(tenant.userId, {
            queryText: 'Maintenance: discover missing company domains (orphan companies).',
            scope: { type: 'company_ids', companyIds: chunk },
            plan: {
              entityScope: 'companies',
              requiredFields: ['company_domain'],
              outputFields: ['company_name', 'company_domain'],
            },
          })
          if (!created.ok || created.status !== 'queued') {
            throw new Error(
              `Could not queue orphan run: ${created.ok ? created.status : created.reason}`,
            )
          }

          const outcome = await claimAndProcessResearchRun(
            created.runId,
            tenant.userId,
            'domain-backfill-live',
          )
          if (!outcome) throw new Error(`Orphan run ${created.runId} was claimed elsewhere`)

          const stillMissing = await remainingDomains(tenant.userId)
          console.log(
            `  chunk ${Math.floor(start / 150) + 1}/${Math.ceil(orphans.length / 150)}: ` +
              `calls ${outcome.externalCalls}, cache hits ${outcome.cacheHits}, ${outcome.status}; ` +
              `tenant still missing ${stillMissing}`,
          )
        }
      }
    },
    process.env.BACKFILL_ORPHANS === '1' ? 21_600_000 : 2_400_000,
  )

  it(
    'discovers and persists company domains through the normal research pipeline',
    async () => {
      const tenants = await usersWithMissingDomains()

      console.log(
        `\n=== Domain backfill: ${tenants.length} tenants, ` +
          `${tenants.reduce((sum, tenant) => sum + tenant.companiesMissingDomain, 0)} companies ===`,
      )

      const outcomes: Array<{
        userId: string
        before: number
        after: number
        outcome: ResearchOutcome
      }> = []

      for (const [index, tenant] of tenants.entries()) {
        console.log(
          `\n[${index + 1}/${tenants.length}] ${tenant.userId}: ` +
            `${tenant.companiesMissingDomain} companies missing domains`,
        )

        const outcome = await runTenant(tenant.userId)

        const after = await remainingDomains(tenant.userId)
        outcomes.push({
          userId: tenant.userId,
          before: tenant.companiesMissingDomain,
          after,
          outcome,
        })

        console.log(
          `  resolved: ${tenant.companiesMissingDomain - after}; remaining: ${after}; ` +
            `calls: ${outcome.externalCalls}; cache hits: ${outcome.cacheHits}; ` +
            `estimated cost: $${(outcome.estimatedCostMicros / 1_000_000).toFixed(4)}`,
        )
      }

      const before = outcomes.reduce((sum, item) => sum + item.before, 0)
      const after = outcomes.reduce((sum, item) => sum + item.after, 0)
      const calls = outcomes.reduce((sum, item) => sum + item.outcome.externalCalls, 0)
      const costMicros = outcomes.reduce(
        (sum, item) => sum + item.outcome.estimatedCostMicros,
        0,
      )

      console.log(
        `\n=== Complete ===\n` +
          `  resolved: ${before - after}/${before} ` +
          `(${before > 0 ? (((before - after) / before) * 100).toFixed(1) : '0.0'}%)\n` +
          `  unresolved: ${after}\n` +
          `  provider calls: ${calls}\n` +
          `  estimated cost: $${(costMicros / 1_000_000).toFixed(4)}\n`,
      )

      // A zero hit rate means the adapters or provider credentials are broken,
      // not merely that this is a hard dataset. Do not report that as success.
      if (before > 0) expect(after).toBeLessThan(before)
    },
    // A resweep covers every tenant's full backlog under the slow free
    // waterfall (~8s/company measured in the pilot); a large tenant cannot
    // fit the default ceiling. Opt-in only, so the long limit harms nobody.
    process.env.BACKFILL_RESWEEP === '1' ? 21_600_000 : 2_400_000,
  )
})
