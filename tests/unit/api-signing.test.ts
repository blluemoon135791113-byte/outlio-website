/**
 * API keys and webhook signing — M8 Phase 25.5.
 *
 * ⚠️ THIS IS THE CODE A CUSTOMER'S OWN CONSUMER HAS TO MIRROR. If our signer
 * and the documented verification disagree, every customer integration fails
 * in a way they will blame on themselves — so the verifier lives beside the
 * signer and both are tested together.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  API_KEY_PREFIX,
  backoffSeconds,
  backoffSecondsWithJitter,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  secretsMatch,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_EVENTS,
} from '@/lib/api/signing'

describe('API keys', () => {
  it('never returns the same key twice', () => {
    expect(generateApiKey().key).not.toBe(generateApiKey().key)
  })

  it('carries a scanner-recognisable prefix', () => {
    /*
     * `outlio_sk_` is matchable by GitHub and GitGuardian, so a key pasted
     * into a public repo can be detected and revoked. An opaque random string
     * cannot be.
     */
    expect(generateApiKey().key.startsWith(API_KEY_PREFIX)).toBe(true)
  })

  it('has enough entropy that guessing is hopeless', () => {
    // 32 random bytes, base64url — comfortably over 200 bits.
    const secret = generateApiKey().key.slice(API_KEY_PREFIX.length)
    expect(secret.length).toBeGreaterThanOrEqual(40)
  })

  it('hashes deterministically, and the hash does not contain the key', () => {
    const { key, hash } = generateApiKey()
    expect(hashApiKey(key)).toBe(hash)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(key.slice(API_KEY_PREFIX.length, 20))
  })

  it('exposes a prefix that identifies but cannot reconstruct', () => {
    const { key, prefix } = generateApiKey()
    expect(key.startsWith(prefix)).toBe(true)
    // Far too short to brute-force the rest from.
    expect(prefix.length).toBeLessThan(key.length / 2)
  })
})

describe('extracting a key from a request', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://api.outlio.io/v1/contacts', { headers })

  it('reads a bearer token', () => {
    expect(extractApiKey(req({ authorization: 'Bearer abc123' }))).toBe('abc123')
  })

  it('is case-insensitive about the scheme', () => {
    expect(extractApiKey(req({ authorization: 'bearer abc123' }))).toBe('abc123')
  })

  it('refuses other schemes', () => {
    // Basic auth would put the key in a base64 blob people treat as opaque.
    expect(extractApiKey(req({ authorization: 'Basic abc123' }))).toBeNull()
  })

  it('returns null with no header at all', () => {
    expect(extractApiKey(req({}))).toBeNull()
  })

  it('does NOT read a key from the query string', () => {
    /*
     * ⚠️ A key in a URL ends up in server logs, browser history, referrer
     * headers and analytics — which is how long-lived credentials leak without
     * anyone doing anything wrong.
     */
    const withQuery = new Request('https://api.outlio.io/v1/contacts?api_key=outlio_sk_leaked')
    expect(extractApiKey(withQuery)).toBeNull()
  })
})

describe('webhook signatures', () => {
  const SECRET = 'whsec_test_value'
  const body = JSON.stringify({ id: 'evt_1', type: 'crm.contact.created', data: { id: 'c1' } })

  it('round-trips: what we sign, the documented verifier accepts', () => {
    const { signature } = signWebhookPayload(body, SECRET)
    expect(verifyWebhookSignature(body, signature, SECRET)).toBe(true)
  })

  it('rejects a body altered after signing', () => {
    const { signature } = signWebhookPayload(body, SECRET)
    const tampered = body.replace('c1', 'c2')
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    const { signature } = signWebhookPayload(body, 'someone-elses-secret')
    expect(verifyWebhookSignature(body, signature, SECRET)).toBe(false)
  })

  it('rejects a replayed signature that is too old', () => {
    /*
     * The timestamp is INSIDE the signed string, so it cannot be edited to
     * look fresh without invalidating the signature.
     */
    const at = new Date('2026-09-01T12:00:00Z')
    const { signature } = signWebhookPayload(body, SECRET, at)
    const muchLater = new Date('2026-09-01T12:30:00Z')
    expect(verifyWebhookSignature(body, signature, SECRET, 300, muchLater)).toBe(false)
  })

  it('accepts one inside the freshness window', () => {
    const at = new Date('2026-09-01T12:00:00Z')
    const { signature } = signWebhookPayload(body, SECRET, at)
    const soon = new Date('2026-09-01T12:02:00Z')
    expect(verifyWebhookSignature(body, signature, SECRET, 300, soon)).toBe(true)
  })

  it.each([['', 'empty'], ['garbage', 'no parts'], ['t=1', 'no v1'], ['v1=x', 'no timestamp']])(
    'rejects a malformed header: %s (%s)',
    (header) => {
      expect(verifyWebhookSignature(body, header, SECRET)).toBe(false)
    },
  )

  it('produces a different signature for the same body at a different time', () => {
    // Otherwise the timestamp is not really bound in.
    const a = signWebhookPayload(body, SECRET, new Date('2026-09-01T12:00:00Z')).signature
    const b = signWebhookPayload(body, SECRET, new Date('2026-09-01T12:00:01Z')).signature
    expect(a).not.toBe(b)
  })
})

