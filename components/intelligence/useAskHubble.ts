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
  usage: {
    searches: number
    pagesFetched: number
    cacheHits: number
    llmCalls: number
    elapsedMs: number
  } | null
}

export function useAskHubble() {
  const [answers, setAnswers] = useState<AskAnswer[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      const payload = (await response.json()) as Omit<AskAnswer, 'question'>
      if (!alive.current) return

      setAnswers((current) => [...current, { ...payload, question: asked }])
    } catch {
      if (alive.current) setError('Could not reach Hubble. Check your connection.')
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  return { answers, busy, error, ask }
}

/**
 * How a status should read to a salesperson about to act on it.
 *
 * ⚠️ `estimated` MUST LOOK DIFFERENT FROM `verified`. Someone is about to put
 * this in an email. A guess presented like a fact is the failure this whole
 * layer exists to prevent (CLAUDE.md rule 4).
 */
export const STATUS_LABEL: Record<AnswerStatus, string> = {
  verified: 'Verified',
  corroborated: 'Corroborated',
  estimated: 'Estimated',
  unknown: 'Not found',
}

export const STATUS_HINT: Record<AnswerStatus, string> = {
  verified: 'A source states this directly.',
  corroborated: 'Two independent sources agree.',
  estimated: 'Inferred, not stated. Treat as a working assumption.',
  unknown: 'Research ran and could not confirm this.',
}

/** Token classes only — no hardcoded colours anywhere in the product. */
export const STATUS_CLASS: Record<AnswerStatus, string> = {
  verified: 'bg-success-soft text-success',
  corroborated: 'bg-success-soft text-success',
  estimated: 'bg-warning-soft text-warning',
  unknown: 'bg-surface-muted text-muted',
}
