'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import {
  loadMyNotifications,
  markMyNotificationsRead,
  type BellState,
} from '@/lib/crm/notification-actions'
import { LocalTime } from '@/components/ui/LocalTime'

const POLL_MS = 60_000

/**
 * Task reminders and mentions. Polls once a minute while the tab is visible —
 * reminders are claimed on a 5-minute tick, so faster polling buys nothing.
 */
export function NotificationBell() {
  const [state, setState] = useState<BellState>({ unread: 0, items: [] })
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    // A failed poll keeps the last state; the next one retries.
    const load = () =>
      loadMyNotifications()
        .then((next) => {
          if (alive) setState(next)
        })
        .catch(() => undefined)

    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && state.unread > 0) {
      setState((s) => ({ unread: 0, items: s.items.map((i) => ({ ...i, read: true })) }))
      await markMyNotificationsRead().catch(() => undefined)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-label={state.unread > 0 ? `Notifications, ${state.unread} unread` : 'Notifications'}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {state.unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {state.unread > 9 ? '9+' : state.unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-panel shadow-[var(--shadow-md)]">
          <p className="border-b border-border px-4 py-2.5 text-sm font-semibold text-ink">Notifications</p>
          {state.items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {state.items.map((item) => {
                const body = (
                  <>
                    <span className={`block text-sm ${item.read ? 'text-muted' : 'font-medium text-ink'}`}>{item.title}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      <LocalTime iso={item.createdAt} />
                    </span>
                  </>
                )
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link href={item.href} onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-surface-muted">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-2.5">{body}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
