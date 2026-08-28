'use client'

import Link from 'next/link'
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DeleteRunButton, RowExportMenu } from '@/components/jobs/RowActions'
import {
  deleteJobAction,
  getDownloadUrlAction,
  restoreJobAction,
  trashJobAction,
  type JobActionState,
} from '@/lib/jobs/actions'
import {
  DASHBOARD_FILE_SELECT,
  DASHBOARD_JOB_SELECT,
  type CreditSnapshot,
  type DashboardFile,
  type DashboardJob,
} from '@/lib/jobs/dashboard-types'
import {
  currentStage,
  FINISHED_JOB_STATUSES,
  isActiveJob,
  runProgress,
} from '@/lib/jobs/progress'
import { createClient } from '@/lib/supabase/client'
import type { JobStatus } from '@/types/database'

type ConnectionState = 'connecting' | 'live' | 'fallback'
type HistoryFilter = 'all' | 'active' | 'completed' | 'attention'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(value))
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function jobLabel(job: DashboardJob, files: readonly DashboardFile[] = []) {
  const firstFile = files.find((file) => file.extraction_job_id === job.id)
  if (firstFile?.original_filename) {
    return firstFile.original_filename.replace(/\.html?$/i, '')
  }
  return `Run ${job.id.slice(0, 8).toUpperCase()}`
}