describe('constant-time comparison', () => {
  it('matches equal strings and rejects different ones', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true)
    expect(secretsMatch('abc', 'abd')).toBe(false)
  })

  it('returns false on a length mismatch rather than throwing', () => {
    // timingSafeEqual throws on unequal lengths; that must not become a 500.
    expect(secretsMatch('abc', 'abcdef')).toBe(false)
  })
})

describe('retry backoff', () => {
  it('starts small so a brief outage recovers within a minute', () => {
    expect(backoffSeconds(1)).toBe(30)
  })

  it('grows exponentially rather than linearly', () => {
    expect(backoffSeconds(2)).toBe(120)
    expect(backoffSeconds(3)).toBe(480)
    expect(backoffSeconds(4)).toBe(1920)
  })

  it('spans roughly three hours over five attempts', () => {
    /*
     * Long enough to cover a deploy or a short outage; short enough not to be
     * retrying into next week, by which time the event is useless anyway.
     */
    const total = [1, 2, 3, 4, 5].reduce((sum, n) => sum + backoffSeconds(n), 0)
    expect(total).toBeGreaterThan(2 * 3600)
    expect(total).toBeLessThan(4 * 3600)
  })

  it('never returns a negative or zero delay', () => {
    // A zero delay would spin the delivery worker.
    expect(backoffSeconds(0)).toBeGreaterThan(0)
    expect(backoffSeconds(-5)).toBeGreaterThan(0)
  })
})

/** Past-tense verbs that do not end in "ed". */
const IRREGULAR_PAST = new Set(['won', 'lost', 'sent', 'built', 'read'])

describe('the event catalogue', () => {
  it('uses a past-tense verb and lowercase segments throughout', () => {
    // A consumer writing a switch should never have to remember whether it is
    // `contact.create` or `contact.created`.
    for (const event of WEBHOOK_EVENTS) {
      expect(event).toMatch(/^[a-z]+(\.[a-z_]+){1,2}$/)
      /*
       * Past tense, allowing irregulars: `won` is as past-tense as `created`,
       * and an earlier version of this assertion rejected it for not ending in
       * "ed" — the test being naive about English rather than the name being
       * wrong.
       */
      const verb = event.split('.').pop()!
      expect(IRREGULAR_PAST.has(verb) || verb.endsWith('ed')).toBe(true)
    }
  })

  it('keeps each DOMAIN internally consistent in shape', () => {
    /*
     * ⚠️ THIS IS THE PROPERTY THAT ACTUALLY MATTERS, and it is weaker than
     * "always three segments" — the brief itself names `meeting.booked` with
     * two. What would confuse a consumer is a domain that mixes the two, so
     * that `email.message.replied` sits beside `email.unsubscribed` and they
     * have to remember which is which. Within a domain, the shape is uniform.
     */
    const segmentsByDomain = new Map<string, Set<number>>()
    for (const event of WEBHOOK_EVENTS) {
      const domain = event.split('.')[0]!
      const set = segmentsByDomain.get(domain) ?? new Set<number>()
      set.add(event.split('.').length)
      segmentsByDomain.set(domain, set)
    }

    for (const [domain, shapes] of segmentsByDomain) {
      expect(shapes.size, `${domain} mixes event name shapes`).toBe(1)
    }
  })

  it('covers the CRM, email and meeting domains', () => {
    const domains = new Set(WEBHOOK_EVENTS.map((e) => e.split('.')[0]))
    expect(domains).toEqual(new Set(['crm', 'email', 'meeting']))
  })
})

/**
 * Jitter — §5.13's "exponential backoff + jitter", which was half-implemented.
 *
 * ⚠️ THE FAILURE MODE IS A THUNDERING HERD, NOT AN AESTHETIC ONE. `publishEvent`
 * fans one event out to every subscriber in the same instant, and a bulk import
 * emits many events in one tick, so a batch of deliveries shares
 * `next_attempt_at` to the second. Without jitter they all retry together
 * against a consumer that is already struggling.
 */
