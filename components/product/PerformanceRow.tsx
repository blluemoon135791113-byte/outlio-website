import { StatCard } from '@/components/product/StatCard'
import { RelativeTime } from '@/components/ui/LocalTime'
import type { OverviewPerformance } from '@/lib/crm/overview'

/**
 * Four outcome figures, above the usage row.
 *
 * ⚠️ NO ENTRANCE ANIMATION, and never `Reveal`. These are numbers somebody
 * opens the product to read; making them arrive is making them late.
 *
 * The card and its change badge live in `StatCard`, shared with the reports
 * page — see the note there for why rendering a delta twice is not allowed to
 * happen in this codebase.
 */
export function PerformanceRow({ data }: { data: OverviewPerformance }) {
  if (data.kind === 'unavailable') {
    return (
      <Frame>
        <p role="alert" className="text-sm text-muted">
          Performance figures could not be loaded. Your leads and credits are unaffected —
          this panel will fill in on its own once reporting responds.
        </p>
      </Frame>
    )
  }

  if (data.kind === 'pending') {
    return (
      <Frame>
        {/*
          ⚠️ THE STATE THAT EXISTS SO ZERO CAN KEEP ITS MEANING. Saying "not yet
          computed" costs one sentence; showing four zeroes instead would tell a
          setter they achieved nothing, which is a different and untrue claim.
        */}
        <p className="text-sm text-muted">
          Your activity figures are still being computed. They appear here within a few
          minutes of your first contact, email or booked call.
        </p>
      </Frame>
    )
  }

  return (
    <section aria-label="Your activity" className="space-y-3">
      <Heading>
        {/*
          ⚠️ THE COMPARISON WINDOW IS NAMED, NOT IMPLIED. A delta against an
          unstated baseline is a number the reader has to trust; printing the
          dates makes it one they can check.
        */}
        <span>Last 30 days · vs {dayRange(data.priorFromDay, data.priorToDay)}</span>
        {data.computedAt ? (
          <span className="hidden sm:inline">
            {' · computed '}
            {/*
              ⚠️ THE SHARED ONE, NOT A THIRD COPY. This was a server-computed
              elapsed string — timezone-safe, but measured against the server's
              clock and frozen at render. `RelativeTime` reads the READER's
              clock, keeps the exact instant one hover away, and re-labels
              itself every minute from a single shared interval.
            */}
            <RelativeTime iso={data.computedAt} />
          </span>
        ) : null}
      </Heading>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.cards.map((entry) => (
          <StatCard
            key={entry.key}
            label={entry.label}
            value={entry.value}
            hint={entry.hint}
            size="lg"
            delta={{
              change: entry.delta,
              previous: entry.previous,
              higherIsBetter: entry.higherIsBetter,
            }}
          />
        ))}
      </div>
    </section>
  )
}

/** The row's own label, so neither state can be mistaken for the usage row. */
function Heading({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Your activity
      </h2>
      <p className="text-[11px] text-muted">{children}</p>
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Your activity" className="space-y-3">
      <Heading />
      {/* Same surface class as the cards it stands in for — see StatCard. */}
      <div className="clay px-5 py-4">
        {children}
      </div>
    </section>
  )
}

/** "13 Aug – 11 Sep" — readable, and never a bare ISO string in the UI. */
function dayRange(from: string, to: string): string {
  const fmt = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  return `${fmt(from)} – ${fmt(to)}`
}
