/**
 * Two reply rates, and why they are allowed to differ only if they are named
 * differently.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE SAME PHRASE MEANT TWO THINGS ON TWO SCREENS OF ONE PRODUCT.          ║
 * ║                                                                           ║
 * ║  `/crm/reports` divides replies by CONTACTS EMAILED. `/email/analytics`    ║
 * ║  divided reply EVENTS by MESSAGES sent. For 100 people on a four-step      ║
 * ║  sequence with 20 repliers, that is 20% and 5% — and `lib/crm/metrics.ts`  ║
 * ║  already says which of those is the wrong shape: "using the event count    ║
 * ║  would quarter the rate of a team that follows up four times — it would    ║
 * ║  punish doing the job properly".                                          ║
 * ║                                                                           ║
 * ║  Both figures are useful. What was wrong was calling them the same thing,  ║
 * ║  so a customer comparing two screens concluded one was broken.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

const ANALYTICS = read('app/(product)/email/analytics/page.tsx')
const METRICS = read('lib/crm/metrics.ts')
const REGISTRY = read('lib/reporting/registry.ts')

describe('the per-message figure says it is per message', () => {
  it('is not labelled "Reply rate"', () => {
    /*
     * ⚠️ THE WHOLE FIX. The number is a fine mailbox-health metric — "what does
     * this mailbox get back per message" — and a bad answer to "is our outreach
     * working". The label is what decides which question a reader thinks they
     * are asking.
     */
    expect(ANALYTICS).toContain('Replies per message')
    expect(ANALYTICS, 'the per-message figure is still called a reply rate').not.toMatch(
      /label="Reply rate"/,
    )
  })

  it('points at the per-person figure rather than leaving the reader to find it', () => {
    // Two screens disagreeing is confusing; two screens disagreeing and saying
    // so is informative.
    expect(ANALYTICS).toMatch(/replies per person/i)
  })

  it('still refuses to show a rate before anything is sent', () => {
    /*
     * Pre-existing and worth keeping: 0% before launch reads as failure rather
     * than as not-started. The check MOVED rather than went away — `rateOf`
     * now owns it, along with the volume floor the inline version never had —
     * so this follows it instead of asserting the old spelling.
     */
    expect(ANALYTICS).toMatch(/rateOf\(/)
    expect(ANALYTICS).toMatch(/=== null \? tooFewHint/)
  })
})

describe('the per-person figure keeps its contacts denominator', () => {
  it('divides by contacts emailed, not by emails sent', () => {
    /*
     * ⚠️ IF THIS EVER FLIPS, BOTH SCREENS BECOME WRONG TOGETHER and the
     * disagreement that makes the problem visible disappears with it.
     */
    expect(REGISTRY).toMatch(/id: 'contacts_emailed'/)
    expect(REGISTRY, 'reply_rate now divides by emails_sent').not.toMatch(
      /reply_rate[\s\S]{0,200}right: \{ op: 'metric', id: 'emails_sent' \}/,
    )
  })

  it('is defined once and delegated to', () => {
    // `replyRate` in metrics.ts delegates to the registry; two agreeing copies
    // is how `TASK_FOR` came to exist three times and diverge.
    expect(METRICS).toMatch(/evaluateDerived\('reply_rate', totals\)/)
  })

  it('returns null rather than 0% when nobody was emailed', () => {
    // A team that has emailed nobody has no reply rate; 0% reads as failure.
    expect(METRICS).toMatch(/number \| null/)
  })
})

describe('a rate needs enough evidence to be a rate', () => {
  const READINESS = read('lib/email/readiness.ts')

  it('analytics uses the readiness floor rather than its own', () => {
    /*
     * ⚠️ THE ALARMING NUMBER HAD NO FLOOR. 3 sends and 1 bounce read 33.3% on
     * this page — over three times `bounceCritical` — on the screen somebody
     * checks when they are worried about deliverability, while the readiness
     * check that actually gates sending said it did not know.
     */
    expect(ANALYTICS).toMatch(/rateOf\(totals\.bounced, totals\.sent\)/)
    expect(ANALYTICS).toMatch(/rateOf\(totals\.replied, totals\.sent\)/)
    expect(ANALYTICS, 'analytics divides without the floor').not.toMatch(
      /totals\.bounced \/ totals\.sent/,
    )
  })

  it('the floor is a real number, not zero', () => {
    // A floor of 0 or 1 would make `rateOf` a rename of division.
    expect(READINESS).toMatch(/minimumVolumeForRates:\s*(\d+)/)
    const value = Number(/minimumVolumeForRates:\s*(\d+)/.exec(READINESS)?.[1])
    expect(value).toBeGreaterThan(1)
  })

  it('distinguishes "not enough yet" from "nothing yet"', () => {
    /*
     * A mailbox that has sent 12 is working and being measured; one that has
     * sent 0 has not started. One sentence for both would tell the first that
     * their campaign never launched.
     */
    expect(ANALYTICS).toMatch(/totals\.sent === 0/)
    expect(ANALYTICS).toMatch(/Not enough sent yet/)
    expect(ANALYTICS).toMatch(/Nothing sent yet/)
  })

  it('says how many more are needed rather than just refusing', () => {
    // "Not enough" with no number is a dead end; the reader cannot tell whether
    // they are one send away or a hundred.
    expect(ANALYTICS).toMatch(/THRESHOLDS\.minimumVolumeForRates/)
    expect(ANALYTICS).toMatch(/\$\{totals\.sent\} so far/)
  })
})
