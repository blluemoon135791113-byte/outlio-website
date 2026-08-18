import type { Metadata } from 'next'
import { after } from 'next/server'

import { ExtractionDashboard } from '@/components/jobs/ExtractionDashboard'
import { requireAccess } from '@/lib/auth/access'
import { DEFAULT_LEAD_PAGE_SIZE } from '@/lib/jobs/lead-pagination'
import {
  DASHBOARD_FILE_SELECT,
  DASHBOARD_JOB_SELECT,
  DASHBOARD_LEAD_SELECT,
  type CreditSnapshot,
  type DashboardFile,
  type DashboardJob,
  type DashboardLead,
} from '@/lib/jobs/dashboard-types'
import { createAdminClient } from '@/lib/supabase/admin'
import { claimAndProcessJob } from '@/lib/worker/process-job'
import { getClayConnectionMetadata } from '@/lib/integrations/repository'
import { getGoogleConnectionMetadata } from '@/lib/integrations/google-repository'
import { getGhlConnectionMetadata } from '@/lib/integrations/ghl-repository'

export const metadata: Metadata = {
  title: 'Extraction workspace | Outlio',
  robots: { index: false, follow: false },
}

// Job state changes in the background and must never be served from a route cache.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export default async function JobsPage() {
  const ctx = await requireAccess()
  const userId = ctx.userId!
  const supabase = createAdminClient()

  /*
   * Recover abandoned claims before presenting the live state. Both functions
   * are cheap, idempotent, and non-fatal to the dashboard.
   */
  try {
    await Promise.all([
      supabase.rpc('reap_stale_jobs', { p_timeout_seconds: 900 }),
      supabase.rpc('reap_orphaned_uploads', { p_older_than_minutes: 10 }),
    ])
  } catch {
    // The dashboard can still read the last known state if a sweep fails.
  }

  const [jobResult, fileResult, leadResult, balanceResult, clayConnection, googleConnection, ghlConnection] = await Promise.all([
    supabase
      .from('extraction_jobs')
      .select(DASHBOARD_JOB_SELECT)
      // Service role bypasses RLS. Every query must be explicitly user-scoped.
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('uploaded_files')
      .select(DASHBOARD_FILE_SELECT)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(500),
    /*
     * The FIRST PAGE only, with an exact count.
     *
     * This used to read a flat `.limit(100)` and render every row in one list,
     * which meant an account with thousands of leads could never see past the
     * newest hundred and had to scroll the ones it could see. The table pages
     * in Postgres now; the client fetches subsequent pages itself.
     */
    supabase
      .from('extracted_leads')
      .select(DASHBOARD_LEAD_SELECT, { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(0, DEFAULT_LEAD_PAGE_SIZE - 1),
    supabase.rpc('credit_balance', { p_user_id: userId }),
    getClayConnectionMetadata(userId),
    getGoogleConnectionMetadata(userId),
    getGhlConnectionMetadata(userId),
  ])

  const balanceRow = Array.isArray(balanceResult.data) ? balanceResult.data[0] : null
  const jobs = (jobResult.data ?? []) as DashboardJob[]

  // The upload callback normally starts this exact job. Loading the workspace
  // provides a second, atomic wake-up path if the serverless callback was cut
  // short before it could claim a queued job.
  const queuedJob = jobs.find((job) => job.status === 'queued')
  if (queuedJob) {
    after(async () => {
      try {
        await claimAndProcessJob(queuedJob.id, userId, `dashboard:${queuedJob.id}`)
      } catch {
        // The durable queue remains the source of truth for the next retry.
      }
    })
  }

  const credits: CreditSnapshot | null = balanceRow
    ? {
        allowance: balanceRow.allowance,
        used: balanceRow.used,
        remaining: balanceRow.remaining,
      }
    : null

  return (
    <ExtractionDashboard
      userId={userId}
      initialJobs={jobs}
      initialFiles={(fileResult.data ?? []) as DashboardFile[]}
      initialLeads={(leadResult.data ?? []) as DashboardLead[]}
      initialLeadCount={leadResult.count ?? 0}
      credits={credits}
      planName={ctx.plan?.name ?? null}
      clayConnected={clayConnection?.status === 'connected'}
      googleConnected={googleConnection?.status === 'connected'}
      ghlConnected={ghlConnection?.status === 'connected'}
    />
  )
}
