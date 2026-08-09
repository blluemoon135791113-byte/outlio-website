import type { Metadata } from 'next'

import { ExtractionDashboard } from '@/components/jobs/ExtractionDashboard'
import { requireAccess } from '@/lib/auth/access'
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

export const metadata: Metadata = {
  title: 'Extraction workspace | Outlio',
  robots: { index: false, follow: false },
}

// Job state changes in the background and must never be served from a route cache.
export const dynamic = 'force-dynamic'

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

  const [jobResult, fileResult, leadResult, balanceResult] = await Promise.all([
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
    supabase
      .from('extracted_leads')
      .select(DASHBOARD_LEAD_SELECT)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.rpc('credit_balance', { p_user_id: userId }),
  ])

  const balanceRow = Array.isArray(balanceResult.data) ? balanceResult.data[0] : null
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
      initialJobs={(jobResult.data ?? []) as DashboardJob[]}
      initialFiles={(fileResult.data ?? []) as DashboardFile[]}
      initialLeads={(leadResult.data ?? []) as DashboardLead[]}
      credits={credits}
      planName={ctx.plan?.name ?? null}
    />
  )
}
