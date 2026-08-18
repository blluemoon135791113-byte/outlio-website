'use client'

/**
 * Hubble — the intelligence surface.
 *
 * Phases 1–3: the shell, the prompt bar, the calendar→list filter chain, and
 * the lead list. The generative side panel and the per-lead modal land next;
 * `onOpenLead` is wired to a placeholder until then rather than to a dead click.
 *
 * ⚠️ THIS SCREEN DOES NOT TOUCH THE EXTRACTION WORKSPACE. `/dashboard/jobs`
 * keeps its flat panels and its own data path — CLAUDE.md: the extraction board
 * is where raw data becomes export-ready, and it must not inherit churn here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BatchFilter } from '@/components/intelligence/BatchFilter'
import { HubbleLeadList, type HubbleLead } from '@/components/intelligence/HubbleLeadList'
import { HubblePromptBar } from '@/components/intelligence/HubblePromptBar'
import { HubbleResultPanel } from '@/components/intelligence/HubbleResultPanel'
import { LeadModal } from '@/components/intelligence/LeadModal'
import { columnLabel } from '@/components/intelligence/render-value'
import { useResearchRun, type ResearchScope } from '@/components/intelligence/useResearchRun'
import type { LeadBatch } from '@/lib/intelligence/batches'
import { dateRangeBounds } from '@/lib/intelligence/date-range'
import { createClient } from '@/lib/supabase/client'

/** One list is 25 leads. */
const LIST_SIZE = 25

const SUGGESTIONS = [
  'Companies raising their Series A right now',
  'Which of these use HubSpot?',
  'Head-count of each company',
  'Find SaaS leads hiring SDRs',
]

/**
 * ⚠️ TWO SELECTS, BECAUSE `enrichment` MAY NOT EXIST YET.
 *
 * Migration 0051 adds the column. Until it is applied, asking for it makes
 * PostgREST reject the WHOLE query — and the first version of this screen
 * swallowed that and rendered an empty list, so an account with 2,263 leads
 * looked like an account with none. That is the fifth time this project has hit
 * "failure looks like empty"; the fallback and the visible error are both here
 * so it cannot be the sixth.
 */
const LEAD_SELECT_BASE =
  'id, full_name, job_title, company_name, company_website_url, linkedin_url, location, extraction_job_id, created_at' as const

const LEAD_SELECT_ENRICHED = `${LEAD_SELECT_BASE}, enrichment` as const

type LeadRow = {
  id: string
  full_name: string | null
  job_title: string | null
  company_name: string | null
  company_website_url: string | null
  linkedin_url: string | null
  location: string | null
  enrichment?: unknown
}

/**
 * Reads a researched value that the user merged onto this lead.
 *
 * Enrichment is the only place a company's own description or HQ can come from
 * — a saved results page carries neither.
 */
