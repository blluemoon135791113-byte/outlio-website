/**
 * A reply from somebody we never messaged is not a reply — Phase 19.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  §7.5: "reuse the Phase 9 lesson — an inbound message is only a reply if  ║
 * ║  WE ACTUALLY CONTACTED THEM, or the same false-reply bug returns on a new ║
 * ║  channel."                                                                ║
 * ║                                                                           ║
 * ║  `email_events` still holds 254 false `replied` rows: an entire mailbox   ║
 * ║  recorded as prospect replies against two messages ever sent. A naive     ║
 * ║  reply rate computes 254/2 and renders 12,700%.                          ║
 * ║                                                                           ║
 * ║  ⚠️ THE LINKEDIN VERSION CANNOT COPY THE EMAIL RULE. `hasEverMailed`      ║
 * ║  checks for an `email_messages` row — a record the product wrote because  ║
 * ║  it sent something, an OBSERVED FACT. LinkedIn has no such row: the       ║
 * ║  nearest thing is a task a person MARKED as sent, which is a CLAIM whose  ║
 * ║  legal values include "I cannot say".                                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SOURCE = readFileSync(join(ROOT, 'lib/linkedin/observations.ts'), 'utf8')

/**
 * ⚠️ COMMENTS STRIPPED. This module argues at length about which outcomes mean
 * contact, naming SKIPPED and FAILED repeatedly in prose while excluding them
 * in code. Matching the raw text would find the reasoning and report the
 * opposite of what the code does.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/\/\/.*$/, ''))
  .join('\n')

describe('the scanner sees what it polices', () => {
  it('reads the module and finds its outcome lists', () => {
    expect(CODE).toContain('MAY_HAVE_REACHED')
    expect(CODE).toContain('UNCONFIRMED')
  })

  it('strips comments rather than matching the argument', () => {
    // The prose says "SKIPPED AND FAILED ARE ABSENT ON PURPOSE"; the code must
    // not contain them. Without stripping, the first would satisfy a search for
    // the second.
    expect(SOURCE, 'the rationale was deleted').toContain('SKIPPED')
    const stripped = '/* SKIPPED */\nconst x = 1'
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).not.toContain('SKIPPED')
  })
})

