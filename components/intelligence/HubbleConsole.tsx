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
import type { ModelOption } from '@/components/intelligence/ModelPicker'
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

const LEAD_SELECT =
  'id, full_name, job_title, company_name, company_website_url, location, extraction_job_id, created_at, enrichment' as const

type LeadRow = {
  id: string
  full_name: string | null
  job_title: string | null
  company_name: string | null
  company_website_url: string | null
  location: string | null
  enrichment: unknown
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
  models,
  batches,
}: {
  userId: string
  models: ModelOption[]
  batches: LeadBatch[]
}) {
  const supabase = useMemo(() => createClient(), [])

  const [question, setQuestion] = useState('')
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const [busy] = useState(false)

  const [batchId, setBatchId] = useState<string | null>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)

  const [leads, setLeads] = useState<HubbleLead[]>([])
  const [loading, setLoading] = useState(true)
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
  const loadLeads = useCallback(async (requestId: number) => {
    await Promise.resolve()
    if (requestId !== latestRequest.current) return

    setLoading(true)
    try {
      let query = supabase
        .from('extracted_leads')
        .select(LEAD_SELECT)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(LIST_SIZE)

      if (batchId) {
        query = query.eq('extraction_job_id', batchId)
      } else if (from && to) {
        /*
         * With no list chosen, the calendar still scopes the leads shown, so
         * the list under the filter always matches what the filter says.
         */
        const bounds = dateRangeBounds(from, to)
        if (bounds) {
          query = query
            .gte('created_at', bounds.fromInclusive)
            .lt('created_at', bounds.toExclusive)
        }
      }

      const { data } = await query
      if (requestId !== latestRequest.current) return

      setLeads(((data ?? []) as LeadRow[]).map(toHubbleLead))
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [supabase, userId, batchId, from, to])

  useEffect(() => {
    void loadLeads((latestRequest.current += 1))
  }, [loadLeads])

  const emptyHint = batchId
    ? 'That list has no leads. Pick another from the dropdown above.'
    : from && to
      ? 'No leads were extracted in that date range. Widen the calendar to see more.'
      : 'Run an extraction and your leads will appear here, ready to research.'

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.035em] text-ink">
          Hubble
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Outlio&apos;s intelligence layer for micro and macro lead-data analytics.
        </p>
      </header>

      <HubblePromptBar
        value={question}
        onChange={setQuestion}
        onSubmit={() => {
          /* Wired to the run pipeline in the next phase. */
        }}
        busy={busy}
        models={models}
        modelId={modelId}
        onModelChange={setModelId}
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

      <HubbleLeadList
        leads={leads}
        loading={loading}
        emptyHint={emptyHint}
        onOpenLead={() => {
          /* The per-lead modal lands in the next phase. */
        }}
      />
    </div>
  )
}
