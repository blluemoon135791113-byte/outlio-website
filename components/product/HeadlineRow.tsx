import Link from 'next/link'

import { StatCard } from '@/components/product/StatCard'
import type { HeadlineKpis } from '@/lib/crm/overview'
import { RANGES, type RangeKey } from '@/lib/crm/reports'

/**
 * The four workspace figures at the top of the overview.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE WHOLE WORKSPACE. "Your activity" below it is ONE PERSON.         ║
 * ║                                                                           ║
 * ║  The two rows look alike by design and answer different questions, so     ║
 * ║  each states its scope in its own heading. The reports page records what  ║
 * ║  happens when they do not (D24): the number is right and the sentence     ║
 * ║  above it is wrong, and nobody notices because both are plausible.        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO ENTRANCE ANIMATION, and never `Reveal`. These are numbers somebody
 * opens the product to read; making them arrive is making them late.
 */
export function HeadlineRow({
  data,
  range,
}: {
  data: HeadlineKpis
  range: RangeKey
}) {
  if (data.kind === 'unavailable') {
    return (
      <Frame range={range}>
        <p role="alert" className="text-sm text-muted">
          These figures could not be loaded. Your leads and credits are unaffected — the panel
          fills in on its own once reporting responds.
        </p>
      </Frame>
    )
  }

  if (data.kind === 'pending') {
    return (
      <Frame range={range}>
        {/*
          ⚠️ THE STATE THAT EXISTS SO ZERO CAN KEEP ITS MEANING. Saying "not yet
          computed" costs one sentence; four zeroes would claim the workspace
          did nothing, which is a different and untrue statement.
        */}
        <p className="text-sm text-muted">
          Your figures are still being computed. They appear here within a few minutes of the
          first contact, email or booked call.
        </p>
      </Frame>
    )
  }

  return (
    <section aria-label="Workspace overview" className="space-y-3">
      <Header range={range} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.cards.map((entry) => (
          <StatCard
            key={entry.key}
            label={entry.label}
            value={entry.value}
            hint={entry.hint}
            size="lg"
            icon={entry.icon}
            series={entry.series}
            href={entry.href}
            linkLabel={LINK_LABELS[entry.key] ?? 'View'}
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

/**
 * ⚠️ NAMES THE DESTINATION, NOT THE ACTION. "View" four times tells a reader
 * nothing about which of four links they are on, and a screen reader listing
 * the page's links reads four identical entries.
 */
const LINK_LABELS: Record<string, string> = {
  leads: 'View contacts',
  reply_rate: 'View reports',
  won_deals: 'View pipeline',
  won_value: 'View revenue',
}

/**
 * ⚠️ THE SAME SHAPE AS "Your activity" BELOW, DELIBERATELY.
 *
 * This read `<h2>Overview</h2>` in a heading font, directly under the page's
 * own `<h1>Overview</h1>` — the same word twice, at two weights, six pixels
 * apart. Worse, it made the two figure rows look like different KINDS of thing
 * when the only difference between them is scope, which is precisely what a
 * reader has to notice.
 *
 * So both rows now carry one micro-label naming their scope, at one weight.
 * The label IS the heading here — it is not a kicker over a larger one, which
 * the craft floor bans outright.
 */
function Header({ range }: { range: RangeKey }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Workspace
      </h2>
      <p className="text-[11px] text-muted">
        Everyone here · {RANGES[range].label.toLowerCase()}
      </p>
    </div>
  )
}

/**
 * The period selector.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ LINKS, NOT A `<select>` WITH AN onChange — the same reasoning as the ║
 * ║  pipeline switcher. The range lives in the URL, so it survives a reload,  ║
 * ║  can be bookmarked and shared, and the back button undoes a change of     ║
 * ║  period. It also means this component ships no JavaScript and the range   ║
 * ║  works before hydration.                                                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ NO `bg-accent` ON THE CURRENT ONE. `.hubble-shell nav a[aria-current]` in
 * globals.css sets a charcoal tint and out-specifies a utility class, so cream
 * text lands on cream — the exact bug already recorded on `/email/analytics`.
 */
export function RangePicker({ current }: { current: RangeKey }) {
  return (
    <nav aria-label="Period" className="flex items-center gap-0.5 rounded-[var(--radius-md)] border border-border p-0.5">
      {(Object.keys(RANGES) as RangeKey[]).map((key) => (
        <Link
          key={key}
          href={`/dashboard?range=${key}`}
          aria-current={key === current ? 'page' : undefined}
          className={
            key === current
              ? 'rounded-[var(--radius-sm)] bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink'
              : 'rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium text-muted transition-colors duration-150 hover:text-ink'
          }
        >
          {RANGES[key].label}
        </Link>
      ))}
    </nav>
  )
}

function Frame({ range, children }: { range: RangeKey; children: React.ReactNode }) {
  return (
    <section aria-label="Workspace overview" className="space-y-3">
      <Header range={range} />
      {/* Same surface class as the cards it stands in for — see StatCard. */}
      <div className="clay px-5 py-4">{children}</div>
    </section>
  )
}
