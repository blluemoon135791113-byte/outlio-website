/**
 * The rate that goes into a money column, and the ways it must refuse.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A RATE IS AN OBSERVATION OR IT IS NULL.                                  ║
 * ║                                                                           ║
 * ║  Every assertion here is really one assertion: nothing may invent a        ║
 * ║  number. A bad rate is worse than no rate, because no rate makes a deal    ║
 * ║  UNCONVERTIBLE — dropped from totals and counted by                        ║
 * ║  `crm_unconvertible_deals()` — while a bad one silently restates what a    ║
 * ║  customer's pipeline is worth.                                            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, expect, it, vi } from 'vitest'

/*
 * ⚠️ THE HTTP LAYER IS MOCKED, NOT THE PROVIDER. Mocking `resolveFxRate`'s own
 * dependencies would leave the waterfall, the cache and the identity
 * short-circuit untested — which is all of the logic this module has.
 */
const requestJson = vi.fn()
vi.mock('@/lib/intelligence/http', () => ({
  requestJson: (...args: unknown[]) => requestJson(...args),
  setHostPacing: vi.fn(),
}))

const { parseFrankfurter, resolveFxRate, canConvert } = await import('@/lib/crm/fx')

/** Exactly what api.frankfurter.dev/v2 returned when this was written. */
const REAL_RESPONSE = [{ date: '2026-09-13', base: 'USD', quote: 'GBP', rate: 0.73902 }]

describe('the parser matches what the API actually sends', () => {
  it('reads a v2 flat array', () => {
    /*
     * ⚠️ v2 IS A FLAT ARRAY. The legacy v1 API returned a nested `rates` object
     * and is deprecated; writing the parser against v1's shape would have found
     * nothing and made every cross-currency deal unconvertible, silently.
     */
    expect(parseFrankfurter(REAL_RESPONSE, { from: 'USD', to: 'GBP' })).toEqual({
      rate: 0.73902,
      date: '2026-09-13',
      source: 'frankfurter',
    })
  })

  it('keeps the date the SOURCE returned, not the one we asked for', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ FOUND BY PROBING THE LIVE API, NOT BY READING THE DOCS.           ║
     * ║                                                                       ║
     * ║  `?date=1970-01-01` comes back dated `1969-12-31`: outside its range   ║
     * ║  it answers with the nearest quote it holds. Storing the requested     ║
     * ║  date would put a rate in `fx_rate_date` on a day it was never quoted, ║
     * ║  which is the exact thing that column exists to make auditable.        ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    const shifted = [{ date: '1969-12-31', base: 'USD', quote: 'GBP', rate: 0.41651 }]
    expect(parseFrankfurter(shifted, { from: 'USD', to: 'GBP' })?.date).toBe('1969-12-31')
  })

  it('returns null for every shape that is not a usable quote', () => {
    const cases: [string, unknown][] = [
      // The 422 body for an unknown currency: `{"status":422,"message":...}`.
      ['error object', { status: 422, message: 'invalid currency: ZZZ' }],
      ['empty array', []],
      ['pair absent', [{ date: '2026-09-13', base: 'USD', quote: 'INR', rate: 95.51 }]],
      ['zero rate', [{ date: '2026-09-13', base: 'USD', quote: 'GBP', rate: 0 }]],
      ['negative rate', [{ date: '2026-09-13', base: 'USD', quote: 'GBP', rate: -1 }]],
      ['rate as string', [{ date: '2026-09-13', base: 'USD', quote: 'GBP', rate: '0.73' }]],
      ['malformed date', [{ date: '13/09/2026', base: 'USD', quote: 'GBP', rate: 0.73 }]],
      ['not an array', { date: '2026-09-13', base: 'USD', quote: 'GBP', rate: 0.73 }],
      ['null', null],
    ]
    for (const [label, body] of cases) {
      expect(parseFrankfurter(body, { from: 'USD', to: 'GBP' }), label).toBeNull()
    }
  })
})

describe('the identity is answered without the network', () => {
  it('returns 1 for a pair that is the same currency, and does not call out', async () => {
    /*
     * ⚠️ NOT AN OPTIMISATION. Every deal in the product today is this case, so
     * asking a third party would make creating an ordinary deal depend on their
     * uptime. And 1 here is a restatement of a fact the row carries, not an
     * exchange rate anybody looked up.
     */
    requestJson.mockClear()
    const rate = await resolveFxRate({ from: 'USD', to: 'USD' })
    expect(rate).toMatchObject({ rate: 1, source: 'identity' })
    expect(requestJson, 'the network was called for an identity').not.toHaveBeenCalled()
  })

  it('labels it `identity`, distinguishably from a vendor quoting parity', async () => {
    // They mean different things to anyone auditing the snapshot.
    const rate = await resolveFxRate({ from: 'gbp', to: 'GBP' })
    expect(rate?.source).toBe('identity')
  })
})

describe('a failure is null, never a guess', () => {
  it('returns null when the provider throws', async () => {
    /*
     * ⚠️ AN UNKNOWN CURRENCY IS A 422, AND `requestJson` TURNS THAT INTO A
     * THROW. Letting it escape would mean a bad currency code takes out deal
     * creation; null means the deal is created and reported as unconvertible,
     * which is recoverable.
     */
    requestJson.mockRejectedValueOnce(new Error('ERR_PROVIDER_REJECTED'))
    expect(await resolveFxRate({ from: 'USD', to: 'ZZZ' })).toBeNull()
  })

  it('returns null for a malformed currency code without calling out', async () => {
    requestJson.mockClear()
    expect(await resolveFxRate({ from: 'DOLLARS', to: 'GBP' })).toBeNull()
    expect(requestJson).not.toHaveBeenCalled()
  })

  it('does not cache a miss, so an outage is not permanent', async () => {
    /*
     * ⚠️ CACHING A FAILURE WOULD MAKE A DEAL UNCONVERTIBLE FOR THE LIFE OF THE
     * PROCESS because the host blipped once.
     */
    requestJson.mockRejectedValueOnce(new Error('down'))
    expect(await resolveFxRate({ from: 'USD', to: 'SEK' })).toBeNull()

    requestJson.mockResolvedValueOnce([
      { date: '2026-09-13', base: 'USD', quote: 'SEK', rate: 9.4 },
    ])
    expect(await resolveFxRate({ from: 'USD', to: 'SEK' })).toMatchObject({ rate: 9.4 })
  })
})

describe('a found rate is remembered', () => {
  it('asks once for the same pair and date', async () => {
    requestJson.mockClear()
    requestJson.mockResolvedValue([
      { date: '2026-09-13', base: 'USD', quote: 'NOK', rate: 10.1 },
    ])
    const onDate = new Date('2026-09-13T12:00:00Z')
    await resolveFxRate({ from: 'USD', to: 'NOK', onDate })
    await resolveFxRate({ from: 'USD', to: 'NOK', onDate })
    expect(requestJson).toHaveBeenCalledTimes(1)
  })
})

describe('canConvert answers the question the UI asks', () => {
  it('is true for an identity and false when nothing can quote it', async () => {
    expect(await canConvert('USD', 'USD')).toBe(true)
    requestJson.mockRejectedValueOnce(new Error('down'))
    expect(await canConvert('USD', 'XOF')).toBe(false)
  })
})
