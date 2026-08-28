'use client'

/**
 * Hubble — the intelligence surface.
 *
 * Phases 1–3: the shell, the prompt bar, the calendar→list filter chain, and
 * the lead list. The generative side panel and the per-lead modal land next;
 * `onOpenLead` is wired to a placeholder until then rather than to a dead click.
 *
 * ⚠️ THIS SCREEN DOES NOT TOUCH THE EXTRACTION WORKSPACE'S DATA PATH.
 * `/dashboard/jobs` remains the place where raw data becomes export-ready,
 * while both screens now share the product's Hubble material language.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BatchFilter } from '@/components/intelligence/BatchFilter'
import {
  HubbleLeadList,
  type HubbleLead,
  type HubbleSavedDetail,
} from '@/components/intelligence/HubbleLeadList'
import { HubblePromptBar } from '@/components/intelligence/HubblePromptBar'
import { HubbleResultPanel } from '@/components/intelligence/HubbleResultPanel'
import { LeadModal } from '@/components/intelligence/LeadModal'
import { columnLabel, renderCellValue } from '@/components/intelligence/render-value'
import { useResearchRun, type ResearchScope } from '@/components/intelligence/useResearchRun'
import type { LeadBatch } from '@/lib/intelligence/batches'
import { dateRangeBounds } from '@/lib/intelligence/date-range'
import { researchScopeForView } from '@/lib/intelligence/view-scope'
import { createClient } from '@/lib/supabase/client'

/** One list is 25 leads. */
const LIST_SIZE = 25
const LEAD_VIEW_CACHE_MS = 60_000
const MAX_CACHED_LEAD_VIEWS = 12
const CARD_EVIDENCE_LIMIT = 500

/**
 * The height both result columns share.
 *
 * Declared once and applied to the row, so the lead list and the generative
 * strip are the same height by construction rather than by two numbers someone
 * has to keep in step.
 */
const RESULT_PANE_HEIGHT = 'lg:h-[calc(100dvh-13rem)] lg:min-h-[32rem]'

/* Short enough that three fit one row unscrolled. The bar enforces a single
   line structurally, but copy that has to scroll is still copy nobody reads. */
const SUGGESTIONS = ['Recent Series A', 'Who uses HubSpot?', 'SaaS hiring SDRs']

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
  'id, full_name, job_title, company_name, company_id, company_website_url, linkedin_url, sales_navigator_url, company_url, person_blurb, tenure_in_role, tenure_in_company, location, extraction_job_id, created_at, work_email, email_status, mobile_phone, phone_status, companies(domain)' as const

const LEAD_SELECT_ENRICHED = `${LEAD_SELECT_BASE}, enrichment` as const

type LeadRow = {
  id: string
  full_name: string | null
  job_title: string | null
  company_name: string | null
  company_id: string | null
  company_website_url: string | null
  linkedin_url: string | null
  sales_navigator_url: string | null
  company_url: string | null
  person_blurb: string | null
  tenure_in_role: string | null
  tenure_in_company: string | null
  location: string | null
  work_email: string | null
  email_status: string | null
  mobile_phone: string | null
  phone_status: string | null
  companies?: { domain: string | null } | null
  enrichment?: unknown
}

type LeadResearchRow = {
  lead_id: string | null
  status: HubbleLead['researchStatus']
  sources: unknown
  question: string
  answer: string
  created_at: string
}

type LeadEvidenceRow = {
  id: string
  entity_type: 'person' | 'company'
  entity_id: string
  field: string
  value_json: unknown
  source_url: string | null
  source_confidence: 'high' | 'medium' | 'low'
  confidence: number
  retrieved_at: string
  expires_at: string | null
}

type CachedLeadView = {
  expiresAt: number
  leads: HubbleLead[]
  linkedinById: Record<string, string | null>
}

// Memory-only and keyed by user + filter. It survives client navigation but is
// discarded on reload, never crosses accounts, and cannot grow without bound.
const leadViewCache = new Map<string, CachedLeadView>()

