import type { OverviewPerformance, PerformanceCard } from '@/lib/crm/overview'

/**
 * Four outcome figures, above the usage row.
 *
 * ⚠️ NO ENTRANCE ANIMATION, and never `Reveal`. These are numbers somebody
 * opens the product to read; making them arrive is making them late.
 *
 * ⚠️ COLOUR IS NEVER THE ONLY CARRIER OF THE CHANGE. The triangle points the
 * direction, the sign is printed, and the accessible label says the word — so
 * the figure survives a colour-blind reader, a greyscale print and a screen
 * reader identically.
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
        <span>
          Last 30 days · vs {dayRange(data.priorFromDay, data.priorToDay)}
        </span>
        {data.computedAt ? (
          <span className="hidden sm:inline">
            {' · computed '}
            <time dateTime={data.computedAt}>{relativeTime(data.computedAt)}</time>
          </span>
        ) : null}
      </Heading>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.cards.map((entry) => (
          <StatCard key={entry.key} card={entry} />
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
      <div className="rounded-[var(--radius-xl)] border border-border bg-panel px-5 py-4 shadow-[var(--shadow-sm)]">
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

/**
 * ⚠️ RELATIVE, BECAUSE A WALL CLOCK HERE WOULD BE THE SERVER'S.
 *
 * This renders on the server, where the timezone is UTC — so "computed 14:32"
 * would be five hours wrong for a reader in Karachi and no part of the page
 * would admit it. An elapsed duration is the same fact in every timezone.
 */
function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  // Clock skew between the database and this process can make it look ahead.
  if (seconds < 90) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function StatCard({ card }: { card: PerformanceCard }) {
  return (
    <article className="rounded-[var(--radius-xl)] border border-border bg-panel p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {card.label}
        </p>
        <Delta card={card} />
      </div>
      {/*
        `tabular-nums` so the four cards' digits sit on the same vertical rails
        and a number changing on refresh does not shift its own card's width.
      */}
      <p className="mt-3 font-heading text-[30px] font-semibold leading-none tracking-[-0.045em] tabular-nums text-ink">
        {card.value.toLocaleString()}
      </p>
      <p className="mt-2.5 text-[11px] leading-4 text-muted">{card.hint}</p>
    </article>
  )
}

function Delta({ card }: { card: PerformanceCard }) {
  /*
   * ⚠️ THREE OUTCOMES, AND TWO OF THEM ARE NOT A PERCENTAGE.
   *
   * `delta` is null whenever the previous period was zero, because every
   * percentage from zero is a fabrication — "+100%" and "+∞%" are both wrong,
   * and the second at least looks wrong. Something from nothing is reported as
   * new; nothing from nothing gets no badge, because there is no change to
   * describe and a grey "0%" reads as a result.
   */
  if (card.delta === null) {
    if (!card.isNew) return null
    return (
      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
        New
      </span>
    )
  }

  const up = card.delta > 0
  if (card.delta === 0) {
    return (
      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted">
        No change
      </span>
    )
  }

  const good = up === card.higherIsBetter
  const percent = Math.abs(Math.round(card.delta * 100))

  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        good ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
      }`}
    >
      <svg aria-hidden viewBox="0 0 8 8" className="h-2 w-2">
        {/* A triangle, so direction survives greyscale. */}
        <path d={up ? 'M4 0 8 7H0z' : 'M4 8 0 1h8z'} fill="currentColor" />
      </svg>
      {/* The sign is printed as well as drawn, for the same reason. */}
      <span>
        {up ? '+' : '−'}
        {percent}%
      </span>
      <span className="sr-only">
        {up ? 'up' : 'down'} from the previous period
      </span>
    </span>
  )
}
