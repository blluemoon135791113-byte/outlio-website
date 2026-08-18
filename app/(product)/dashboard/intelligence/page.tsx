import type { Metadata } from 'next'

import { HubbleConsole } from '@/components/intelligence/HubbleConsole'
import { requireAccess } from '@/lib/auth/access'
import type { LeadBatch } from '@/lib/intelligence/batches'
import { availableModels } from '@/lib/intelligence/llm/catalog'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Hubble | Outlio',
  robots: { index: false, follow: false },
}

// Run state and counts change in the background; never serve them from a cache.
export const dynamic = 'force-dynamic'

export default async function HubblePage() {
  const ctx = await requireAccess()
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

  const nameByJob = new Map<string, string>()
  for (const file of files.data ?? []) {
    if (!file.extraction_job_id || nameByJob.has(file.extraction_job_id)) continue
    const name = file.original_filename?.replace(/\.html?$/i, '').trim()
    if (name) nameByJob.set(file.extraction_job_id, name)
  }

  const batches: LeadBatch[] = (jobs.data ?? []).map((job) => ({
    id: job.id,
    label: nameByJob.get(job.id) ?? `Run ${job.id.slice(0, 8).toUpperCase()}`,
    leadCount: job.leads_kept,
    createdAt: job.created_at,
  }))

  return (
    <HubbleConsole
      userId={userId}
      // Resolved on the server: the browser must never be told which API keys
      // exist, only which models it may choose between.
      models={availableModels().map((model) => ({
        id: model.id,
        label: model.label,
        model: model.model,
        hint: model.hint,
      }))}
      batches={batches}
    />
  )
}
