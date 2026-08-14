'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Phase = 'idle' | 'loading' | 'finishing'

/** Slim, non-blocking feedback for dashboard route changes. */
export function NavigationProgress() {
  const pathname = usePathname()
  const [phase, setPhase] = useState<Phase>('idle')
  const previousPath = useRef(pathname)

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin) return
      if (destination.pathname === window.location.pathname) return

      setPhase('loading')
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    if (pathname === previousPath.current) return
    previousPath.current = pathname
    setPhase('finishing')
    const timer = window.setTimeout(() => setPhase('idle'), 180)
    return () => window.clearTimeout(timer)
  }, [pathname])

  return (
    <div
      aria-hidden
      data-phase={phase}
      className="route-progress fixed inset-x-0 top-0 z-[100] h-0.5 origin-left bg-accent"
    />
  )
}
