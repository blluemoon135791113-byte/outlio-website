'use client'

/**
 * One research run's lifecycle: ask → poll → results → merge.
 *
 * Shared by the macro console and the single-lead modal, because they differ
 * only in SCOPE. A per-lead question is `{ type: 'lead_ids', leadIds: [id] }`
 * and a list question is `{ type: 'extraction_job', … }`; everything after that
 * — planning, polling, clarification, merging — is identical, and two copies of
 * it would drift.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** Mirrors `UnknownReason` in `lib/intelligence/results.ts`. */
export type RunUnknownReason =
  | 'not_found'
  | 'provider_unavailable'
  | 'no_provider'
  | 'no_company'

export type RunCell =
  | { state: 'known'; value: unknown; sourceUrl: string | null; sourceProvider: string }
  | { state: 'unknown'; reason?: RunUnknownReason }

export type RunRow = {
  leadId: string
  personName: string | null
  jobTitle: string | null
  companyName: string | null
  companyDomain: string | null
  fields: Record<string, RunCell>
  qualification: {
    score: number
    qualified: boolean
    disqualifiedBy: string | null
    unknownCount: number
    reasons: string[]
  } | null
}

export type RunResults = {
  runId: string
  status: string
  queryText: string
  columns: string[]
  rows: RunRow[]
  truncated: boolean
  metadata: {
    leadsEvaluated: number
    companiesResearched: number
    qualified: number | null
    cachedResultsUsed: number
    externalCalls: number
    durationMs: number | null
    fieldCoverage?: Record<
      string,
      {
        known: number
        notFound: number
        providerUnavailable: number
        noProvider: number
        noCompany: number
      }
    >
  }
  clarification: { questions: Array<{ id: string; question: string; options: string[] }> } | null
  error: string | null
}

export type ResearchScope =
  | { type: 'all_leads' }
  | { type: 'lead_ids'; leadIds: string[] }
  | { type: 'extraction_job'; extractionJobId: string }
  | { type: 'date_range'; from: string; to: string }

/**
 * ⚠️ `clarifying` IS ITS OWN PHASE, NOT `idle`.
 *
 * It used to fall back to `idle`, and the console only opens the result panel
 * when the phase is not idle — so a question the planner wanted one detail
 * about produced NOTHING on screen. The bar stopped animating and that was the
 * entire response. "The intelligence is not even working" was this.
 */
export type RunPhase = 'idle' | 'planning' | 'clarifying' | 'running' | 'done' | 'error'

const POLL_MS = 2_500

export function useResearchRun() {
  const [phase, setPhase] = useState<RunPhase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [results, setResults] = useState<RunResults | null>(null)
  const [merge, setMerge] = useState<{ state: 'idle' | 'busy' | 'done'; summary: string | null }>({
    state: 'idle',
    summary: null,
  })

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A poll that outlives its component keeps hitting the API from a closed
  // modal, and sets state on something that is gone.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [])

  const poll = useCallback((runId: string) => {
    const tick = async () => {
      try {
        const response = await fetch(`/api/intelligence/runs/${runId}`, { cache: 'no-store' })
        if (!response.ok) {
          setPhase('error')
          setMessage('That research run could not be loaded.')
          return
        }

        const data = (await response.json()) as RunResults
        setResults(data)

        if (data.status === 'completed' || data.status === 'partially_complete') {
          setPhase('done')
          return
        }
        if (data.status === 'failed' || data.status === 'cancelled') {
          setPhase('error')
          setMessage(data.error ?? 'The research run did not finish.')
          return
        }

        pollRef.current = setTimeout(tick, POLL_MS)
      } catch {
        setPhase('error')
        setMessage('Lost connection while research was running.')
      }
    }

    pollRef.current = setTimeout(tick, 1_200)
  }, [])

  const ask = useCallback(
    async (question: string, scope: ResearchScope, model: string | null) => {
      if (question.trim().length < 3) return

      if (pollRef.current) clearTimeout(pollRef.current)
      setPhase('planning')
      setMessage(null)
      setResults(null)
      setMerge({ state: 'idle', summary: null })

      try {
        const response = await fetch('/api/intelligence/query', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query: question.trim(),
            scope,
            ...(model ? { model } : {}),
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          setPhase('error')
          setMessage(data?.error?.message ?? data?.reason ?? 'That question could not be researched.')
          return
        }

        // A refusal is a deliberate answer, not a failure — spec §44 blocks
        // qualification on protected characteristics before the model is asked.
        if (data.status === 'refused') {
          setPhase('error')
          setMessage(data.reason)
          return
        }

        if (data.status === 'clarification_required') {
          setPhase('clarifying')
          setMessage('One detail first — nothing has been queued or charged yet.')
          setResults({
            runId: data.researchRunId,
            status: 'waiting_for_clarification',
            queryText: question,
            columns: [],
            rows: [],
            truncated: false,
            metadata: {
              leadsEvaluated: 0,
              companiesResearched: 0,
              qualified: null,
              cachedResultsUsed: 0,
              externalCalls: 0,
              durationMs: null,
            },
            clarification: { questions: data.questions ?? [] },
            error: null,
          })
          return
        }

        setPhase('running')
        poll(data.researchRunId)
      } catch {
        setPhase('error')
        setMessage('That question could not be sent.')
      }
    },
    [poll],
  )

  /**
   * Writes the run's answers onto the leads.
   *
   * Reports both halves. "38 leads updated · 12 values not found" is honest;
   * showing only the successes would leave a user believing every lead now
   * carries an email, and they would find out from their CRM.
   */
  const enrich = useCallback(async () => {
    if (!results) return

    setMerge({ state: 'busy', summary: null })
    try {
      const response = await fetch(`/api/intelligence/runs/${results.runId}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })

      const data = await response.json()

      if (!response.ok) {
        setMerge({ state: 'idle', summary: data?.error?.message ?? 'The merge did not complete.' })
        return
      }

      const updated = data.leadsUpdated ?? 0
      const unknown = data.unknownCells ?? 0

      setMerge({
        state: 'done',
        summary:
          `${updated.toLocaleString()} lead${updated === 1 ? '' : 's'} enriched` +
          (unknown > 0 ? ` · ${unknown.toLocaleString()} not found` : '') +
          '. Exports carry these columns now.',
      })
    } catch {
      setMerge({ state: 'idle', summary: 'The merge did not complete.' })
    }
  }, [results])

  /**
   * Answers the planner's questions and releases the run to the queue.
   *
   * Nothing has been queued or charged until this returns — the clarification
   * exists precisely so a vague question does not spend money guessing.
   */
  const clarify = useCallback(
    async (answers: Record<string, string>) => {
      if (!results) return

      setPhase('planning')
      setMessage(null)

      try {
        const response = await fetch('/api/intelligence/clarify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ researchRunId: results.runId, answers }),
        })

        const data = await response.json()

        if (!response.ok) {
          setPhase('error')
          setMessage(data?.error?.message ?? 'That answer could not be submitted.')
          return
        }

        setPhase('running')
        poll(results.runId)
      } catch {
        setPhase('error')
        setMessage('That answer could not be sent.')
      }
    },
    [results, poll],
  )

  const reset = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current)
    setPhase('idle')
    setMessage(null)
    setResults(null)
    setMerge({ state: 'idle', summary: null })
  }, [])

  return {
    phase,
    message,
    results,
    merge,
    ask,
    clarify,
    enrich,
    reset,
    busy: phase === 'planning' || phase === 'running',
  }
}
