import type { DashboardJob } from '@/lib/jobs/dashboard-types'
import type { JobStatus } from '@/types/database'

export const ACTIVE_JOB_STATUSES = new Set<JobStatus>(['uploaded', 'queued', 'processing'])
export const FINISHED_JOB_STATUSES = new Set<JobStatus>(['completed', 'partially_completed'])

export function isActiveJob(job: DashboardJob) {
  return ACTIVE_JOB_STATUSES.has(job.status)
}

export function fileProgress(job: DashboardJob) {
  const total = Math.max(job.progress_total, job.file_count, 0)
  if (total === 0) return 0
  return Math.min(100, Math.round((Math.min(job.progress_current, total) / total) * 100))
}

/**
 * Overall progress reserves the final 18% for deterministic cleanup/export
 * stages. That prevents a run from claiming 100% while the CSV is still being
 * generated, while the separate file counter remains exact.
 */
export function runProgress(job: DashboardJob) {
  if (FINISHED_JOB_STATUSES.has(job.status)) return 100
  if (job.status === 'failed' || job.status === 'cancelled') return fileProgress(job)
  if (job.status === 'uploaded' || job.status === 'queued') return 0

  const step = (job.progress_step ?? '').toLowerCase()
  if (step.includes('generating export')) return 96
  if (step.includes('duplicate') || step.includes('clean')) return 88
  return Math.min(82, 8 + Math.round(fileProgress(job) * 0.74))
}

export function currentStage(job: DashboardJob) {
  const step = (job.progress_step ?? '').toLowerCase()
  if (step.includes('generating export')) return 3
  if (step.includes('duplicate') || step.includes('clean')) return 2
  if (job.status === 'processing') return 1
  return 0
}
