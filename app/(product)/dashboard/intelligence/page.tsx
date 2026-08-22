import type { Metadata } from 'next'

import { HubbleConsole } from '@/components/intelligence/HubbleConsole'
import { requireHubbleAccess } from '@/lib/auth/access'
import type { LeadBatch } from '@/lib/intelligence/batches'
import { hubbleModelStatus } from '@/lib/intelligence/llm/catalog'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Hubble | Outlio',
  robots: { index: false, follow: false },
}

// Run state and counts change in the background; never serve them from a cache.
export const dynamic = 'force-dynamic'

export default async function HubblePage() {
  const ctx = await requireHubbleAccess()
  const userId = ctx.userId!
  const supabase = createAdminClient()

  const [jobs, files] = await Promise.all([
    supabase
      .from('extraction_jobs')
      .select('id, leads_kept, created_at')
      // Service role bypasses RLS — scoping by user_id is mandatory.
      .eq('user_id', userId)
      .in('status', ['completed', 'partially_completed'])
      .gt('leads_kept', 0)
      .order('created_at', { ascending: false })
      .limit(200),
    /*
     * The first file of each run gives the list a name a human recognises.
     * "Series A founders" beats "Run 3F9A2B" when picking which 25 people to
     * spend research credits on.
     */
    supabase
      .from('uploaded_files')
      .select('extraction_job_id, original_filename, created_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1000),
  ])

  /*
   * ⚠️ COUNT THE LEADS THAT ARE STILL THERE.
   *
   * `extraction_jobs.leads_kept` is what the run produced, not what survives.
   * Retention deletes lead rows — `purge_job_leads` — while the job row and its
   * counter remain, so a purged batch stayed in this dropdown advertising 25
   * leads and opened onto an empty list.
   *
   * The live count is the only honest source, and it covers every cause:
   * retention, a manual clear, anything later. Deliberately NOT a date window —
   * `retention_days` comes from `plans.limits` per plan, and CLAUDE.md forbids
   * hardcoding a plan limit.
   */
  const liveByJob = new Map<string, number>()
  const PAGE = 1000

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('extracted_leads')
      .select('extraction_job_id')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)

    if (error) break

    const rows = data ?? []
    for (const row of rows) {
      if (!row.extraction_job_id) continue
      liveByJob.set(row.extraction_job_id, (liveByJob.get(row.extraction_job_id) ?? 0) + 1)
    }
    if (rows.length < PAGE) break
  }

  const nameByJob = new Map<string, string>()
  for (const file of files.data ?? []) {
    if (!file.extraction_job_id || nameByJob.has(file.extraction_job_id)) continue
    const name = file.original_filename?.replace(/\.html?$/i, '').trim()
    if (name) nameByJob.set(file.extraction_job_id, name)
  }

  const batches: LeadBatch[] = (jobs.data ?? [])
    // A batch whose leads are gone is not a batch anyone can research.
    .filter((job) => (liveByJob.get(job.id) ?? 0) > 0)
    .map((job) => ({
      id: job.id,
      label: nameByJob.get(job.id) ?? `Run ${job.id.slice(0, 8).toUpperCase()}`,
      // The live count, not the historical one.
      leadCount: liveByJob.get(job.id) ?? 0,
      createdAt: job.created_at,
    }))

  return (
    <HubbleConsole
      userId={userId}
      // Only the NAME crosses to the browser. Which vendors we hold keys for
      // is operational detail, not something to publish in a dashboard.
      modelName={hubbleModelStatus().name}
      batches={batches}
    />
  )
}