describe('backoff jitter', () => {
  it('stays within [half, base] of the documented schedule', () => {
    for (const attempt of [1, 2, 3, 4, 5]) {
      const base = backoffSeconds(attempt)
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const value = backoffSecondsWithJitter(attempt, () => r)
        expect(value).toBeGreaterThanOrEqual(base / 2)
        expect(value).toBeLessThanOrEqual(base)
      }
    }
  })

  it('never retries earlier than half the delay — equal jitter, not full', () => {
    /*
     * Full jitter (`random() * base`) would return ~0 here, discarding the
     * "do not hammer a consumer that is badly down" property the exponential
     * schedule exists for.
     */
    expect(backoffSecondsWithJitter(1, () => 0)).toBe(15)
    expect(backoffSecondsWithJitter(3, () => 0)).toBe(240)
  })

  it('spreads two deliveries that failed in the same instant', () => {
    // The whole point: same attempt, different result.
    const a = backoffSecondsWithJitter(3, () => 0.1)
    const b = backoffSecondsWithJitter(3, () => 0.9)
    expect(a).not.toBe(b)
  })

  it('is still monotonic across attempts', () => {
    // A later attempt must never be able to land sooner than an earlier one.
    for (const attempt of [1, 2, 3, 4]) {
      const latestEarlier = backoffSecondsWithJitter(attempt, () => 0.999)
      const earliestLater = backoffSecondsWithJitter(attempt + 1, () => 0)
      expect(earliestLater).toBeGreaterThanOrEqual(latestEarlier)
    }
  })

  it('the delivery worker uses the jittered form, not the bare schedule', () => {
    /*
     * Structural, comment-stripped: the exported `backoffSeconds` is still
     * re-exported for consumers and named in prose, so matching the raw text
     * would pass while the scheduler used the unjittered value.
     */
    const code = readFileSync(join(__dirname, '..', '..', 'lib/api/webhooks.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')

    expect(code).toContain('backoffSecondsWithJitter(attempt)')
    expect(code).not.toMatch(/next_attempt_at[\s\S]{0,80}backoffSeconds\(attempt\)/)
  })
})

/**
 * §5.13's "30-day delivery log" — the retention half, which did not exist.
 *
 * ⚠️ THE VISIBILITY HALF WAS BUILT AND THE BOUND WAS NOT. Settings → Developers
 * queries `webhook_deliveries`; nothing ever deleted a row. Outside the
 * delivery worker, the table's only other mention in the repo was a GRANT.
 *
 * ⚠️ AND IT IS A RETENTION PROBLEM, NOT A DISK ONE. Every row carries the event
 * payload — contact ids, and for reply and bounce events the person's email
 * address. An unbounded log of personal data is what storage limitation
 * forbids, and it sat behind a page that reads it.
 */
describe('the delivery log is bounded', () => {
  const WEBHOOKS = readFileSync(join(__dirname, '..', '..', 'lib/api/webhooks.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  const TICK = readFileSync(join(__dirname, '..', '..', 'lib/workers/tick.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('retains for the 30 days §5.13 names', () => {
    /*
     * Read from source rather than imported: `lib/api/webhooks.ts` is
     * `server-only`, so importing it here would fail at module load — the same
     * boundary that broke a Client Component earlier in this project and is
     * only ever caught by `next build`.
     */
    expect(WEBHOOKS).toMatch(/DELIVERY_RETENTION_DAYS = 30/)
  })

  it('a prune exists and deletes by age', () => {
    expect(WEBHOOKS).toContain('export async function pruneDeliveryLog')
    expect(WEBHOOKS).toMatch(/\.lt\('created_at', cutoff\)/)
  })

  it('prunes ONLY terminal rows — never an undelivered event', () => {
    /*
     * Deleting a `pending` or `retrying` row would silently drop a delivery the
     * product still owes, and hide whatever stranded it. This is the assertion
     * that matters most in this file.
     */
    expect(WEBHOOKS).toMatch(/\.in\('status', \['delivered', 'exhausted'\]\)/)
    expect(WEBHOOKS).not.toMatch(/pruneDeliveryLog[\s\S]{0,400}'pending'/)
    expect(WEBHOOKS).not.toMatch(/pruneDeliveryLog[\s\S]{0,400}'retrying'/)
  })

  it('the tick actually calls it — a prune nobody runs is not a bound', () => {
    /*
     * The defect class this project keeps finding: correct code with no caller.
     * Comment-stripped, because the rationale above names the function too.
     */
    expect(TICK).toContain('pruneDeliveryLog()')
    expect(TICK).toContain('pruneDeliveryLog')
  })

  it('prunes after delivering, not before', () => {
    // Housekeeping must not spend the tick's budget while a consumer waits.
    const deliverAt = TICK.indexOf('deliverPendingWebhooks(LIMITS.webhooksPerTick)')
    const pruneAt = TICK.indexOf('pruneDeliveryLog()')
    expect(deliverAt).toBeGreaterThan(-1)
    expect(pruneAt).toBeGreaterThan(deliverAt)
  })

  it('never throws into the tick', () => {
    // Failing to prune is housekeeping; failing the tick stops delivery.
    expect(WEBHOOKS).toMatch(/pruneDeliveryLog[\s\S]{0,700}console\.error/)
  })
})
