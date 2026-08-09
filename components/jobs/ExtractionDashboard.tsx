'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { JobActions } from '@/components/jobs/JobActions'
import {
  DASHBOARD_FILE_SELECT,
  DASHBOARD_JOB_SELECT,
  DASHBOARD_LEAD_SELECT,
  type CreditSnapshot,
  type DashboardFile,
  type DashboardJob,
  type DashboardLead,
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

function missing(value: string | null) {
  return value?.trim() || 'Not available'
}

function safeProfileUrl(value: string | null) {
  if (!value) return null

  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function jobLabel(job: DashboardJob) {
  return `Run ${job.id.slice(0, 8).toUpperCase()}`
}

export function ExtractionDashboard({
  userId,
  initialJobs,
  initialFiles,
  initialLeads,
  credits,
  planName,
}: {
  userId: string
  initialJobs: DashboardJob[]
  initialFiles: DashboardFile[]
  initialLeads: DashboardLead[]
  credits: CreditSnapshot | null
  planName: string | null
}) {
  const supabase = useMemo(() => createClient(), [])
  const [jobs, setJobs] = useState(initialJobs)
  const [files, setFiles] = useState(initialFiles)
  const [leads, setLeads] = useState(initialLeads)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState(
    initialJobs.find(isActiveJob)?.id ?? initialJobs[0]?.id ?? null,
  )
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [leadSearch, setLeadSearch] = useState('')
  const refreshing = useRef(false)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasActiveJobs = jobs.some(isActiveJob)

  const refresh = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true

    try {
      const [jobResult, fileResult, leadResult] = await Promise.all([
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
        supabase
          .from('extracted_leads')
          .select(DASHBOARD_LEAD_SELECT)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      if (jobResult.error || fileResult.error || leadResult.error) {
        throw new Error('Dashboard refresh failed')
      }

      setJobs((jobResult.data ?? []) as DashboardJob[])
      setFiles((fileResult.data ?? []) as DashboardFile[])
      setLeads((leadResult.data ?? []) as DashboardLead[])
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

  const filesById = useMemo(
    () => new Map(files.map((file) => [file.id, file.original_filename])),
    [files],
  )

  const filteredJobs = jobs.filter((job) => {
    if (historyFilter === 'active') return isActiveJob(job)
    if (historyFilter === 'completed') return FINISHED_JOB_STATUSES.has(job.status)
    if (historyFilter === 'attention') {
      return job.status === 'failed' || job.status === 'cancelled' || job.status === 'partially_completed'
    }
    return true
  })

  const normalizedSearch = leadSearch.trim().toLowerCase()
  const filteredLeads = leads.filter((lead) => {
    if (!normalizedSearch) return true
    return [lead.full_name, lead.job_title, lead.company_name, lead.location].some((value) =>
      value?.toLowerCase().includes(normalizedSearch),
    )
  })

  const totals = jobs.reduce(
    (acc, job) => {
      acc.files += FINISHED_JOB_STATUSES.has(job.status)
        ? job.file_count
        : Math.min(job.progress_current, job.file_count)
      acc.leads += job.leads_kept
      acc.duplicates += job.duplicates_removed
      if (FINISHED_JOB_STATUSES.has(job.status)) acc.completed += 1
      return acc
    },
    { files: 0, leads: 0, duplicates: 0, completed: 0 },
  )

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[var(--radius-xl)] border border-accent/20 bg-accent-soft shadow-[var(--shadow-sm)]">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Lead Engine workspace
              </p>
              <ConnectionBadge connection={connection} />
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Your extraction pipeline, live.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
              Follow every file from queue to clean CSV, inspect the leads that made it
              through, and keep the complete history in one workspace.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Link
              href="/dashboard/extract/new"
              className="rounded-[var(--radius-md)] bg-accent px-4 py-2.5 text-sm font-semibold text-cream transition-[background-color,transform] duration-150 hover:bg-accent-deep active:scale-[0.97]"
            >
              New extraction
            </Link>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-[var(--radius-md)] border border-accent/25 bg-panel px-4 py-2.5 text-sm font-semibold text-ink transition-[border-color,transform] duration-150 hover:border-accent/50 active:scale-[0.97]"
            >
              Refresh now
            </button>
          </div>
        </div>
      </section>

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
        <MetricCard label="Credits remaining" value={credits?.remaining ?? 0} detail={credits ? `${credits.used} used of ${credits.allowance}` : planName ?? 'Current plan'} />
        <MetricCard label="Completed runs" value={totals.completed} detail={`${jobs.length} total in history`} />
        <MetricCard label="Files processed" value={totals.files} detail="Across extraction history" />
        <MetricCard label="Leads extracted" value={totals.leads} detail="Unique leads kept" />
        <MetricCard label="Duplicates removed" value={totals.duplicates} detail="Automatically cleaned" />
      </section>

      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <section className="min-w-0 self-start rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-sm)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-ink">Extraction history</h2>
                <p className="mt-0.5 text-sm text-muted">Every run and its final outcome.</p>
              </div>
              <HistoryFilters value={historyFilter} onChange={setHistoryFilter} />
            </div>

            {filteredJobs.length > 0 ? (
              <ul className="divide-y divide-border">
                {filteredJobs.map((job) => (
                  <JobHistoryRow
                    key={job.id}
                    job={job}
                    selected={selectedJob?.id === job.id}
                    onSelect={() => setSelectedJobId(job.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-muted">
                No runs match this filter.
              </p>
            )}
          </section>

          <FilePipeline job={selectedJob} files={selectedFiles} />
        </div>
      )}

      <LeadPreview
        leads={filteredLeads}
        totalVisible={leads.length}
        search={leadSearch}
        onSearch={setLeadSearch}
        filesById={filesById}
      />
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
          <h2 className="mt-3 text-xl font-bold tracking-tight text-ink sm:text-2xl">
            {job.progress_step ?? 'Preparing your extraction'}
          </h2>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {processed.toLocaleString()} of {total.toLocaleString()} files processed
            {job.leads_parsed > 0 ? ` · ${job.leads_parsed.toLocaleString()} leads found so far` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums tracking-tight text-ink">{percent}%</p>
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
      <p className="mt-1 text-xl font-bold tabular-nums text-ink">
        {value.toLocaleString()}{' '}
        <span className="text-xs font-medium text-muted">{suffix}</span>
      </p>
    </div>
  )
}

function CaughtUp({ latestJob }: { latestJob: DashboardJob | null }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)] sm:p-6">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-success-soft text-success">
            ✓
          </span>
          <h2 className="text-lg font-semibold text-ink">Your workspace is caught up</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          {latestJob
            ? `Latest run: ${latestJob.leads_kept.toLocaleString()} leads from ${latestJob.file_count.toLocaleString()} files.`
            : 'Start an extraction to build your first clean lead list.'}
        </p>
      </div>
      <Link
        href="/dashboard/extract/new"
        className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-semibold text-ink transition-[border-color,transform] duration-150 hover:border-border-strong active:scale-[0.97]"
      >
        Start another run
      </Link>
    </section>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-panel p-4 shadow-[var(--shadow-sm)]">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-ink">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
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
  selected,
  onSelect,
}: {
  job: DashboardJob
  selected: boolean
  onSelect: () => void
}) {
  const percent = runProgress(job)
  const purged = (job.progress_step ?? '').toLowerCase().includes('data purged')

  return (
    <li className={selected ? 'bg-accent-soft/60 px-5 py-4' : 'px-5 py-4'}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} />
            <span className="text-sm font-semibold text-ink">{jobLabel(job)}</span>
            <time dateTime={job.created_at} className="text-xs text-muted">
              {formatDate(job.created_at)}
            </time>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>{job.file_count.toLocaleString()} files</span>
            <span>
              {job.status === 'processing'
                ? `${job.leads_parsed.toLocaleString()} leads found`
                : `${job.leads_kept.toLocaleString()} leads kept`}
            </span>
            <span>{job.duplicates_removed.toLocaleString()} duplicates removed</span>
            {isActiveJob(job) ? <span className="font-medium text-accent">{percent}% complete</span> : null}
          </div>
          {job.error_message ? <p className="mt-2 text-sm text-danger">{job.error_message}</p> : null}
        </button>

        {!isActiveJob(job) ? (
          <JobActions
            jobId={job.id}
            hasExport={Boolean(job.export_storage_path)}
            leadsRemaining={purged ? 0 : job.leads_kept}
          />
        ) : null}
      </div>
    </li>
  )
}

function FilePipeline({ job, files }: { job: DashboardJob | null; files: DashboardFile[] }) {
  const processed = files.filter((file) => file.status === 'processed').length
  const failed = files.filter((file) => file.status === 'failed').length

  return (
    <section className="min-w-0 self-start rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-sm)] xl:sticky xl:top-6">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-ink">File pipeline</h2>
        <p className="mt-0.5 text-sm text-muted">
          {job ? jobLabel(job) : 'Select a run'}
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
      <p className={`text-lg font-bold tabular-nums ${danger ? 'text-danger' : 'text-ink'}`}>
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

function LeadPreview({
  leads,
  totalVisible,
  search,
  onSearch,
  filesById,
}: {
  leads: DashboardLead[]
  totalVisible: number
  search: string
  onSearch: (value: string) => void
  filesById: Map<string, string>
}) {
  return (
    <section className="rounded-[var(--radius-xl)] border border-border bg-panel shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Latest extracted leads</h2>
          <p className="mt-0.5 text-sm text-muted">
            Showing the newest {totalVisible.toLocaleString()} retained lead rows.
          </p>
        </div>
        <label className="w-full sm:w-72">
          <span className="sr-only">Search latest leads</span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search name, title, company…"
            className="w-full rounded-[var(--radius-md)] border border-border bg-paper px-3 py-2 text-sm text-ink transition-colors duration-150 placeholder:text-muted hover:border-border-strong"
          />
        </label>
      </div>

      {leads.length > 0 ? (
        <div className="overflow-x-auto" data-lenis-prevent-horizontal>
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-paper text-xs font-semibold uppercase tracking-[0.1em] text-muted">
                <th className="px-5 py-3">Lead</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-5 py-3 text-right">Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((lead) => (
                <tr key={lead.id} className="transition-colors duration-150 hover:bg-accent-soft/45">
                  <td className="px-5 py-3 font-medium text-ink">{missing(lead.full_name)}</td>
                  <td className="max-w-56 truncate px-4 py-3 text-muted" title={lead.job_title ?? undefined}>
                    {missing(lead.job_title)}
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 text-ink" title={lead.company_name ?? undefined}>
                    {missing(lead.company_name)}
                  </td>
                  <td className="max-w-44 truncate px-4 py-3 text-muted" title={lead.location ?? undefined}>
                    {missing(lead.location)}
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 text-xs text-muted" title={lead.uploaded_file_id ? filesById.get(lead.uploaded_file_id) : undefined}>
                    {lead.uploaded_file_id ? filesById.get(lead.uploaded_file_id) ?? 'Saved page' : 'Saved page'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {safeProfileUrl(lead.linkedin_url) ? (
                      <a
                        href={safeProfileUrl(lead.linkedin_url) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-muted">Not available</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-12 text-center">
          <h3 className="text-sm font-semibold text-ink">
            {search ? 'No leads match your search' : 'No retained leads yet'}
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted">
            {search
              ? 'Try a different name, title, company, or location.'
              : 'Lead rows appear here after an extraction finishes. Downloaded CSV files remain available even after you clear lead data.'}
          </p>
        </div>
      )}
    </section>
  )
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
