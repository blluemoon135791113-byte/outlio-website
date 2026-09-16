/**
 * One figure, and how it changed. The only place either is decided.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THIS EXISTS BECAUSE THE RULES WERE ALREADY WRITTEN TWICE.                 ║
 * ║                                                                           ║
 * ║  The overview row and the reports page each worked out independently that  ║
 * ║  a percentage from a zero baseline is invented, and each solved it         ║
 * ║  differently — one shows "New", the other "none last period"; one draws a  ║
 * ║  triangle, the other types ▲. Both were right. Two right answers to the    ║
 * ║  same question is how `TASK_FOR` came to exist three times and diverge,    ║
 * ║  and a divergence here is a number that means different things on two      ║
 * ║  screens of the same product.                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ DIRECTION NEVER RESTS ON COLOUR ALONE. A triangle points it, the sign is
 * printed, and the accessible label says the word — so the figure survives a
 * colour-blind reader, a greyscale print and a screen reader identically. The
 * glyphs this replaces (▲ / ▼) are read aloud by some screen readers as "black
 * up-pointing triangle", which is worse than silence.
 */

export type StatDelta = {
  /**
   * Change as a fraction, or `null` when there is no honest one — `trend()`
   * refuses to divide by a zero previous period.
   */
  change: number | null
  /** The baseline. Shown when no percentage can be, so the reader can judge it. */
  previous: number
  /**
   * ⚠️ DECLARED, NOT ASSUMED. Up is good for activity counts and bad for
   * bounces and unsubscribes. A row that assumed the first would render a rise
   * in the second in the success colour.
   */
  higherIsBetter?: boolean
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  size = 'sm',
}: {
  label: string
  /** A string for money and other pre-formatted values. */
  value: number | string
  delta?: StatDelta
  /** A second fact, not a restatement of the first. */
  hint?: string
  /** `lg` leads a screen; `sm` sits in a dense grid. */
  size?: 'sm' | 'lg'
}) {
  const large = size === 'lg'

  return (
    /*
     * ⚠️ `clay`, NOT A HAND-BUILT PANEL. Inside `.product-clay` that class
     * resolves to white, a hairline border, no shadow and `--radius-clay`,
     * which the product scope tightens to 0.625rem. DESIGN_TOKENS gives the
     * reason: "a large radius reads as 'soft object'; a small one reads as
     * 'region of a page', which is what these now are."
     *
     * This was `rounded-[var(--radius-xl)] … shadow-[var(--shadow-sm)]`, which
     * broke both halves of that — a 16px radius against every other card's 10px,
     * and a shadow on a panel that does not float. The token block says it
     * outright: "Panels get NO shadow. These remain for genuinely floating
     * things." Twenty-one cards across the two most numeric screens, each
     * slightly the wrong shape.
     */
    <article className={`clay ${large ? 'p-5' : 'p-4'}`}>
      {/*
        ╔═══════════════════════════════════════════════════════════════════════╗
        ║  ⚠️ THE DELTA CHIP SITS BESIDE THE NUMBER, NOT BESIDE THE LABEL — AND ║
        ║  THAT CHANGED BECAUSE OF WHAT THESE CARDS BECAME.                     ║
        ║                                                                       ║
        ║  They used to be one per row on a phone, so a label and a chip shared ║
        ║  a line comfortably. Going two-up dropped them to ~152px, where        ║
        ║  "CONTACTS ADDED" wraps — and with `justify-between` the chip landed   ║
        ║  in the gap BETWEEN the two label lines, reading as part of the label  ║
        ║  text. Measured, not guessed: the chip's box sat at the end of line 1  ║
        ║  of a two-line label.                                                 ║
        ║                                                                       ║
        ║  Beside the number is also the more honest place. "New" describes the  ║
        ║  FIGURE's movement, not the metric's name, and the number is short     ║
        ║  enough to leave room at any width these cards reach.                  ║
        ╚═══════════════════════════════════════════════════════════════════════╝
      */}
      <p
        className={`font-semibold uppercase text-muted ${
          large ? 'text-[11px] tracking-[0.14em]' : 'text-[10px] tracking-[0.12em]'
        }`}
      >
        {label}
      </p>

      {/*
        `tabular-nums` so figures in a row sit on the same vertical rails and a
        number changing on refresh cannot shift its own card's width.
      */}
      {/*
        ⚠️ `items-baseline`, so the chip's text sits on the figure's baseline
        rather than centred against a 30px number — centring leaves it floating
        visibly above the digits' feet.
      */}
      <div className={`flex flex-wrap items-baseline gap-2 ${large ? 'mt-3' : 'mt-2.5'}`}>
        <p
          className={`font-heading font-semibold leading-none tracking-[-0.045em] tabular-nums text-ink ${
            large ? 'text-[30px]' : 'text-[22px]'
          }`}
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {delta ? <DeltaChip delta={delta} value={value} /> : null}
      </div>

      {hint ? (
        <p className={`text-[11px] leading-4 text-muted ${large ? 'mt-2.5' : 'mt-2'}`}>{hint}</p>
      ) : null}
    </article>
  )
}

function DeltaChip({ delta, value }: { delta: StatDelta; value: number | string }) {
  const { change, previous, higherIsBetter = true } = delta

  /*
   * ⚠️ FOUR OUTCOMES, AND ONLY ONE OF THEM IS A PERCENTAGE.
   *
   * Every percentage from a zero baseline is a fabrication: 0 → 5 is not
   * "+500%" and not "+100%". Something from nothing reports as new; nothing
   * from nothing gets no badge, because there is no change to describe and a
   * grey "0%" reads as a result rather than an absence.
   */
  if (change === null) {
    const grew = typeof value === 'number' ? value > 0 : value !== '0'
    if (previous !== 0 || !grew) return null
    return (
      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
        New
      </span>
    )
  }

  if (change === 0) {
    return (
      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted">
        No change
      </span>
    )
  }

  const up = change > 0
  const good = up === higherIsBetter

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
      <span>
        {up ? '+' : '−'}
        {Math.abs(Math.round(change * 100))}%
      </span>
      {/* The baseline, so a percentage is never the only thing to judge it by. */}
      <span className="sr-only">
        {up ? 'up' : 'down'} from {previous.toLocaleString()} in the previous period
      </span>
    </span>
  )
}