export function ExtractionDashboard({
  userId,
  initialJobs,
  initialFiles,
  credits,
  clayConnected,
  googleConnected,
  ghlConnected,
}: {
  userId: string
  initialJobs: DashboardJob[]
  initialFiles: DashboardFile[]
  credits: CreditSnapshot | null
  clayConnected: boolean
  googleConnected: boolean
  ghlConnected: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const [jobs, setJobs] = useState(initialJobs)
  const [files, setFiles] = useState(initialFiles)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState(
    initialJobs.find(isActiveJob)?.id ?? initialJobs[0]?.id ?? null,
  )
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  /*
   * ⚠️ SELECTED LEAD RECORDS, NOT JUST IDS.
   *
   * Paging happens in Postgres, so leads chosen on page 1 are no longer in
   * `leads` once the user reaches page 2 — and the export menu builds its
   * payload from `leads`. Keeping the rows means a selection spanning pages
   * exports every row the user ticked, instead of silently dropping the ones
   * that scrolled out of the query.
   */
  const refreshing = useRef(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasActiveJobs = jobs.some(isActiveJob)

  const refresh = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true

    try {
      const [jobResult, fileResult] = await Promise.all([
        supabase
          .from('extraction_jobs')
          .select(DASHBOARD_JOB_SELECT)
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
      ])

      if (jobResult.error || fileResult.error) {
        throw new Error('Dashboard refresh failed')
      }

      setJobs((jobResult.data ?? []) as DashboardJob[])
      setFiles((fileResult.data ?? []) as DashboardFile[])
      setRefreshError(null)
    } catch {
      setRefreshError('Live data paused. We will keep retrying automatically.')
      setConnection('fallback')
    } finally {
      refreshing.current = false
    }
  }, [supabase, userId])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => void refresh(), 180)
    }

    const channel = supabase
      .channel(`extraction-dashboard:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'extraction_jobs',
          filter: `user_id=eq.${userId}`,
        },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'uploaded_files',
          filter: `user_id=eq.${userId}`,
        },
        scheduleRefresh,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('live')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('fallback')
        }
      })

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      document.removeEventListener('visibilitychange', onVisibility)
      void supabase.removeChannel(channel)
    }
  }, [refresh, supabase, userId])

  useEffect(() => {
    const interval = window.setInterval(
      () => void refresh(),
      hasActiveJobs ? 2_500 : 15_000,
    )
    return () => window.clearInterval(interval)
  }, [hasActiveJobs, refresh])

  const activeJob = jobs.find(isActiveJob) ?? null
  const selectedJob =
    jobs.find((job) => job.id === selectedJobId) ?? activeJob ?? jobs[0] ?? null
  const selectedFiles = selectedJob
    ? files
        .filter((file) => file.extraction_job_id === selectedJob.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    : []

  const isTrashed = (job: DashboardJob) => job.trashed_at !== null

  /*
   * Trashed runs leave the history the moment they are deleted — that is what
   * "free up workspace" means. They live in the trash box instead.
   */
  const filteredJobs = jobs.filter((job) => {
    if (isTrashed(job)) return false
    if (historyFilter === 'active') return isActiveJob(job)
    if (historyFilter === 'completed') return FINISHED_JOB_STATUSES.has(job.status)
    if (historyFilter === 'attention') {
      return job.status === 'failed' || job.status === 'cancelled' || job.status === 'partially_completed'
    }
    return true
  })

  const trashedJobs = jobs.filter(isTrashed)

  const activeJobsCount = jobs.filter(isActiveJob).length

   const totals = jobs.reduce(
    (acc, job) => {
      acc.files += FINISHED_JOB_STATUSES.has(job.status)
        ? job.file_count
        : Math.min(job.progress_current, job.file_count)
      // Only lead runs contribute to the lead total.
      if (job.kind !== 'account_list') acc.leads += job.leads_kept
      acc.duplicates += job.duplicates_removed
      if (FINISHED_JOB_STATUSES.has(job.status)) acc.completed += 1
      return acc
    },
    { files: 0, leads: 0, duplicates: 0, completed: 0 },
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
              Lead Engine
            </p>
            <ConnectionBadge connection={connection} />
          </div>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            Extraction workspace
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Every run, its files, and the leads kept.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-border-strong bg-panel px-4 text-sm font-semibold text-ink transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/35 hover:bg-accent-soft/40 active:scale-[0.97]"
            >
              Refresh now
            </button>
            <Link
              href="/dashboard/extract/new"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-semibold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-accent-deep active:scale-[0.97]"
            >
              <span aria-hidden className="text-base leading-none">+</span>
              New extraction
            </Link>
        </div>
      </header>

      {refreshError ? (
        <p
          role="status"
          className="rounded-[var(--radius-md)] border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          {refreshError}
        </p>
      ) : null}

      {activeJob ? <ActiveRun job={activeJob} /> : <CaughtUp latestJob={jobs[0] ?? null} />}

      <section aria-label="Workspace totals" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {/* ⚠️ null is "unknown", 0 is "none left". `?? 0` conflated them. */}
        <MetricCard
          featured
          label="Credits remaining"
          value={credits?.remaining ?? null}
          detail={
            credits
              ? `${credits.used} used of ${credits.allowance}`
              : 'Balance unavailable — refresh to retry'
          }
        />
        <MetricCard label="Completed extractions" value={totals.completed} detail={`${jobs.length} total in history`} />
        <MetricCard label="Files processed" value={totals.files} detail="Across extraction history" />
        <MetricCard label="Leads extracted" value={totals.leads} detail="Unique leads kept" />
        <MetricCard label="Duplicates removed" value={totals.duplicates} detail="Automatically cleaned" />
      </section>

      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <section className="relative z-20 flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-sm)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">Extraction history</h2>
                <p className="mt-0.5 text-sm text-muted">
                  {jobs.length.toLocaleString()} run{jobs.length === 1 ? '' : 's'}
                  {activeJobsCount > 0 ? ` · ${activeJobsCount} processing` : ''} · trash deletes a run&rsquo;s lead data; the CSV is kept.
                </p>
              </div>
              <HistoryFilters value={historyFilter} onChange={setHistoryFilter} />
            </div>

            <div className="max-h-[62vh] min-h-0 overflow-y-auto">
              {filteredJobs.length > 0 ? (
                <ul className="divide-y divide-border">
                  {filteredJobs.map((job) => (
                    <JobHistoryRow
                      key={job.id}
                      job={job}
                      selected={selectedJob?.id === job.id}
                      onSelect={() => setSelectedJobId(job.id)}
                      onPurged={refresh}
                      onDeleted={refresh}
                      label={jobLabel(job, files)}
                      clayConnected={clayConnected}
                      googleConnected={googleConnected}
                      ghlConnected={ghlConnected}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-10 text-center text-sm text-muted">No extractions match this filter.</p>
              )}
            </div>
          </section>

          <div className="flex min-w-0 flex-col gap-6">
            <FilePipeline job={selectedJob} files={selectedFiles} />
            <TrashBox jobs={trashedJobs} labelFor={jobLabel} onRestore={refresh} />
          </div>
        </div>
      )}
    </div>
  )
}

function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  const label =
    connection === 'live'
      ? 'Live updates'
      : connection === 'fallback'
        ? 'Auto-updating'
        : 'Connecting'

  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-panel px-2.5 py-1 text-xs font-semibold text-accent"
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full bg-accent ${connection === 'live' ? 'motion-safe:animate-pulse' : ''}`}
      />
      {label}
    </span>
  )
}

