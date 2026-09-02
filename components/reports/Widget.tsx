import type { MetricValue } from '@/lib/reports/metrics'

/**
 * One dashboard widget — R7.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  NO CHARTING LIBRARY, AND THAT IS A CONCLUSION RATHER THAN A SHORTCUT.   ║
 * ║                                                                           ║
 * ║  The chart guidance is explicit that fewer than four data points belongs  ║
 * ║  in a stat card, not a chart, and that a BULLET is the right form for a   ║
 * ║  KPI against a target when several sit side by side. Nearly every sales   ║
 * ║  metric here is a single number, or a single number against a total —     ║
 * ║  which CSS draws honestly, with no dependency and no bundle cost.         ║
 * ║                                                                           ║
 * ║  Trend-over-time genuinely needs a library. It is deferred, and that      ║
 * ║  dependency decision is surfaced rather than taken quietly.               ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
export function Widget({
  title,
  description,
  visual,
  value,
  width,
}: {
  title: string
  description: string
  visual: 'stat' | 'bar' | 'bullet' | 'list'
  value: MetricValue | null
  width: 1 | 2 | 4
}) {
  const span =
    width === 4 ? 'sm:col-span-2 xl:col-span-4' : width === 2 ? 'sm:col-span-2' : ''

  /*
   * ⚠️ NULL IS NOT ZERO, EVERYWHERE. A pipeline with no priced deals is not a
   * pipeline worth nothing, and a win rate over nothing closed is not 0%. The
   * metric layer returns null deliberately; collapsing it here would throw
   * away the care taken there.
   */
  const unknown = !value || value.value === null

  const formatted = unknown
    ? '—'
    : value!.unit && value!.unit !== '%'
      ? new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: value!.unit,
          maximumFractionDigits: 0,
        }).format(value!.value!)
      : `${value!.value!.toLocaleString()}${value!.unit ?? ''}`

  const pct =
    !unknown && value!.outOf
      ? Math.min(Math.max((value!.value! / value!.outOf) * 100, 0), 100)
      : null

  return (
    <article className={`clay p-4 ${span}`}>
      <h3 className="text-xs text-muted">{title}</h3>

      <p
        className={
          unknown
            ? 'mt-1 text-2xl tabular-nums text-muted'
            : 'mt-1 text-2xl font-semibold tabular-nums text-ink'
        }
      >
        {formatted}
      </p>

      {(visual === 'bar' || visual === 'bullet') && pct !== null ? (
        <>
          {/*
            ⚠️ `aria-hidden` BECAUSE THE NUMBER ABOVE ALREADY SAYS IT. A
            progressbar role would make a screen reader announce the same fact
            twice, and the guidance is explicit that a visual must never be the
            only way a value is conveyed.
          */}
          <div
            aria-hidden
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          {visual === 'bullet' ? (
            <p className="mt-1 text-xs text-muted">
              of {value!.outOf}
              {value!.unit === '%' ? '%' : ''}
            </p>
          ) : null}
        </>
      ) : null}

      {/* Says what the em dash MEANS rather than leaving it to be guessed at. */}
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {unknown ? 'Nothing recorded yet for this period.' : description}
      </p>
    </article>
  )
}
