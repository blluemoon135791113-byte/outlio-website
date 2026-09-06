/**
 * Provider benchmark — opt-in, never part of `npm test`.
 *
 * Spec §52: a waterfall order must come from measured **cost per incremental
 * valid result**, not from a guess. This measures real providers against a
 * sample of real companies and prints the numbers that decide the order.
 *
 *   RUN_PROVIDER_BENCHMARK=1 npx vitest run tests/integration/provider-benchmark.test.ts
 *
 * ⚠️ MEASUREMENT ONLY. Nothing is written to `research_evidence`. A benchmark
 * that mutates production data cannot be re-run for comparison, and a provider
 * would look better simply for having gone first and warmed the cache.
 *
 * ⚠️ SPENDS REAL CREDIT for any provider whose key is configured. The sample
 * size is deliberately small and explicit.
 */
import { describe, expect, it } from 'vitest'

import { executeTasks } from '@/lib/intelligence/execute'
import { createRegistry } from '@/lib/intelligence/registry'
import { ALL_PROVIDERS, providerReadiness } from '@/lib/intelligence/providers'
import type { CompanyEntity, ResearchTask } from '@/lib/intelligence/types'
import { adminClient, hasSupabaseEnv } from './helpers'

const enabled = process.env.RUN_PROVIDER_BENCHMARK === '1'
const describeIf = enabled && hasSupabaseEnv ? describe : describe.skip

if (!enabled) {
  console.warn(
    '[benchmark] SKIPPED. Set RUN_PROVIDER_BENCHMARK=1 to measure real providers.',
  )
}

/** Companies per run. Small on purpose — this spends money. */
const SAMPLE_SIZE = Number.parseInt(process.env.BENCHMARK_SAMPLE ?? '100', 10)

async function sampleCompaniesWithoutDomain(limit: number): Promise<CompanyEntity[]> {
  const { data } = await adminClient()
    .from('companies')
    .select('id, name, normalized_domain, normalized_linkedin_url')
    .is('normalized_domain', null)
    .not('name', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  return (data ?? []).map((row) => ({
    type: 'company' as const,
    id: row.id,
    name: row.name,
    domain: null,
    linkedinUrl: row.normalized_linkedin_url,
  }))
}

describeIf('domain discovery coverage', () => {
  it('measures how many companies each provider can resolve a domain for', async () => {
    const readiness = providerReadiness()
    console.log('\n=== Provider readiness ===')
    for (const provider of readiness) {
      console.log(`  ${provider.configured ? 'configured  ' : 'NO KEY      '} ${provider.name}`)
    }

    const companies = await sampleCompaniesWithoutDomain(SAMPLE_SIZE)
    console.log(`\nSample: ${companies.length} companies with no domain`)
    expect(companies.length).toBeGreaterThan(0)

    /*
     * Each provider is measured ALONE, not through the waterfall. Run in
     * sequence, the second provider only ever sees what the first missed, so
     * its raw coverage would be understated and the two could not be compared.
     * Incremental coverage is computed afterwards, from the sets.
     */
    const resolvedBy = new Map<string, Set<string>>()

    for (const provider of ALL_PROVIDERS) {
      if (provider.category !== 'company_profile') continue

      const registry = createRegistry([provider])
      const tasks: ResearchTask[] = companies.map((company) => ({
        id: `bench:${company.id}`,
        category: 'company_profile',
        entity: company,
        fields: ['company_domain'],
      }))

      const started = Date.now()
      const report = await executeTasks(tasks, { registry, concurrency: 4, timeoutMs: 30_000 })
      const elapsed = Date.now() - started

      const resolved = new Set(
        report.evidence
          .filter((item) => item.field === 'company_domain')
          .map((item) => item.entityId),
      )
      resolvedBy.set(provider.name, resolved)

      /*
       * ⚠️ STATUS BREAKDOWN IS NOT OPTIONAL.
       *
       * A provider whose every call was REJECTED reports the same
       * `resolved: 0` as one that searched successfully and found nothing.
       * The first is an outage or an exhausted plan; the second is a finding
       * about the data. Reporting them identically sent this benchmark's first
       * run to entirely the wrong conclusion.
       */
      const byStatus = new Map<string, number>()
      for (const call of report.toolCalls) {
        byStatus.set(call.status, (byStatus.get(call.status) ?? 0) + 1)
      }

      // Cost is counted for calls that actually returned something. A rejected
      // request is not billed, and reporting it as spend overstates the price
      // of a provider that never ran.
      const billable = report.toolCalls.filter(
        (call) => call.status === 'success' || call.status === 'not_found',
      )
      const spent = billable.reduce((sum, call) => sum + call.estimatedCostMicros, 0)

      const attempted = report.toolCalls.length
      const pct = ((resolved.size / companies.length) * 100).toFixed(1)
      const statuses = [...byStatus.entries()].map(([s, n]) => `${s}=${n}`).join(' ')

      console.log(
        `\n--- ${provider.name} ---\n` +
          `  resolved       : ${resolved.size}/${companies.length} (${pct}%)\n` +
          `  calls attempted: ${attempted}\n` +
          `  call statuses  : ${statuses || '(none)'}\n` +
          `  est. cost      : $${(spent / 1_000_000).toFixed(4)} (billable calls only)\n` +
          `  wall time      : ${(elapsed / 1000).toFixed(1)}s\n` +
          `  avg per company: ${attempted > 0 ? (elapsed / attempted).toFixed(0) : 0}ms`,
      )

      const failed = attempted - billable.length
      if (attempted > 0 && failed === attempted) {
        console.log(
          `  ⚠️  EVERY CALL FAILED — this is an outage, an exhausted plan or a\n` +
            `      bad key, NOT a finding about the data. Coverage is unmeasured.`,
        )
      }
    }

    // ---- incremental coverage (spec §52) ----------------------------------
    console.log('\n=== Incremental coverage ===')
    const seen = new Set<string>()
    for (const [name, resolved] of resolvedBy) {
      const incremental = [...resolved].filter((id) => !seen.has(id))
      for (const id of resolved) seen.add(id)

      console.log(
        `  ${name}: +${incremental.length} unique ` +
          `(${((incremental.length / companies.length) * 100).toFixed(1)}% of sample)`,
      )
    }

    const totalPct = ((seen.size / companies.length) * 100).toFixed(1)
    console.log(
      `\n  combined: ${seen.size}/${companies.length} (${totalPct}%)\n` +
        `  unresolved: ${companies.length - seen.size}\n`,
    )

    // No assertion on the rate — this is a measurement, and a low number is a
    // finding about the data, not a failing build.
    expect(seen.size).toBeGreaterThanOrEqual(0)
  }, 900_000)
})