function ActiveRun({ job }: { job: DashboardJob }) {
  const percent = runProgress(job)
  const total = Math.max(job.progress_total, job.file_count)
  const processed = Math.min(job.progress_current, total)
  const remaining = Math.max(total - processed, 0)
  const stage = currentStage(job)

  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-md)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <span className="text-sm font-medium text-muted">{jobLabel(job)}</span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.025em] text-ink sm:text-2xl">
            {job.progress_step ?? 'Preparing your extraction'}
          </h2>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {processed.toLocaleString()} of {total.toLocaleString()} files processed
            {job.leads_parsed > 0 ? ` · ${job.leads_parsed.toLocaleString()} leads found so far` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-heading text-4xl font-semibold tabular-nums tracking-[-0.045em] text-ink">{percent}%</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.12em] text-muted">
            Run progress
          </p>
        </div>
      </div>

      <div
        className="mt-5 h-2 overflow-hidden rounded-full bg-accent-soft"
        role="progressbar"
        aria-label="Extraction progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full origin-left rounded-full bg-accent transition-transform duration-150 ease-out"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      </div>

      <ol className="mt-5 grid grid-cols-4 gap-2" aria-label="Extraction stages">
        {['Queue', 'Process', 'Clean', 'Export'].map((label, index) => {
          const completed = index < stage
          const current = index === stage
          return (
            <li key={label} className="min-w-0">
              <div
                className={`h-1 rounded-full ${completed || current ? 'bg-accent' : 'bg-border'}`}
              />
              <p className={`mt-1.5 truncate text-xs font-medium ${current ? 'text-accent' : 'text-muted'}`}>
                {label}
              </p>
            </li>
          )
        })}
      </ol>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RunStat label="Processed" value={processed} suffix="files" />
        <RunStat label="Remaining" value={remaining} suffix="files" />
        <RunStat label="Leads found" value={job.leads_parsed} suffix="rows" />
        <RunStat label="Duplicates removed" value={job.duplicates_removed} suffix="rows" />
      </div>
    </section>
  )
}

function RunStat({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-paper px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 font-heading text-xl font-semibold tabular-nums text-ink">
        {value.toLocaleString()}{' '}
        <span className="text-xs font-medium text-muted">{suffix}</span>
      </p>
    </div>
  )
}

/*
 * ⚠️ SAGE, BECAUSE THIS IS THE "ALL CLEAR" CARD.
 *
 * Sage was defined but invisible — only `--success-soft` referenced it, and at
 * that tint it reads as off-white. A settled, positive state is the one thing
 * sage should mean, so this card wears it properly. It is the ONLY sage
 * surface on the page; that restraint is what keeps it a signal.
 */