function merged(enrichment: unknown, field: string): string | null {
  if (!enrichment || typeof enrichment !== 'object') return null

  const entry = (enrichment as Record<string, unknown>)[field]
  if (!entry || typeof entry !== 'object') return null

  const value = (entry as { value?: unknown }).value
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object') return null

  for (const key of ['description', 'headquarters', 'value', 'industry']) {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  return null
}

function toHubbleLead(row: LeadRow): HubbleLead {
  const hq = merged(row.enrichment, 'headquarters')

  return {
    id: row.id,
    fullName: row.full_name,
    jobTitle: row.job_title,
    companyName: row.company_name,
    companyDomain: row.company_website_url,
    // The company's HQ when we have it; otherwise the person's own location,
    // clearly labelled as such by the list.
    companyLocation: hq ?? row.location,
    locationIsPersonal: !hq && Boolean(row.location),
    description:
      merged(row.enrichment, 'company_description') ?? merged(row.enrichment, 'industry'),
  }
}

export function HubbleConsole({
  userId,
  modelName,
  batches,
}: {
  userId: string
  /** "Hubble Nova". One name over every configured engine. */
  modelName: string
  batches: LeadBatch[]
}) {
  const supabase = useMemo(() => createClient(), [])

  const [question, setQuestion] = useState('')
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)

  const run = useResearchRun()
  const busy = run.busy

  const [batchId, setBatchId] = useState<string | null>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)

  const [leads, setLeads] = useState<HubbleLead[]>([])
  /** LinkedIn URLs, kept beside the list so the modal need not refetch. */
  const [linkedinById, setLinkedinById] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latestRequest = useRef(0)

  /**
   * Loads the visible leads.
   *
   * ⚠️ STALE RESPONSES ARE DISCARDED. Switching lists quickly fires several
   * queries, and they do not come back in order — without the guard a slow
   * response for the list the user left could land last and overwrite the one
   * they are looking at.
   *
   * The first `await` also keeps the effect free of a synchronous setState,
   * which is what the cascading-render rule is about.
   */
  const loadLeads = useCallback(
    async (requestId: number) => {
      await Promise.resolve()
      if (requestId !== latestRequest.current) return

      setLoading(true)
      setLoadError(null)

      const build = (columns: string) => {
        let query = supabase
          .from('extracted_leads')
          .select(columns)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(LIST_SIZE)

        if (batchId) {
          query = query.eq('extraction_job_id', batchId)
        } else if (from && to) {
          // With no list chosen the calendar still scopes the leads shown, so
          // the list always matches what the filter above it claims.
          const bounds = dateRangeBounds(from, to)
          if (bounds) {
            query = query
              .gte('created_at', bounds.fromInclusive)
              .lt('created_at', bounds.toExclusive)
          }
        }

        return query
      }

      try {
        let result = await build(LEAD_SELECT_ENRICHED)

        // 42703 / PGRST204: the column is not there yet. Read what does exist
        // rather than showing nothing.
        if (result.error) {
          result = await build(LEAD_SELECT_BASE)
        }

        if (requestId !== latestRequest.current) return

        if (result.error) {
          // Named, not swallowed. An empty table with no explanation is the
          // failure mode this whole comment block exists to prevent.
          setLoadError('Your leads could not be loaded. Refresh, or try again shortly.')
          setLeads([])
          return
        }

        const rows = (result.data ?? []) as unknown as LeadRow[]
        setLeads(rows.map(toHubbleLead))
        setLinkedinById(Object.fromEntries(rows.map((row) => [row.id, row.linkedin_url])))
      } catch {
        if (requestId !== latestRequest.current) return
        setLoadError('Your leads could not be loaded. Refresh, or try again shortly.')
      } finally {
        if (requestId === latestRequest.current) setLoading(false)
      }
    },
    [supabase, userId, batchId, from, to],
  )

  useEffect(() => {
    void loadLeads((latestRequest.current += 1))
  }, [loadLeads])

  /*
   * Reload once a merge lands, so the columns the user just paid for actually
   * appear. Without this the list still reads "Not researched yet" beside a
   * panel that says the leads were enriched — two truths on one screen.
   */
  const mergedOnce = useRef(false)
  useEffect(() => {
    if (run.merge.state !== 'done') {
      if (run.merge.state === 'idle') mergedOnce.current = false
      return
    }
    if (mergedOnce.current) return
    mergedOnce.current = true
    void loadLeads((latestRequest.current += 1))
  }, [run.merge.state, loadLeads])

  /**
   * What a question applies to.
   *
   * ⚠️ MIRRORS THE FILTER EXACTLY. If the screen is showing one list, the run
   * covers that list; if a date range is set, it covers that range. A prompt
   * that silently researched every lead while the filter said otherwise would
   * be an unbounded spend the user never approved.
   */
  const scope = (): ResearchScope => {
    if (batchId) return { type: 'extraction_job', extractionJobId: batchId }
    if (from && to) return { type: 'date_range', from, to }
    return { type: 'all_leads' }
  }

  const openLead = leads.find((lead) => lead.id === openLeadId) ?? null

  const emptyHint = batchId
    ? 'That list has no leads. Pick another from the dropdown above.'
    : from && to
      ? 'No leads were extracted in that date range. Widen the calendar to see more.'
      : 'Run an extraction and your leads will appear here, ready to research.'

  return (
    /*
     * The cream page from the mockup. Applied with a negative bleed so it
     * reaches the edges of the shell's content area, and scoped here so the
     * extraction workspace keeps its own surface.
     */
    <div className="-mx-4 -my-6 min-h-[calc(100dvh-4rem)] space-y-6 bg-clay-bg px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <header>
        <h1 className="text-[38px] font-semibold leading-[1.1] tracking-[-0.04em] text-ink">
          Hubble
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Outlio&apos;s intelligence layer for micro and macro lead-data analytics.
        </p>
      </header>

      <HubblePromptBar
        value={question}
        onChange={setQuestion}
        onSubmit={() => void run.ask(question, scope(), null)}
        busy={busy}
        modelName={modelName}
        suggestions={SUGGESTIONS}
      />

      <BatchFilter
        batches={batches}
        selectedBatchId={batchId}
        onSelectBatch={setBatchId}
        from={from}
        to={to}
        onRangeChange={(nextFrom, nextTo) => {
          setFrom(nextFrom)
          setTo(nextTo)
        }}
        disabled={busy}
      />

      {/*
        The list contracts rather than being covered when the panel opens, so a
        finding and the leads it is about stay on screen together.
      */}
      <div
        className={
          run.phase === 'idle'
            ? ''
            : 'grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(22rem,1fr)]'
        }
      >
        <div className="space-y-3">
          {loadError ? (
            <p
              role="alert"
              className="rounded-[var(--radius-clay)] bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {loadError}
            </p>
          ) : null}

          <HubbleLeadList
            leads={leads}
            loading={loading}
            emptyHint={emptyHint}
            onOpenLead={(lead) => setOpenLeadId(lead.id)}
          />
        </div>

        {run.phase !== 'idle' ? (
          <HubbleResultPanel
            phase={run.phase}
            message={run.message}
            results={run.results}
            merge={run.merge}
            onEnrich={() => void run.enrich()}
            onClarify={(answers) => void run.clarify(answers)}
            onClose={run.reset}
            columnLabel={columnLabel}
          />
        ) : null}
      </div>

      {openLead ? (
        <LeadModal
          lead={openLead}
          linkedinUrl={linkedinById[openLead.id] ?? null}
          modelName={modelName}
          onClose={() => setOpenLeadId(null)}
        />
      ) : null}
    </div>
  )
}
