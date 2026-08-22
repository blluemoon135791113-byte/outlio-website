import type { Metadata } from 'next'
import Link from 'next/link'

import { ProfileManager } from '@/components/qualification/ProfileManager'
import { requireHubbleAccess } from '@/lib/auth/access'
import { listProfiles } from '@/lib/qualification/repository'

export const metadata: Metadata = {
  title: 'Qualification profiles | Outlio',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function ProfilesPage() {
  const ctx = await requireHubbleAccess()
  const profiles = await listProfiles(ctx.userId!)

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Intelligence
          </p>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-ink sm:text-[30px]">
            Qualification profiles
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Describe your ideal customer once, then score any research run against it.
            Scoring is deterministic — the same evidence always produces the same number.
          </p>
        </div>
        <Link
          href="/dashboard/intelligence"
          className="inline-flex h-10 w-fit items-center rounded-[var(--radius-md)] border border-border bg-panel px-4 text-sm font-semibold text-ink transition-[border-color] duration-150 hover:border-border-strong"
        >
          Back to search
        </Link>
      </header>

      <p className="rounded-[var(--radius-lg)] border border-border bg-surface-muted/40 px-4 py-3 text-sm text-muted">
        Outlio qualifies on business attributes only — role, company, industry, size,
        funding, technology, geography and business activity. Personal characteristics
        cannot be used, and the database rejects them outright.
      </p>

      <ProfileManager
        profiles={profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          qualifyAt: profile.qualifyAt,
          criteria: profile.criteria.map((criterion) => ({
            field: criterion.field,
            operator: criterion.operator,
            kind: criterion.kind,
            weight: criterion.weight,
          })),
        }))}
      />
    </div>
  )
}