function CaughtUp({ latestJob }: { latestJob: DashboardJob | null }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-clay)] bg-sage-soft p-5 shadow-[var(--neo-shadow)] ring-1 ring-sage/30 sm:p-6">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-sage text-ivory">
            ✓
          </span>
          <h2 className="text-lg font-semibold text-ink">Your workspace is caught up</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          {latestJob
            ? `Last extraction: ${latestJob.leads_kept.toLocaleString()} leads from ${latestJob.file_count.toLocaleString()} file${latestJob.file_count === 1 ? '' : 's'}`
            : 'Start an extraction to build your first clean lead list.'}
        </p>
      </div>
      <Link
        href="/dashboard/extract/new"
        className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-semibold text-ink transition-[border-color,transform] duration-150 hover:border-border-strong active:scale-[0.97]"
      >
        Start another extraction
      </Link>
    </section>
  )
}

/**
 * What a run produced, in its own units.
 *
 * ⚠️ AN ACCOUNT RUN IS NOT A LEAD RUN WITH ZERO LEADS. Reading `leads_kept`
 * for every job renders a successful ingest of 25 companies as "0 leads kept"
 * — a run that worked, displayed as one that produced nothing. That is the
 * failure-looks-like-empty pattern, and it is worse here than a blank cell
 * because the number is confidently wrong rather than absent.
 */
function jobYield(job: DashboardJob): string {
  if (job.kind === 'account_list') {
    const n = job.accounts_created + job.accounts_matched
    return `${n.toLocaleString()} compan${n === 1 ? 'y' : 'ies'}`
  }
  return `${job.leads_kept.toLocaleString()} lead${job.leads_kept === 1 ? '' : 's'}`
}

function MetricCard({ label, value, detail, featured = false }: { label: string; value: number | null; detail: string; featured?: boolean }) {
  return (
    <div className={featured ? 'min-h-32 rounded-[var(--radius-clay)] bg-accent p-4 text-white shadow-[var(--neo-shadow)]' : 'clay min-h-32 p-4'}>
      <p className={featured ? 'text-xs font-medium text-white/75' : 'text-xs font-medium text-muted'}>{label}</p>
      <p className="mt-4 font-heading text-[28px] font-semibold leading-none tabular-nums tracking-[-0.04em]">{value === null ? '—' : value.toLocaleString()}</p>
      <p className={featured ? 'mt-3 text-xs text-white/70' : 'mt-3 text-xs text-muted'}>{detail}</p>
    </div>
  )
}