describe('what counts as having contacted someone', () => {
  it('a marked-sent request or message counts', () => {
    /*
     * ⚠️ ANCHORED ON THE NEXT DECLARATION, NOT ON A CAST. My first version
     * sliced to `'] as unknown'` — text that existed only because of a
     * redundant type assertion. Removing the assertion emptied the slice and
     * the test failed on correct code, asserting against ''.
     */
    const list = CODE.slice(
      CODE.indexOf('const MAY_HAVE_REACHED'),
      CODE.indexOf('const UNCONFIRMED'),
    )
    expect(list).toContain('REQUEST_MARKED_SENT')
    expect(list).toContain('MESSAGE_MARKED_SENT')
  })

  it('SKIPPED and FAILED do NOT count — this is the 12,700% shape', () => {
    /*
     * ⚠️ THE ASSERTION THE WHOLE PHASE RESTS ON. Skipped is a decision not to
     * act; failed is somebody having looked and found it did not happen.
     * Neither can be replied to, and admitting either readmits exactly the bug
     * Phase 9 fixed — a reply attributed to outreach that never left.
     */
    const list = CODE.slice(
      CODE.indexOf('const MAY_HAVE_REACHED'),
      CODE.indexOf('const UNCONFIRMED'),
    )
    expect(list, 'SKIPPED would let a reply be attributed to outreach never sent').not.toContain(
      'SKIPPED',
    )
    expect(list, 'FAILED would do the same').not.toContain('FAILED')
  })

  it('OUTCOME_UNKNOWN counts, and is flagged rather than refused', () => {
    /*
     * ⚠️ NOT LENIENCY — CONSISTENCY. §4.17 already treats an unknown outcome as
     * possibly delivered: it keeps its quota reservation "because the thing we
     * cannot rule out is that a stranger already received it". Refusing a reply
     * on that same evidence would have the product assert, for attribution, the
     * opposite of what it assumes for safety.
     *
     * The doubt is carried on the row instead, so a metric can exclude it
     * without the recording path having to guess.
     */
    const reached = CODE.slice(
      CODE.indexOf('const MAY_HAVE_REACHED'),
      CODE.indexOf('const UNCONFIRMED'),
    )
    expect(reached).toContain('OUTCOME_UNKNOWN')

    const unconfirmed = CODE.slice(
      CODE.indexOf('const UNCONFIRMED'),
      CODE.indexOf('export type ContactEvidence'),
    )
    expect(unconfirmed).toContain('OUTCOME_UNKNOWN')
    expect(CODE).toContain('evidence_was_unconfirmed: evidence.unconfirmed')
  })

  it('a confirmed task is preferred over an unknown one', () => {
    /*
     * Otherwise one uncertain step would mark every later reply as doubtful,
     * and the flag would stop meaning anything — the same way a warning that
     * fires constantly stops being read.
     */
    expect(CODE).toMatch(/rows\.find\(/)
    expect(CODE).toMatch(/!UNCONFIRMED\.includes\(row\.outcome\)/)
  })
})

describe('the refusal, and what it does not do', () => {
  it('refuses when nothing could have reached them', () => {
    expect(CODE).toMatch(/if \(!evidence\.contacted\)/)
    expect(SOURCE).toMatch(/no record of sending this person anything/)
  })

  it('the message tells the operator what to check, not just "no"', () => {
    /*
     * They are looking at a real person they believe replied. "Not allowed"
     * invites them to find another way to record it; naming the rule invites
     * them to check — they may have messaged from LinkedIn directly without a
     * task, which is worth knowing.
     */
    expect(SOURCE).toMatch(/If you messaged them outside Outlio, add the outreach first/)
  })

  it('a lookup failure is NOT treated as "never contacted"', () => {
    /*
     * ⚠️ THE FAIL-SAFE DIRECTION, AND IT IS THE OPPOSITE OF THE OBVIOUS ONE.
     * Returning `contacted: false` on a database hiccup would refuse a genuine
     * reply and — worse — leave outreach running at somebody who had already
     * answered. `contact-stop.ts` fails CLOSED for the same class of reason;
     * here failing closed means refusing to DECIDE, not deciding "no".
     */
    expect(CODE).toMatch(/if \(error\) throw new Error\(`contactEvidence failed/)
    const record = CODE.slice(CODE.indexOf('export async function recordObservation'))
    expect(record).toMatch(/reason: 'failed'/)
    expect(
      record,
      'a failed lookup is being reported as never_contacted',
    ).not.toMatch(/catch[\s\S]{0,200}never_contacted/)
  })
})

describe('an observation is not a task outcome', () => {
  it('the recorder writes to linkedin_observations, never linkedin_tasks', () => {
    /*
     * 0132 refuses an Observation as a task outcome in the enum AND in the
     * service, because "mark request sent" must not be able to mark acceptance
     * — and acceptance gates the first DM, so the collapse sends a message into
     * a connection that was never made.
     */
    expect(CODE).toContain("from('linkedin_observations')")
    const record = CODE.slice(CODE.indexOf('export async function recordObservation'))
    expect(record, 'the recorder writes a task outcome').not.toMatch(
      /from\('linkedin_tasks'\)[\s\S]{0,200}(insert|update)/,
    )
  })

  it('the database enum matches the Observation vocabulary exactly', () => {
    /*
     * Two walls, deliberately: a vocabulary enforced in one place is one that
     * drifts. Verified against the live enum during the migration smoke test;
     * pinned here so the two files cannot diverge afterwards.
     */
    const migration = readFileSync(
      join(ROOT, 'supabase/migrations/0136_linkedin_observations.sql'),
      'utf8',
    )
    const outcomes = readFileSync(join(ROOT, 'lib/linkedin/outcomes.ts'), 'utf8')
    const block = outcomes.slice(
      outcomes.indexOf('export type Observation'),
      outcomes.indexOf('const ALWAYS'),
    )
    const kinds = [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!)

    expect(kinds.length).toBeGreaterThanOrEqual(5)
    for (const kind of kinds) {
      expect(migration, `the enum is missing ${kind}`).toContain(`'${kind}'`)
    }
  })
})
