'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Contact search box.
 *
 * ⚠️ DEBOUNCED (A6). A request per keystroke turns a five-letter name into
 * five queries, four of which are already stale by the time they return. 300ms
 * is long enough to swallow typing and short enough not to feel laggy.
 *
 * The value lives in the URL, not in component state alone, so a search is
 * shareable, survives a refresh, and works with the back button.
 */
export function ContactSearch({ initialValue }: { initialValue: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(initialValue)
  const first = useRef(true)

  useEffect(() => {
    // Skip the mount pass, or landing on /crm/contacts?q=sam would immediately
    // re-navigate to the identical URL.
    if (first.current) {
      first.current = false
      return
    }

    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (value.trim()) next.set('q', value.trim())
      else next.delete('q')
      // A new search always starts at page one; keeping the old offset shows
      // an empty page and looks like no results.
      next.delete('page')

      router.replace(`/crm/contacts${next.size ? `?${next}` : ''}`)
    }, 300)

    return () => clearTimeout(timer)
  }, [value, params, router])

  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">Search contacts</span>
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search by name or email"
        className="field w-full px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
      />
    </label>
  )
}
