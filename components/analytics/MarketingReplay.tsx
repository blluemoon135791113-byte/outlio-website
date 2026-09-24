'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { syncMarketingReplay } from '@/lib/analytics/client'

/**
 * Starts and stops sampled, fully masked session replay on the public
 * marketing pages. Renders nothing. Product routes are handled by ProductShell.
 */
export function MarketingReplay() {
  // Only the trigger: a soft navigation changes it. The decision itself reads
  // the browser URL (see syncMarketingReplay).
  const pathname = usePathname()

  useEffect(() => {
    syncMarketingReplay()
  }, [pathname])

  return null
}
