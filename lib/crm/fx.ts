import 'server-only'

/**
 * The rate a deal's value is snapshotted at — DECISION-19.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  A RATE IS AN OBSERVATION OR IT IS NULL. THERE IS NO THIRD OPTION.        ║
 * ║                                                                           ║
 * ║  §5.6 wants `fx_rate_to_workspace_currency` + `fx_rate_date` captured at   ║
 * ║  create and at close, so a deal's reported value settles when it closes    ║
 * ║  and never moves again. Migration 0123 built the columns and the           ║
 * ║  invariant; this is the source of the numbers that go in them.            ║
 * ║                                                                           ║
 * ║  ⚠️ NULL IS A REAL ANSWER AND IT IS LOAD-BEARING. A deal with no rate is   ║
 * ║  UNCONVERTIBLE: `value_amount_base` is NULL, `sum()` drops it, and         ║
 * ║  `crm_unconvertible_deals()` counts it so the shortfall is visible.        ║
 * ║  Falling back to 1 would add €10,000 to a dollar total as though it were   ║
 * ║  $10,000 — the exact bug §5.6 exists to prevent.                          ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { z } from 'zod'

import { requestJson, setHostPacing } from '@/lib/intelligence/http'

/** A rate observed on a date, from a named source. Never computed here. */
export type FxRate = {
  /** Multiply the deal amount by this to get the workspace currency. */
  rate: number
  /** The day the rate was quoted, as the SOURCE reported it. */
  date: string
  /** Who said so. An unattributed rate is not evidence. */
  source: string
}

export type FxProvider = {
  name: string
  /**
   * The rate from `from` to `to` on `onDate`, or null when this provider
   * cannot say. Null is an ordinary answer, not an error.
   */
  rateOn(from: string, to: string, onDate: Date): Promise<FxRate | null>
}

const FRANKFURTER_HOST = 'api.frankfurter.dev'

/*
 * ⚠️ MEASURED, NOT GUESSED. Five requests in quick succession got connection
 * failures rather than 429s, so the host throttles at the edge. One request
 * per second is well inside what it tolerates and far above what deal creation
 * needs — and `setHostPacing` is the existing mechanism for exactly this, so
 * nothing here re-implements backoff.
 */
setHostPacing(FRANKFURTER_HOST, 1_000)

/**
 * Frankfurter's v2 response.
 *
 * ⚠️ A FLAT ARRAY. The legacy v1 API returned a nested `rates` object and is
 * deprecated; v2 blends several central banks into `[{date, base, quote, rate}]`.
 * Validated rather than cast, because this is an external input (CLAUDE.md).
 */
const QuoteSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.string().length(3),
  quote: z.string().length(3),
  rate: z.number().finite().positive(),
})

const ResponseSchema = z.array(QuoteSchema)

/** Parses one pair out of a v2 response. Exported so the shape can be tested. */
export function parseFrankfurter(
  body: unknown,
  want: { from: string; to: string },
): FxRate | null {
  const parsed = ResponseSchema.safeParse(body)
  if (!parsed.success) return null

  const match = parsed.data.find(
    (quote) =>
      quote.base.toUpperCase() === want.from && quote.quote.toUpperCase() === want.to,
  )
  if (!match) return null

  return {
    rate: match.rate,
    /*
     * ⚠️ THE DATE THE SOURCE RETURNED, NEVER THE ONE WE ASKED FOR. Requesting
     * `1970-01-01` comes back dated `1969-12-31` — outside its range it answers
     * with the nearest quote it holds. Storing the requested date would claim a
     * rate was quoted on a day it was not, which is the whole thing
     * `fx_rate_date` exists to make auditable.
     */
    date: match.date,
    source: 'frankfurter',
  }
}

/**
 * frankfurter.dev — 205 currencies from 98 central banks, no key, open source.
 *
 * ⚠️ EVERY FAILURE IS `null`, INCLUDING AN UNKNOWN CURRENCY. The host answers
 * `422 {"message":"invalid currency: ZZZ"}` for a code it does not carry, and
 * `requestJson` turns a non-2xx into a throw. Letting that escape would mean a
 * bad currency code takes out deal creation; returning null means the deal is
 * created and reported as unconvertible, which is recoverable.
 */
