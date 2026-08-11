'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import type { CaptureSessionRow } from '@/types/database'

/**
 * Live capture status on the dashboard.
 *
 * Subscribes to the user's own capture rows and re-reads only this widget when
 * one changes — the page is never refreshed. Someone captures 20 pages in a
 * sitting, and remounting the lead table on each one would be both jarring and
 * wasteful.
 *
 * Reuses the same Realtime pattern as ExtractionDashboard, including the
 * debounce: a single page produces several row writes in quick succession
 * (page claimed, job created, totals rolled) and each should not be its own
 * fetch.
 *
 * Renders nothing when no session is active, so it stays out of the way for
 * users who do not use the extension.
 */
export function LiveCapture({
  userId,
  initialSession,
}: {
  userId: string
  initialSession: CaptureSessionRow | null
}) {
  const supabase = createClient()
  const [session, setSession] = useState<CaptureSessionRow | null>(initialSession)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('capture_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle()

    setSession((data as CaptureSessionRow | null) ?? null)
  }, [supabase, userId])

  useEffect(() => {
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void refresh(), 200)
    }

    const channel = supabase
      .channel(`capture-live:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'capture_sessions',
          filter: `user_id=eq.${userId}`,
        },
        schedule,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'capture_pages',
          filter: `user_id=eq.${userId}`,
        },
        schedule,
      )
      .subscribe()

    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [refresh, supabase, userId])

  if (!session) return null

  const stats: Array<[string, number]> = [
    ['Pages processed', session.pages_processed],
    ['Leads found', session.leads_found],
    ['Imported', session.leads_imported],
    ['Duplicates', session.duplicates_skipped],
  ]

  return (
    <section className="rounded-[var(--radius-xl)] border border-accent/25 bg-accent-soft/40 p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2">
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Live capture
        </p>
      </div>

      <p className="mt-2 text-sm text-ink">
        Capture active. Keep browsing — each page you open is processed automatically.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-md)] bg-panel/70 px-3 py-2">
            <dt className="text-[11px] text-muted">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
