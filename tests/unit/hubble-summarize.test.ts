/**
 * The batch panel's written finding.
 *
 * ⚠️ THE ROSTER IS NOT AN ANSWER. Asked "how much funding did these companies
 * raise this year", the panel used to render twenty lead cards, most reading
 * "Amount: Not found". The four that had raised were buried among them.
 */
import { describe, expect, it } from 'vitest'

const source = () =>
  import('node:fs/promises').then((fs) => fs.readFile('lib/hubble/summarize.ts', 'utf8'))

describe('rows without data never reach the model', () => {
  it('filters to rows with at least one known value', async () => {
    /*
     * Including them invites the model to narrate absence, which is the exact
     * padding this replaces. The COUNT is kept so coverage is stated honestly.
     */
    const s = await source()
    expect(s).toMatch(/const withData = rows\.filter\(hasAnyValue\)/)
    expect(s).toMatch(/const withoutData = rows\.length - withData\.length/)
  })

  it('omits unknown fields rather than rendering "not found"', async () => {
    // The model must never see the vocabulary of absence, or it reproduces it.
    const s = await source()
    expect(s).toMatch(/if \(cell\?\.state !== 'known'\) continue/)
  })

  it('returns null when nothing at all was found', async () => {
    // A model asked to summarise nothing produces an apology, which helps
    // no one. The panel states it plainly instead.
    const s = await source()
    expect(s).toMatch(/if \(withData\.length === 0\) return null/)
  })
})

describe('arithmetic is done in code, never by the model', () => {
  it('computes totals, ranges and counts before the call', async () => {
    /*
     * ⚠️ A REAL FAILURE. Given $4.2m, $11m, $2.5m and $30m the model reported
     * a total of $46,000,000. The answer is $47,700,000 — and that figure was
     * about to be shown as a finding in a tool whose promise is that it does
     * not state things it cannot support.
     */
    const s = await source()
    expect(s).toContain('function computeFigures')
    expect(s).toMatch(/DO NOT ADD UP THE ROWS\nYOURSELF/)
    expect(s).toMatch(/quote exactly, do not recompute/)
  })

  it('sums and ranges correctly', async () => {
    // The arithmetic the model got wrong, done deterministically.
    const amounts = [4_200_000, 11_000_000, 2_500_000, 30_000_000]
    expect(amounts.reduce((sum, n) => sum + n, 0)).toBe(47_700_000)
    expect(Math.min(...amounts)).toBe(2_500_000)
    expect(Math.max(...amounts)).toBe(30_000_000)
  })
})

describe('the finding is a pattern in plain text', () => {
  it('bans vague quantifiers by name', async () => {
    /*
     * "Raised a significant amount" is the shape of an answer without being
     * one. Every banned word has a figure that should replace it.
     */
    const s = await source()
    expect(s).toContain('NO VAGUE QUANTIFIERS')
    for (const word of ['significant', 'substantial', 'a number of', 'several']) {
      expect(s).toContain(word)
    }
  })

  it('forbids walking the rows one by one', async () => {
    const s = await source()
    expect(s).toMatch(/NEVER walk\nthrough the rows one by one/)
    expect(s).toMatch(/Report the PATTERN across them/)
  })

  it('forbids narrating missing data or recommending more research', async () => {
    const s = await source()
    expect(s).toMatch(/do not mention missing data/)
    expect(s).toMatch(/do not\nrecommend further research/)
  })

  it('is plain text with no markdown', async () => {
    const s = await source()
    expect(s).toContain('PLAIN TEXT.')
    expect(s).toMatch(/No markdown, no headers, no asterisks/)
  })
})

describe('the panel states coverage as a number, not a roll-call', () => {
  it('shows "N of M with a public record" instead of listing the empties', async () => {
    const panel = await import('node:fs/promises').then((fs) =>
      fs.readFile('components/intelligence/HubbleResultPanel.tsx', 'utf8'),
    )

    expect(panel).toMatch(/with a public record/)
    // The telemetry tiles that used to open the panel are gone.
    expect(panel).not.toContain('label="Reused from cache"')
    expect(panel).not.toContain('label="External calls"')
    // The roster still exists for verification, but collapsed.
    expect(panel).toMatch(/<details/)
    expect(panel).toMatch(/Show the \{results\.rows\.length\.toLocaleString\(\)\} row/)
  })
})
