'use client'

/**
 * Ask Hubble about one lead.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DELIBERATELY NOT `useResearchRun`.                                      ║
 * ║                                                                          ║
 * ║  That hook drives the BATCH pipeline: plan → queue → poll a run id,      ║
 * ║  because researching hundreds of companies takes minutes and must        ║
 * ║  survive the tab closing. One question about one lead is bounded at 90   ║
 * ║  seconds by the server's research budget, so it is a single request and  ║
 * ║  a spinner. Polling infrastructure for a 20-second answer would be       ║
 * ║  machinery with nothing to do.                                           ║
 * ║                                                                          ║
 * ║  Both still exist. The console does macro; this does micro.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type AnswerStatus = 'verified' | 'corroborated' | 'estimated' | 'unknown'

export type AskSource = {
  url: string
  title: string | null
  quote: string | null
}

export type AskAnswer = {
  question: string
  answer: string
  status: AnswerStatus
  confidence: number
  sources: AskSource[]
  /** True when served from a previous answer rather than fresh research. */
  fromCache: boolean
  synthesis:
    | 'completed'
    | 'no_evidence'
    | 'not_configured'
    | 'budget_exhausted'
    | 'provider_unavailable'
    | 'invalid_output'
  usage: {
    searches: number
    pagesFetched: number
    cacheHits: number
    llmCalls: number
    elapsedMs: number
  } | null
}

/** What Hubble is doing right now, in words a salesperson can read. */
export type Phase = { label: string; detail: string | null }

/**
 * ⚠️ DERIVED FROM REAL SERVER EVENTS, never a timer.
 *
 * A fake sequence would eventually claim "reading 4 pages" during a question
 * where nothing was fetched — which is worse than no progress at all, because
 * the user cannot tell a slow question from a lying one.
 */
function toPhase(event: Record<string, unknown>): Phase | null {
  switch (event.phase) {
    case 'cache':
      return { label: 'Checking what I already know', detail: null }
    case 'planning':
      return { label: 'Working out what to research', detail: null }
    case 'searching':
      return {
        label: `Searching the web (${event.index as number}/${event.total as number})`,
        detail: typeof event.query === 'string' ? event.query : null,
      }
    case 'reading': {
      const count = event.count as number
      return { label: `Reading ${count} page${count === 1 ? '' : 's'}`, detail: null }
    }
    case 'thinking': {
      const passages = event.passages as number
      return {
        label: 'Writing the answer',
        detail: passages > 0 ? `from ${passages} relevant passage${passages === 1 ? '' : 's'}` : null,
      }
    }
    default:
      return null
  }
}

export function useAskHubble() {
  const [answers, setAnswers] = useState<AskAnswer[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase | null>(null)

  /*
   * A request that outlives its modal would set state on a component that is
   * gone. The flag is checked after every await.
   */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const ask = useCallback(async (leadId: string, question: string) => {
    const asked = question.trim()
    if (asked.length < 3) return

    setBusy(true)
    setError(null)
    setPhase({ label: 'Starting', detail: null })

    try {
      const response = await fetch('/api/hubble/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId, question: asked }),
      })

      if (!alive.current) return

      if (!response.ok) {
        /*
         * Friendly copy, never the server's detail. A 429 is the one worth
         * naming precisely, because the user can act on it by waiting.
         */
        setError(
          response.status === 429
            ? 'Too many questions in a row. Give it a moment and try again.'
            : response.status === 404
              ? 'That lead could not be found.'
              : 'Hubble could not complete the research. Try again.',
        )
        return
      }

      /*
       * NDJSON: one object per line, progress events then the answer. Read
       * incrementally so a phase appears the moment the server reaches it.
       */
      const reader = response.body?.getReader()
      if (!reader) {
        setError('Hubble returned no response.')
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!alive.current) {
          // Stop reading, but do NOT abort the request: the server finishes
          // the research and caches it, so nothing is wasted.
          void reader.cancel()
          return
        }

        buffer += decoder.decode(value, { stream: true })

        // The last element is a partial line until the next chunk arrives.
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(line) as Record<string, unknown>
          } catch {
            continue
          }

          if (event.type === 'progress') {
            const next = toPhase(event)
            if (next) setPhase(next)
          } else if (event.type === 'answer') {
            const { type: _type, ...payload } = event
            setAnswers((current) => [
              ...current,
              { ...(payload as Omit<AskAnswer, 'question'>), question: asked },
            ])
          } else if (event.type === 'error') {
            setError('Hubble could not complete the research. Try again.')
          }
        }
      }
    } catch {
      if (alive.current) setError('Could not reach Hubble. Check your connection.')
    } finally {
      if (alive.current) {
        setBusy(false)
        setPhase(null)
      }
    }
  }, [])

  return { answers, busy, error, phase, ask }
}
