import type { StatIcon } from '@/lib/crm/overview'

/**
 * A shape drawn from stored rows, or nothing at all.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE EASIEST PLACE IN A PRODUCT TO DRAW SOMETHING THAT MEANS NOTHING. ║
 * ║                                                                           ║
 * ║  A pleasing curve is the default output of every charting library whether ║
 * ║  or not the data supports one. CLAUDE.md rule 4 governs a drawn line      ║
 * ║  exactly as it governs a stored field, so this renders only from real     ║
 * ║  per-day values and refuses in three cases:                               ║
 * ║                                                                           ║
 * ║    · fewer than two points — one point is not a trend, and a library      ║
 * ║      would happily draw a flat line through it                            ║
 * ║    · every value identical — including all-zero, where a flat line at the ║
 * ║      baseline reads as a measured result rather than as no activity       ║
 * ║    · an empty array, which is what `getMetricSeries` returns when the     ║
 * ║      series could not be read                                             ║
 * ║                                                                           ║
 * ║  Refusing leaves the card's number and delta alone, which are the facts.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ `aria-hidden`, AND THAT IS NOT LAZINESS. Every value it encodes is
 * already in the card — the figure, the delta and the comparison window are all
 * announced. A screen reader reading forty daily counts aloud would bury them.
 */
export function Sparkline({
  values,
  tone = 'accent',
}: {
  values: number[]
  tone?: 'accent' | 'success' | 'danger'
}) {
  if (values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  if (max === min) return null

  const width = 96
  const height = 32
  // 1px of padding top and bottom, so a peak is not clipped by the viewBox.
  const span = max - min
  const step = width / (values.length - 1)

  const points = values.map((value, i) => {
    const x = i * step
    /*
     * ⚠️ MEASURED DOWN FROM `height`, BECAUSE SVG'S Y-AXIS POINTS DOWN. Written
     * the natural way round, every trend on the dashboard would be drawn upside
     * down — a rise rendering as a fall, and nothing about the picture looking
     * wrong. `sparkline-refusals.test.ts` asserts a rising series rises.
     */
    const y = height - 1 - ((value - min) / span) * (height - 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const line = `M${points.join(' L')}`
  // Closed back along the baseline for the fill, which is what gives the card
  // its weight at this size — a 1px stroke alone reads as a hairline.
  const area = `${line} L${width},${height} L0,${height} Z`

  const stroke =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'danger'
        ? 'var(--color-danger)'
        : 'var(--color-accent)'

  /*
   * ⚠️ A GRADIENT ID UNIQUE PER TONE, NOT PER INSTANCE. SVG ids are global to
   * the document, so four cards sharing one id would all resolve to whichever
   * definition rendered last — and a `useId` here would make this component
   * client-only for a decoration.
   */
  const gradientId = `sparkline-${tone}`

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      // `preserveAspectRatio="none"` so the line fills whatever width the card
      // gives it. The shape is a trend, not a measurement to be read off.
      preserveAspectRatio="none"
      className="h-8 w-full"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Scaling the viewBox non-uniformly would scale the stroke with it.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * The glyph in a stat card's tile.
 *
 * ⚠️ A CLOSED SET MATCHING `StatIcon`, so the switch is exhaustive and a new
 * name is a compile error rather than an empty tile. Every path is `stroke`,
 * never `fill`, so the glyphs sit at one visual weight beside each other.
 */
export function StatGlyph({ name }: { name: StatIcon }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5">
      {name === 'target' ? (
        <g {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1" />
        </g>
      ) : null}
      {name === 'trend' ? (
        <g {...common}>
          <path d="M3 17l5-5 3 3 7-7" />
          <path d="M14 8h4v4" />
        </g>
      ) : null}
      {name === 'people' ? (
        <g {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
          <path d="M16 6.5a3 3 0 010 5.6M17.5 19c0-2-.8-3.6-2-4.6" />
        </g>
      ) : null}
      {name === 'money' ? (
        <g {...common}>
          <path d="M12 3v18" />
          <path d="M16 7.5C16 6 14.2 5 12 5S8 6 8 7.5 9.8 10 12 10s4 1 4 2.5S14.2 15 12 15s-4-1-4-2.5" />
        </g>
      ) : null}
      {name === 'mail' ? (
        <g {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3.5 7l8.5 6 8.5-6" />
        </g>
      ) : null}
      {name === 'reply' ? (
        <g {...common}>
          <path d="M9 7L4 12l5 5" />
          <path d="M4 12h9a7 7 0 017 7v1" />
        </g>
      ) : null}
      {name === 'phone' ? (
        <g {...common}>
          <path d="M7 3h3l2 5-2.5 1.5a11 11 0 005 5L16 12l5 2v3a2 2 0 01-2.2 2A16 16 0 015 5.2 2 2 0 017 3z" />
        </g>
      ) : null}
      {name === 'calendar' ? (
        <g {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </g>
      ) : null}
    </svg>
  )
}
