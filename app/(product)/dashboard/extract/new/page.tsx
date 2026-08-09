import type { Metadata } from 'next'
import Link from 'next/link'

import { UploadForm } from '@/components/upload/UploadForm'
import { requireAccess } from '@/lib/auth/access'
import { resolveUploadLimits } from '@/lib/upload/limits'

export const metadata: Metadata = {
  title: 'New extraction | Outlio',
  robots: { index: false, follow: false },
}

// The response returns immediately; after() may continue processing the batch.
export const maxDuration = 300

export default async function NewExtractionPage() {
  // The only access decision. Redirects when denied.
  const ctx = await requireAccess()
  const limits = resolveUploadLimits(ctx.plan?.limits ?? null)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">New extraction</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Upload the pages you saved from your lead search results. We parse them
          on our servers — nothing is fetched from any platform.
        </p>
      </div>

      <UploadForm maxFiles={limits.maxFiles} maxFileBytes={limits.maxFileBytes} />

      <p className="text-sm text-muted">
        <Link href="/dashboard" className="font-medium text-accent hover:underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  )
}