function HistoryFilters({
  value,
  onChange,
}: {
  value: HistoryFilter
  onChange: (filter: HistoryFilter) => void
}) {
  const filters: Array<{ value: HistoryFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
    { value: 'attention', label: 'Needs attention' },
  ]

  return (
    <div className="flex flex-wrap gap-1" aria-label="Filter extraction history">
      {filters.map((filter) => (
        <button
          key={filter.value}
          type="button"
          aria-pressed={value === filter.value}
          onClick={() => onChange(filter.value)}
          className={
            value === filter.value
              ? 'rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent'
              : 'rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink'
          }
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}

function JobHistoryRow({
  job,
  label,
  selected,
  onSelect,
  onPurged,
  onDeleted,
  clayConnected,
  googleConnected,
  ghlConnected,
}: {
  job: DashboardJob
  label: string
  selected: boolean
  onSelect: () => void
  onPurged: () => void
  onDeleted: () => void
  clayConnected: boolean
  googleConnected: boolean
  ghlConnected: boolean
}) {
  const percent = runProgress(job)

  return (
    <li className={selected ? 'bg-accent-soft/55 px-5 py-4' : 'px-5 py-4 transition-colors duration-150 hover:bg-surface-muted/70'}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <span className="text-sm font-semibold text-ink">{label}</span>
            <time dateTime={job.created_at} className="text-xs text-muted">
              {formatDate(job.created_at)}
            </time>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{job.file_count.toLocaleString()} file{job.file_count === 1 ? '' : 's'}</span>
            <span>
              {job.status === 'processing'
                ? job.kind === 'account_list'
                  ? `${job.accounts_parsed.toLocaleString()} companies found`
                  : `${job.leads_parsed.toLocaleString()} leads found`
                : job.kind === 'account_list'
                  ? `${jobYield(job)} ingested`
                  : `${job.leads_kept.toLocaleString()} leads kept`}
            </span>
            {job.kind === 'account_list' ? (
              // "Already known" is the account equivalent, and it is a
              // different fact from a duplicate row removed from an export.
              <span>{job.accounts_matched.toLocaleString()} already known</span>
            ) : (
              <span>{job.duplicates_removed.toLocaleString()} duplicates removed</span>
            )}
            {isActiveJob(job) ? <span className="font-medium text-accent">{percent}% complete</span> : null}
          </div>
          {job.error_message ? <p className="mt-2 text-sm text-danger">{job.error_message}</p> : null}
        </button>

        {!isActiveJob(job) ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RowExportMenu
              jobId={job.id}
              hasExport={Boolean(job.export_storage_path)}
              leadsRemaining={job.leads_kept}
              clayConnected={clayConnected}
              googleConnected={googleConnected}
              ghlConnected={ghlConnected}
            />
            <TrashButton jobId={job.id} onTrashed={onPurged} />
            <DeleteRunButton jobId={job.id} onDeleted={onDeleted} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

function FilePipeline({ job, files }: { job: DashboardJob | null; files: DashboardFile[] }) {
  const processed = files.filter((file) => file.status === 'processed').length
  const failed = files.filter((file) => file.status === 'failed').length

  return (
    <section className="min-w-0 w-full rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-sm)] xl:sticky xl:top-6">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-ink">File pipeline</h2>
        <p className="mt-0.5 text-sm text-muted">
          {job ? jobLabel(job, files) : 'Select an extraction'}
        </p>
      </div>

      {job ? (
        <>
          <div className="grid grid-cols-3 border-b border-border">
            <PipelineTotal label="Total" value={files.length || job.file_count} />
            <PipelineTotal label="Processed" value={processed} />
            <PipelineTotal label="Failed" value={failed} danger={failed > 0} />
          </div>
          {files.length > 0 ? (
            <ul className="max-h-[30rem] divide-y divide-border overflow-y-auto" data-lenis-prevent>
              {files.map((file, index) => (
                <li key={file.id} className="flex items-start gap-3 px-5 py-3">
                  <FileStatusDot status={file.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink" title={file.original_filename}>
                      {file.original_filename}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      File {index + 1} · {formatBytes(file.byte_size)}
                      {file.leads_found > 0 ? ` · ${file.leads_found.toLocaleString()} leads` : ''}
                    </p>
                    {file.error_message ? <p className="mt-1 text-xs text-danger">{file.error_message}</p> : null}
                  </div>
                  <span className="text-xs font-medium capitalize text-muted">{file.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted">
              File details will appear when processing begins.
            </p>
          )}
        </>
      ) : (
        <p className="px-5 py-8 text-center text-sm text-muted">
          Select an extraction to inspect its files.
        </p>
      )}
    </section>
  )
}

function PipelineTotal({
  label,
  value,
  danger = false,
}: {
  label: string
  value: number
  danger?: boolean
}) {
  return (
    <div className="px-4 py-3 text-center">
      <p className={`font-heading text-lg font-semibold tabular-nums ${danger ? 'text-danger' : 'text-ink'}`}>
        {value.toLocaleString()}
      </p>
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">{label}</p>
    </div>
  )
}

function FileStatusDot({ status }: { status: DashboardFile['status'] }) {
  const className =
    status === 'processed'
      ? 'bg-success'
      : status === 'failed'
        ? 'bg-danger'
        : status === 'processing'
          ? 'bg-accent motion-safe:animate-pulse'
          : 'bg-border-strong'

  return <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${className}`} />
}

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; className: string }> = {
    uploaded: { label: 'Uploaded', className: 'border-info/25 bg-info-soft text-info' },
    queued: { label: 'Queued', className: 'border-info/25 bg-info-soft text-info' },
    processing: { label: 'Processing', className: 'border-accent/25 bg-accent-soft text-accent' },
    completed: { label: 'Completed', className: 'border-success/25 bg-success-soft text-success' },
    partially_completed: {
      label: 'Completed with errors',
      className: 'border-warning/25 bg-warning-soft text-warning',
    },
    failed: { label: 'Failed', className: 'border-danger/25 bg-danger-soft text-danger' },
    cancelled: { label: 'Cancelled', className: 'border-danger/25 bg-danger-soft text-danger' },
  }
  const item = map[status]

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${item.className}`}>
      {item.label}
    </span>
  )
}

function EmptyState() {
  return (
    <section className="rounded-[var(--radius-xl)] border border-dashed border-border bg-panel px-6 py-14 text-center">
      <h2 className="text-lg font-semibold text-ink">Your first pipeline starts here</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted">
        Upload saved lead-search pages. Outlio will show each file moving through the
        pipeline, clean the results, and build your downloadable CSV.
      </p>
      <Link
        href="/dashboard/extract/new"
        className="mt-5 inline-block rounded-[var(--radius-md)] bg-accent px-4 py-2.5 text-sm font-semibold text-cream transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97]"
      >
        Start your first extraction
      </Link>
    </section>
  )
}

/**
 * The trash box — where trashed extractions go instead of haunting history.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 *  MINIMAL BY INTENT. Muted surfaces, small type, no heavy borders: this box
 *  holds deletions, and quiet is the point. The CSV survives a purge, so each
 *  row keeps a small download affordance — data the user paid for never
 *  disappears behind a cleanup.
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
function TrashBox({
  jobs,
  labelFor,
  onRestore,
}: {
  jobs: DashboardJob[]
  labelFor: (job: DashboardJob) => string
  onRestore: () => void
}) {
  if (jobs.length === 0) return null

  return (
    <section
      aria-label="Trash"
      className="rounded-[var(--radius-xl)] border border-border/60 bg-paper/70 p-4 shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">Trash</h2>
        <span className="text-[11px] tabular-nums text-muted">{jobs.length.toLocaleString()}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">
        Restorable. Deleting for good also erases the lead data.
      </p>

      {/*
       * ⚠️ THE LIST SCROLLS INSIDE THE BOX, same contract as the history
       * panel: a growing trash pile must never stretch the page.
       */}
      <div className="mt-3 max-h-[40vh] min-h-0 overflow-y-auto pr-1">
        <ul className="space-y-2">
          {jobs.map((job) => (
            <TrashRow key={job.id} job={job} label={labelFor(job)} onRestore={onRestore} />
          ))}
        </ul>
      </div>
    </section>
  )
}

function TrashRow({
  job,
  label,
  onRestore,
}: {
  job: DashboardJob
  label: string
  onRestore: () => void
}) {
  const [download, downloadAction] = useActionState(getDownloadUrlAction, { status: 'idle' } as JobActionState)
  const [restore, restoreAction] = useActionState(restoreJobAction, { status: 'idle' } as JobActionState)
  const [del, deleteAction] = useActionState(deleteJobAction, { status: 'idle' } as JobActionState)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (download.status === 'ready') window.location.href = download.url
  }, [download])

  useEffect(() => {
    if (restore.status === 'purged' || del.status === 'purged') onRestore()
  }, [restore, del, onRestore])

  const busy = restore.status === 'purged' || del.status !== 'idle' && del.status !== 'error'

  return (
    <li className="rounded-[var(--radius-lg)] border border-border/50 bg-panel/80 px-3 py-2.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-ink/75">{label}</span>
        <time dateTime={job.created_at} className="shrink-0 text-[11px] text-muted">
          {formatDate(job.created_at)}
        </time>
      </div>

      {confirmingDelete ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-danger">Delete this extraction and its lead data?</span>
          <div className="flex items-center gap-1.5">
            <form action={deleteAction}>
              <input type="hidden" name="job_id" value={job.id} />
              <button
                type="submit"
                className="rounded-[var(--radius-md)] bg-danger/10 px-2 py-1 text-[11px] font-semibold text-danger transition-colors duration-150 hover:bg-danger/20"
              >
                {del.status === 'purged' ? 'Deleted' : 'Delete'}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-[var(--radius-md)] border border-border px-2 py-1 text-[11px] text-muted transition-colors duration-150 hover:text-ink"
            >
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">
            {jobYield(job)} · {job.file_count.toLocaleString()} file{job.file_count === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2.5">
            {job.export_storage_path ? (
              <form action={downloadAction}>
                <input type="hidden" name="job_id" value={job.id} />
                <button
                  type="submit"
                  className="text-[11px] font-medium text-muted underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-ink"
                >
                  {download.status === 'idle' ? 'Download CSV' : 'Preparing…'}
                </button>
              </form>
            ) : null}
            <form action={restoreAction}>
              <input type="hidden" name="job_id" value={job.id} />
              <button
                type="submit"
                className="text-[11px] font-semibold text-accent transition-colors duration-150 hover:text-accent-deep"
              >
                {busy && restore.status !== 'purged' ? 'Restoring…' : 'Restore'}
              </button>
            </form>
            <button
              type="button"
              aria-label="Permanently delete this extraction"
              onClick={() => setConfirmingDelete(true)}
              className="text-[11px] font-medium text-muted transition-colors duration-150 hover:text-danger"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {(() => {
        const firstError = [download, restore, del].find((state) => state.status === 'error')
        return firstError && firstError.status === 'error' ? (
          <p role="alert" className="mt-1 text-[11px] text-danger">{firstError.message}</p>
        ) : null
      })()}
    </li>
  )
}

/** Soft-delete: the run leaves history and parks in the Trash box. */
function TrashButton({ jobId, onTrashed }: { jobId: string; onTrashed: () => void }) {
  const [trashed, trashAction] = useActionState(trashJobAction, { status: 'idle' } as JobActionState)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (trashed.status === 'purged') onTrashed()
  }, [trashed, onTrashed])

  if (trashed.status === 'purged') {
    return <span className="text-[11px] text-muted">In trash</span>
  }

  return confirming ? (
    <div className="flex items-center gap-1.5" role="group" aria-label="Confirm moving to trash">
      <span className="text-xs font-medium text-danger">Move to trash?</span>
      <form action={trashAction}>
        <input type="hidden" name="job_id" value={jobId} />
        <button
          type="submit"
          aria-label="Confirm: move to trash"
          className="inline-flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-danger/10 text-danger transition-colors duration-150 hover:bg-danger/20 active:scale-[0.95]"
        >
          <TrashIcon />
        </button>
      </form>
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => setConfirming(false)}
        className="inline-flex size-9 items-center justify-center rounded-[var(--radius-md)] border border-border text-muted transition-colors duration-150 hover:text-ink"
      >
        <svg aria-hidden viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </div>
  ) : (
    <button
      type="button"
      aria-label="Move this extraction to trash"
      title="Move to trash (restorable)"
      onClick={() => setConfirming(true)}
      className="inline-flex size-10 items-center justify-center rounded-[var(--radius-md)] border border-border text-muted transition-colors duration-150 hover:border-danger/40 hover:text-danger active:scale-[0.97]"
    >
      <TrashIcon />
    </button>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3.5 5.5h13M8 5V3.8c0-.44.36-.8.8-.8h2.4c.44 0 .8.36.8.8V5M5 5.5l.7 10.2c.04.72.64 1.3 1.36 1.3h5.88c.72 0 1.32-.58 1.36-1.3L15 5.5M8.2 8.8v4.9M11.8 8.8v4.9" />
    </svg>
  )
}