const frankfurter: FxProvider = {
  name: 'frankfurter',
  async rateOn(from, to, onDate) {
    const day = isoDay(onDate)
    const url =
      `https://${FRANKFURTER_HOST}/v2/rates` +
      `?base=${encodeURIComponent(from)}&quotes=${encodeURIComponent(to)}&date=${day}`

    try {
      const body = await requestJson({
        url,
        // A rate is not worth holding up a deal for. Short, with the shared
        // client's own bounded retry behind it.
        timeoutMs: 6_000,
        maxRetries: 1,
      })
      return parseFrankfurter(body, { from, to })
    } catch {
      return null
    }
  },
}

/**
 * ⚠️ ORDER IS THE WATERFALL, as in `lib/intelligence/providers/index.ts`. The
 * first provider that answers wins. One entry today; the shape is here so a
 * paid feed can sit in front of the free one without touching callers.
 */
const PROVIDERS: readonly FxProvider[] = [frankfurter]

/**
 * A rate observed for a past date never changes, so it is worth remembering.
 *
 * ⚠️ CACHES ONLY WHAT WAS FOUND, AND ONLY BY THE RETURNED DATE. A miss is not
 * cached: the host being briefly unreachable must not make a deal permanently
 * unconvertible for the life of the process.
 */
const cache = new Map<string, FxRate>()
const CACHE_LIMIT = 500

export async function resolveFxRate(input: {
  from: string
  to: string
  onDate?: Date
}): Promise<FxRate | null> {
  const from = input.from.trim().toUpperCase()
  const to = input.to.trim().toUpperCase()
  const onDate = input.onDate ?? new Date()

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null

  /*
   * ╔═══════════════════════════════════════════════════════════════════════╗
   * ║  ⚠️ THE IDENTITY IS ANSWERED WITHOUT THE NETWORK, AND THAT IS NOT AN  ║
   * ║  OPTIMISATION.                                                         ║
   * ║                                                                        ║
   * ║  When a deal is already in the workspace's currency the rate is 1       ║
   * ║  because the two amounts ARE the same amount — a fact the row carries,  ║
   * ║  not an exchange rate anyone looked up. Asking a third party to confirm ║
   * ║  it would make creating an ordinary deal depend on their uptime, and    ║
   * ║  today every deal in the product is this case.                          ║
   * ║                                                                        ║
   * ║  Migration 0123's trigger writes the same value independently, so the   ║
   * ║  invariant holds even against a caller that forgets to ask.            ║
   * ╚═══════════════════════════════════════════════════════════════════════╝
   */
  if (from === to) {
    return {
      rate: 1,
      date: isoDay(onDate),
      // Distinguishable from a vendor quoting parity — they mean different
      // things to anyone auditing the snapshot.
      source: 'identity',
    }
  }

  const key = `${from}|${to}|${isoDay(onDate)}`
  const hit = cache.get(key)
  if (hit) return hit

  for (const provider of PROVIDERS) {
    const quoted = await provider.rateOn(from, to, onDate)
    /*
     * Re-checked here rather than trusted: a provider is external code, and a
     * zero or negative rate would pass 0123's constraint check only by
     * erroring at write time, after the deal is half created.
     */
    if (quoted && Number.isFinite(quoted.rate) && quoted.rate > 0) {
      if (cache.size >= CACHE_LIMIT) cache.clear()
      cache.set(key, quoted)
      return quoted
    }
  }

  return null
}

/** Whether a pair can be converted at all right now. */
export async function canConvert(from: string, to: string): Promise<boolean> {
  return (await resolveFxRate({ from, to })) !== null
}

/** `2026-09-13`, the shape `fx_rate_date` stores. */
function isoDay(date: Date): string {
  /*
   * ⚠️ UTC, LIKE EVERY OTHER DATE-ONLY VALUE HERE. A rate dated by the
   * server's local day would move a snapshot across midnight depending on
   * where the process happens to run.
   */
  return date.toISOString().slice(0, 10)
}
