/**
 * One-time/idempotent repair for Account List jobs completed before migration
 * 0067 introduced durable list membership.
 *
 * Usage:
 *   npx vite-node --config vitest.config.mts scripts/backfill-account-list-entries.ts --apply
 */
import { loadEnvConfig } from '@next/env'

import { createAdminClient } from '@/lib/supabase/admin'
import { processJob } from '@/lib/worker/process-job'

async function main() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Pass --apply to confirm the Account List backfill.')
  }
  loadEnvConfig(process.cwd())
  const supabase = createAdminClient()
  const { data: jobs, error } = await supabase
    .from('extraction_jobs')
    .select('id, user_id')
    .eq('kind', 'account_list')
    .in('status', ['completed', 'partially_completed'])
  if (error) throw new Error('Could not load Account List jobs.')

  let repaired = 0
  for (const job of jobs ?? []) {
    const { count, error: countError } = await supabase
      .from('account_list_entries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', job.user_id)
      .eq('extraction_job_id', job.id)
    if (countError) throw new Error('Could not inspect Account List membership.')
    if ((count ?? 0) > 0) continue
    await processJob(job.id, job.user_id)
    repaired += 1
  }

  console.log(`Account List backfill complete: ${repaired} run${repaired === 1 ? '' : 's'} repaired.`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Account List backfill failed.')
  process.exitCode = 1
})