function rememberLeadView(key: string, value: CachedLeadView) {
  leadViewCache.delete(key)
  leadViewCache.set(key, value)
  while (leadViewCache.size > MAX_CACHED_LEAD_VIEWS) {
    const oldest = leadViewCache.keys().next().value
    if (!oldest) break
    leadViewCache.delete(oldest)
  }
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

  for (const key of ['email', 'phone', 'status', 'description', 'headquarters', 'value', 'industry']) {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  return null
}

function evidenceValue(value: unknown): string | null {
  const rendered = renderCellValue(value).trim()
  return rendered && rendered !== '—' ? rendered : null
}

function socialValue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return evidenceValue(value)
  const platforms = Object.entries(value as Record<string, unknown>)
    .filter(([, url]) => typeof url === 'string' && /^https?:\/\//i.test(url))
    .map(([platform]) => columnLabel(platform))
  return platforms.length > 0 ? platforms.join(' · ') : evidenceValue(value)
}

function bestEvidence(rows: readonly LeadEvidenceRow[]): Map<string, LeadEvidenceRow> {
  const rank = { high: 3, medium: 2, low: 1 }
  const fresh = rows.filter((row) =>
    row.expires_at === null || Date.parse(row.expires_at) > Date.now(),
  )
  fresh.sort((left, right) =>
    rank[right.source_confidence] - rank[left.source_confidence] ||
    Number(right.confidence) - Number(left.confidence) ||
    Date.parse(right.retrieved_at) - Date.parse(left.retrieved_at),
  )

  const winners = new Map<string, LeadEvidenceRow>()
  for (const row of fresh) {
    const key = `${row.entity_type}:${row.entity_id}:${row.field}`
    if (!winners.has(key)) winners.set(key, row)
  }
  return winners
}

function evidenceFor(
  evidence: Map<string, LeadEvidenceRow>,
  entityType: 'person' | 'company',
  entityId: string | null,
  field: string,
): LeadEvidenceRow | null {
  if (!entityId) return null
  return evidence.get(`${entityType}:${entityId}:${field}`) ?? null
}

const CORE_CARD_FIELDS = new Set([
  'company_domain',
  'work_email',
  'email_status',
  'mobile_phone',
  'phone_status',
])

function savedDetailsFor(
  row: LeadRow,
  evidence: Map<string, LeadEvidenceRow>,
  history: readonly LeadResearchRow[],
): HubbleSavedDetail[] {
  const details: HubbleSavedDetail[] = []
  const entityKeys = new Set([
    `person:${row.id}`,
    ...(row.company_id ? [`company:${row.company_id}`] : []),
  ])

  for (const record of evidence.values()) {
    if (!entityKeys.has(`${record.entity_type}:${record.entity_id}`)) continue
    if (CORE_CARD_FIELDS.has(record.field)) continue
    const value = record.field.includes('social_profiles')
      ? socialValue(record.value_json)
      : evidenceValue(record.value_json)
    if (!value) continue
    details.push({
      id: `evidence:${record.id}`,
      kind: 'fact',
      field: record.field,
      label: columnLabel(record.field),
      value,
      sourceUrl: record.source_url,
      status: null,
    })
  }

  if (row.enrichment && typeof row.enrichment === 'object' && !Array.isArray(row.enrichment)) {
    for (const [field, raw] of Object.entries(row.enrichment as Record<string, unknown>)) {
      if (CORE_CARD_FIELDS.has(field) || details.some((detail) => detail.label === columnLabel(field))) continue
      const entry = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : null
      const value = evidenceValue(entry?.value ?? raw)
      if (!value) continue
      details.push({
        id: `merged:${field}`,
        kind: 'fact',
        field,
        label: columnLabel(field),
        value,
        sourceUrl: typeof entry?.source_url === 'string' ? entry.source_url : null,
        status: null,
      })
    }
  }

  for (const answer of history.slice(0, 5)) {
    const source = Array.isArray(answer.sources) && answer.sources[0] &&
      typeof answer.sources[0] === 'object'
      ? (answer.sources[0] as { url?: unknown }).url
      : null
    details.push({
      id: `answer:${answer.created_at}:${answer.question}`,
      kind: 'answer',
      // A free-text answer belongs to no single field.
      field: null,
      label: answer.question,
      value: answer.answer,
      sourceUrl: typeof source === 'string' ? source : null,
      status: answer.status,
    })
  }

  return details
}

function toHubbleLead(
  row: LeadRow,
  evidence: Map<string, LeadEvidenceRow>,
  history: readonly LeadResearchRow[] = [],
): HubbleLead {
  const research = history[0] ?? null
  const hq = merged(row.enrichment, 'headquarters')
  const emailEvidence = evidenceFor(evidence, 'person', row.id, 'work_email')
  const emailStatusEvidence = evidenceFor(evidence, 'person', row.id, 'email_status')
  const phoneEvidence = evidenceFor(evidence, 'person', row.id, 'mobile_phone')
  const phoneStatusEvidence = evidenceFor(evidence, 'person', row.id, 'phone_status')

  return {
    id: row.id,
    fullName: row.full_name,
    jobTitle: row.job_title,
    companyName: row.company_name,
    // `companies.domain` is Hubble's canonical company identity. Most imported
    // leads have no website column even after the company has been resolved.
    companyDomain: row.companies?.domain ?? row.company_website_url,
    // The company's HQ when we have it; otherwise the person's own location,
    // clearly labelled as such by the list.
    companyLocation: hq ?? row.location,
    locationIsPersonal: !hq && Boolean(row.location),
    description:
      merged(row.enrichment, 'company_description') ?? merged(row.enrichment, 'industry'),
    researchStatus: research?.status ?? null,
    researchSourceCount: Array.isArray(research?.sources) ? research.sources.length : 0,
    workEmail:
      evidenceValue(emailEvidence?.value_json) ?? merged(row.enrichment, 'work_email') ?? row.work_email,
    emailStatus:
      evidenceValue(emailStatusEvidence?.value_json) ?? merged(row.enrichment, 'email_status') ?? row.email_status,
    mobilePhone:
      evidenceValue(phoneEvidence?.value_json) ?? merged(row.enrichment, 'mobile_phone') ?? row.mobile_phone,
    phoneStatus:
      evidenceValue(phoneStatusEvidence?.value_json) ?? merged(row.enrichment, 'phone_status') ?? row.phone_status,
    /*
     * ⚠️ CAPTURED FIELDS THE MODAL COULD NEVER SHOW.
     *
     * `sales_navigator_url` is the one that hurt: the parser only fills
     * `linkedin_url` when the anchor is a public /in/ profile, so a lead
     * captured from Sales Navigator stored its URL here and the modal — which
     * read only `linkedin_url` — showed "LinkedIn not available" while the CSV
     * export happily carried it.
     */
    salesNavigatorUrl: row.sales_navigator_url,
    companyUrl: row.company_url,
    personBlurb: row.person_blurb,
    tenureInRole: row.tenure_in_role,
    tenureInCompany: row.tenure_in_company,
    savedDetails: savedDetailsFor(row, evidence, history),
  }
}

export function HubbleConsole({
  userId,
  batches,
  workspace,
}: {
  userId: string
  batches: LeadBatch[]
  /** What an unfiltered macro question covers. See the header copy below. */
  workspace: { leads: number; companies: number; unlinkedCompanies: number }
}) {
  const supabase = useMemo(() => createClient(), [])

  const [question, setQuestion] = useState('')
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)
  const [drillDown, setDrillDown] = useState<{ field: string; label: string } | null>(null)

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
  const viewCacheKey = useMemo(
    () => [userId, batchId ?? 'all', from ?? '', to ?? ''].join(':'),
    [userId, batchId, from, to],
  )

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
    async (requestId: number, force = false) => {
      await Promise.resolve()
      if (requestId !== latestRequest.current) return

      const cached = force ? null : leadViewCache.get(viewCacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        setLeads(cached.leads)
        setLinkedinById(cached.linkedinById)
        setLoadError(null)
        setLoading(false)
        return
      }
      if (cached) leadViewCache.delete(viewCacheKey)

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
        const historyByLead = new Map<string, LeadResearchRow[]>()
        let resolvedEvidence = new Map<string, LeadEvidenceRow>()

        if (rows.length > 0) {
          const leadIds = rows.map((row) => row.id)
          const companyIds = [...new Set(rows
            .map((row) => row.company_id)
            .filter((id): id is string => Boolean(id)))]
          const currentEvidenceFilter = `expires_at.is.null,expires_at.gt.${new Date().toISOString()}`
          const evidenceColumns =
            'id, entity_type, entity_id, field, value_json, source_url, source_confidence, confidence, retrieved_at, expires_at'

          const [history, personEvidence, companyEvidence] = await Promise.all([
            supabase
              .from('hubble_answers')
              .select('lead_id, status, sources, question, answer, created_at')
              .eq('user_id', userId)
              .in('lead_id', leadIds)
              .order('created_at', { ascending: false })
              .limit(125),
            supabase
              .from('research_evidence')
              .select(evidenceColumns)
              .eq('user_id', userId)
              .eq('entity_type', 'person')
              .in('entity_id', leadIds)
              // A card never needs expired history. Keeping the cap below one
              // page also prevents a heavily researched lead from turning a
              // compact list read into an unbounded evidence download.
              .or(currentEvidenceFilter)
              .order('retrieved_at', { ascending: false })
              .limit(CARD_EVIDENCE_LIMIT),
            companyIds.length > 0
              ? supabase
                  .from('research_evidence')
                  .select(evidenceColumns)
                  .eq('user_id', userId)
                  .eq('entity_type', 'company')
                  .in('entity_id', companyIds)
                  .or(currentEvidenceFilter)
                  .order('retrieved_at', { ascending: false })
                  .limit(CARD_EVIDENCE_LIMIT)
              : Promise.resolve({ data: [] }),
          ])

          for (const answer of (history.data ?? []) as unknown as LeadResearchRow[]) {
            if (!answer.lead_id) continue
            const bucket = historyByLead.get(answer.lead_id) ?? []
            bucket.push(answer)
            historyByLead.set(answer.lead_id, bucket)
          }

          resolvedEvidence = bestEvidence([
            ...((personEvidence.data ?? []) as unknown as LeadEvidenceRow[]),
            ...((companyEvidence.data ?? []) as unknown as LeadEvidenceRow[]),
          ])
        }

        if (requestId !== latestRequest.current) return
        const nextLeads = rows.map((row) =>
          toHubbleLead(row, resolvedEvidence, historyByLead.get(row.id) ?? []),
        )
        const nextLinkedinById = Object.fromEntries(
          rows.map((row) => [row.id, row.linkedin_url]),
        )
        setLeads(nextLeads)
        setLinkedinById(nextLinkedinById)
        rememberLeadView(viewCacheKey, {
          expiresAt: Date.now() + LEAD_VIEW_CACHE_MS,
          leads: nextLeads,
          linkedinById: nextLinkedinById,
        })
      } catch {
        if (requestId !== latestRequest.current) return
        setLoadError('Your leads could not be loaded. Refresh, or try again shortly.')
      } finally {
        if (requestId === latestRequest.current) setLoading(false)
      }
    },
    [supabase, userId, batchId, from, to, viewCacheKey],
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
    void loadLeads((latestRequest.current += 1), true)
  }, [run.merge.state, loadLeads])

  /**
   * What a question applies to.
   *
   * ⚠️ MIRRORS THE FILTER EXACTLY. If the screen is showing one list, the run
   * covers that list; if a date range is set, it covers that range. A prompt
   * that silently researched every lead while the filter said otherwise would
   * be an unbounded spend the user never approved.
   */
  const scope = (): ResearchScope | null =>
    researchScopeForView({
      batchId,
      from,
      to,
      visibleLeadIds: leads.map((lead) => lead.id),
    })

  const openLead = leads.find((lead) => lead.id === openLeadId) ?? null

  /*
   * ⚠️ FILTERS THE VIEW, NEVER THE DATA. Drill-down narrows what is listed; it
   * does not re-run research, re-query, or change what a subsequent export
   * contains. Matching is on the field KEY plus the rendered value, because two
   * fields can display the same words.
   */
  const visibleLeads = drillDown
    ? leads.filter((lead) =>
        lead.savedDetails.some(
          (detail) =>
            detail.field === drillDown.field &&
            detail.value.toLowerCase().includes(drillDown.label.toLowerCase()),
        ),
      )
    : leads

  /* A label, not a paragraph — but each cause keeps its own wording, because
     "empty list", "empty range" and "nothing extracted yet" are three
     different situations and collapsing them hides which one you are in. */
  const emptyHint = batchId
    ? 'This list is empty.'
    : from && to
      ? 'No leads in this date range.'
      : 'Run an extraction to see leads here.'

  return (
    /*
     * The neutral Hubble page. Applied with a negative bleed so it reaches the
     * edges of the shell's content area while retaining the shared product
     * material beneath it.
     */
    <div className="hubble-page -mx-4 -my-6 min-h-[calc(100dvh-4rem)] space-y-7 bg-clay-bg px-4 py-6 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <header>
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.04em] text-ink">
          Hubble
        </h1>
        {/*
          * ⚠️ THE TWO SCALES ARE NAMED SEPARATELY BECAUSE THEY ANSWER
          * DIFFERENT QUESTIONS, AND THIS PAGE IS ONLY ONE OF THEM.
          *
          * This prompt bar is MACRO: it aggregates across companies — the ones
          * behind lead extractions and the ones from saved account lists, one
          * set, because they are the same firms in the same table. MICRO is a
          * single person, and lives in the lead modal below, not here. Saying
          * "micro and macro" on the macro bar invited people to ask it about
          * one individual and get a distribution back.
          */}
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Analysis across every company you hold — from lead extractions and
          saved account lists alike. Open a lead below to ask about one person.
        </p>
        <p className="mt-1 text-[13px] text-muted">
          {workspace.companies.toLocaleString()} compan
          {workspace.companies === 1 ? 'y' : 'ies'} ·{' '}
          {workspace.leads.toLocaleString()} lead{workspace.leads === 1 ? '' : 's'}
          {workspace.unlinkedCompanies > 0
            ? ` · ${workspace.unlinkedCompanies.toLocaleString()} from account lists only`
            : ''}
        </p>
      </header>

      <HubblePromptBar
        value={question}
        onChange={setQuestion}
        onSubmit={() => {
          const selectedScope = scope()
          if (selectedScope) void run.ask(question, selectedScope, null)
        }}
        busy={busy}
        shimmer={run.phase === 'planning'}
        busyLabel={
          run.phase === 'planning' ? 'Planning…' : 'Searching sources…'
        }
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
      {/*
        ⚠️ ONE HEIGHT FOR BOTH COLUMNS.
        `RESULT_PANE_HEIGHT` is set here and handed to both children, so the
        list and the strip cannot disagree. Each previously carried its own
        max-height and `items-start`, so the list ended at its last row while
        the panel ran to the viewport — the dead gap underneath.
        Both fill the row and scroll internally.
      */}
      <div
        className={
          run.phase === 'idle'
            ? ''
            : `grid items-stretch gap-5 ${RESULT_PANE_HEIGHT} lg:grid-cols-[minmax(0,1.65fr)_minmax(22rem,1fr)]`
        }
      >
        <div className={run.phase === 'idle' ? 'space-y-3' : 'flex min-h-0 flex-col gap-3'}>
          {loadError ? (
            <p
              role="alert"
              className="rounded-[var(--radius-clay)] bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {loadError}
            </p>
          ) : null}

          {drillDown ? (
            <button
              type="button"
              onClick={() => setDrillDown(null)}
              className="skeuo-key skeuo-key-interactive flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-ink">
                {drillDown.label}
                <span className="text-muted"> · {visibleLeads.length} of {leads.length}</span>
              </span>
              <span aria-hidden className="shrink-0 text-muted">
                clear ✕
              </span>
            </button>
          ) : null}

          <HubbleLeadList
            leads={visibleLeads}
            loading={loading}
            emptyHint={emptyHint}
            onOpenLead={(lead) => setOpenLeadId(lead.id)}
            fill={run.phase !== 'idle'}
          />
        </div>

        {run.phase !== 'idle' ? (
          <HubbleResultPanel
            phase={run.phase}
            message={run.message}
            results={run.results}
            summary={run.summary}
            summaryPending={run.summaryPending}
            merge={run.merge}
            onEnrich={() => void run.enrich()}
            onClarify={(answers) => void run.clarify(answers)}
            onClose={run.reset}
            columnLabel={columnLabel}
            onDrillDown={setDrillDown}
          />
        ) : null}
      </div>

      {openLead ? (
        <LeadModal
          lead={openLead}
          linkedinUrl={linkedinById[openLead.id] ?? null}
          onResearchComplete={(answer) => {
            setLeads((current) =>
              current.map((lead) =>
                lead.id === openLead.id
                  ? {
                      ...lead,
                      researchStatus: answer.status,
                      researchSourceCount: answer.sources.length,
                    }
                  : lead,
              ),
            )
            // The run may also have learned a canonical company domain from a
            // verified redirect. Refresh the record so the open modal and row
            // show it immediately rather than on the next page load.
            void loadLeads((latestRequest.current += 1), true)
          }}
          onClose={() => setOpenLeadId(null)}
        />
      ) : null}
    </div>
  )
}
