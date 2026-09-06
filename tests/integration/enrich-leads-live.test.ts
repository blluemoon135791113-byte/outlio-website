/**
 * Lead enrichment — explicit, opt-in maintenance pass.
 *
 * Runs the free contact waterfall (scout → social-scout → …) over every lead
 * of one extraction job, through Outlio's ordinary research pipeline, so
 * evidence, provenance, and merged enrichment behave exactly as the
 * Intelligence console would produce.
 *
 *   ENRICH_JOB_ID=<extraction job uuid> \
 *   npx vitest run tests/integration/enrich-leads-live.test.ts --disable-console-intercept
 *
 * Free providers only (the paid gate stays whatever the environment says).
 */
import { describe, expect, it } from 'vitest'

import {
  claimAndProcessResearchRun,
  createResearchRun,
} from '@/lib/intelligence/run'
import { mergeRunIntoLeads } from '@/lib/intelligence/merge-store'
import { rebuildJobExport } from '@/lib/worker/rebuild-export'
import { adminClient, hasSupabaseEnv } from './helpers'

const enabled = Boolean(process.env.ENRICH_JOB_ID) && hasSupabaseEnv
const describeIf = enabled ? describe : describe.skip

if (!enabled) {
  console.warn('[enrich-leads] SKIPPED. Set ENRICH_JOB_ID=<extraction job id>.')
}

describeIf('lead enrichment pass', () => {
  it(
    'enriches every lead of one extraction job through the research pipeline',
    async () => {
      const jobId = process.env.ENRICH_JOB_ID!

      const { data: job, error: jobError } = await adminClient()
        .from('extraction_jobs')
        .select('user_id')
        .eq('id', jobId)
        .single()
      if (jobError || !job) throw new Error(`Job not found: ${jobError?.message ?? 'no row'}`)

      const leadIds: string[] = []
      for (let from = 0; ; from += 1_000) {
        const { data, error } = await adminClient()
          .from('extracted_leads')
          .select('id')
          .eq('extraction_job_id', jobId)
          .range(from, from + 999)
        if (error) throw new Error(`Could not read leads: ${error.message}`)
        if (!data?.length) break
        leadIds.push(...data.map((row) => row.id))
        if (data.length < 1_000) break
      }

      console.log(`\n=== Enriching ${leadIds.length} leads of job ${jobId} ===`)
      if (leadIds.length === 0) return

      const created = await createResearchRun(job.user_id, {
        queryText: `Maintenance: enrich leads of extraction ${jobId}.`,
        scope: { type: 'lead_ids', leadIds },
        plan: {
          entityScope: 'companies',
          requiredFields: [
            'work_email',
            'email_status',
            'company_domain',
            'company_linkedin',
            'social_profiles',
          ]
            .filter((value, index, all) => all.indexOf(value) === index)
            .slice(0, 63),
          outputFields: [
            'company_name',
            'work_email',
            'email_status',
            'company_domain',
            'company_linkedin',
            'social_profiles',
          ],
        },
      })
      if (!created.ok || created.status !== 'queued') {
        throw new Error(`Could not queue run: ${created.ok ? created.status : created.reason}`)
      }

      const outcome = await claimAndProcessResearchRun(created.runId, job.user_id, 'enrich-leads-live')
      if (!outcome) throw new Error('Run was claimed by another worker')

      console.log(
        `\n=== Run complete ===\n` +
          `status: ${outcome.status}\n` +
          `external calls: ${outcome.externalCalls}, cache hits: ${outcome.cacheHits}\n` +
          `evidence written: ${outcome.evidenceWritten}\n` +
          `estimated cost: $${(outcome.estimatedCostMicros / 1_000_000).toFixed(4)}`,
      )

      // Merge the run's KNOWN values onto the leads, then rewrite the CSV —
      // evidence alone never reaches an export.
      const merged = await mergeRunIntoLeads(job.user_id, created.runId)
      if (merged.ok) {
        console.log(
          `merged: ${merged.leadsUpdated} leads, ${merged.mergedCells} cells ` +
            `(${merged.unknownCells} unknown skipped)`,
        )
      } else {
        console.warn(`merge declined: ${merged.reason}`)
      }

      const rebuilt = await rebuildJobExport(jobId, job.user_id)
      console.log(`export rebuilt: ${rebuilt}`)

      expect(outcome.status).not.toBe('failed')
    },
    3_600_000,
  )
})
