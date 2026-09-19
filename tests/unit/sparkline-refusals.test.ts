/**
 * When a sparkline must draw nothing.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ THE FAILURE IS A SHAPE THAT LOOKS LIKE EVIDENCE AND IS NOT.          ║
 * ║                                                                           ║
 * ║  A flat line at the baseline is the one that matters: it is what an       ║
 * ║  all-zero series produces, and it reads as "measured, and steady" rather  ║
 * ║  than "nothing happened". Nobody reports it, because a chart that renders ║
 * ║  is a chart that looks fine.                                              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ `createElement`, NOT JSX, AND NOT A CONFIG CHANGE. The unit project globs
 * `*.test.ts` only (vitest.config), which keeps the fast suite free of DOM
 * setup. Widening it to `.tsx` for one file would change what the whole suite
 * compiles; one `createElement` call does not.
 *
 * These render to markup rather than asserting on internals, so a failure is
 * the thing a reader would see — a line on the screen.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Sparkline } from '@/components/product/Sparkline'

const draw = (values: number[]) =>
  renderToStaticMarkup(createElement(Sparkline, { values }))

describe('the double is wired, so a pass means something', () => {
  it('draws a line for a series that actually moves', () => {
    const svg = draw([0, 3, 1, 7, 2])
    expect(svg).toContain('<svg')
    expect(svg).toContain('<path')
  })
})

describe('it refuses rather than inventing a shape', () => {
  /*
   * ⚠️ THE IMPORTANT ONE. Every value identical — including all zero — has no
   * trend in it, and a flat line is a claim that one was measured.
   */
  it('draws nothing for an all-zero series', () => {
    expect(draw([0, 0, 0, 0, 0])).toBe('')
  })

  it('draws nothing when every value is the same non-zero number', () => {
    expect(draw([4, 4, 4])).toBe('')
  })

  /*
   * One point is not a trend, and a charting library would happily run a flat
   * line through it.
   */
  it('draws nothing for a single point', () => {
    expect(draw([7])).toBe('')
  })

  /*
   * ⚠️ AN EMPTY ARRAY IS "COULD NOT BE READ", which `getMetricSeries` returns
   * for a metric with no stored column. The card must still look finished —
   * its figure and delta carry the meaning.
   */
  it('draws nothing for an empty series', () => {
    expect(draw([])).toBe('')
  })
})

describe('the drawn line stays inside its box', () => {
  it('never places a point outside the viewBox', () => {
    const svg = draw([0, 1000, 0, 500])

    const numbers = [...svg.matchAll(/([\d.]+),([\d.]+)/g)].map(([, x, y]) => ({
      x: Number(x),
      y: Number(y),
    }))

    expect(numbers.length).toBeGreaterThan(0)
    for (const point of numbers) {
      // 96 × 32 — a peak clipped by the viewBox would read as a plateau.
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(96)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(32)
    }
  })

  /*
   * ⚠️ A RISING SERIES MUST RISE. SVG's y-axis points DOWN, so a missing
   * inversion draws every trend upside down — the single easiest way for a
   * chart to state the opposite of the truth while looking entirely normal.
   */
  it('draws a rising series as rising', () => {
    const svg = draw([0, 10])
    const ys = [...svg.matchAll(/[\d.]+,([\d.]+)/g)].map(([, y]) => Number(y))

    // The first point is the low value and must sit LOWER on screen, which is
    // a LARGER y.
    expect(ys[0]).toBeGreaterThan(ys[1]!)
  })
})

describe('it is hidden from assistive technology', () => {
  /*
   * Every value it encodes is already announced by the card — the figure, the
   * delta and the comparison window. Reading forty daily counts aloud would
   * bury them.
   */
  it('marks the svg aria-hidden', () => {
    expect(draw([1, 5, 2])).toContain('aria-hidden')
  })
})
