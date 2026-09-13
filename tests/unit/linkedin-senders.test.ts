/**
 * The only way into `linkedin_senders`, and the two rules that make it safe.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  THE TABLE HAS NO RLS SELECT POLICY, SO THIS MODULE IS THE BOUNDARY.      ║
 * ║                                                                           ║
 * ║  Everything protective lives here or in the security-definer function it   ║
 * ║  calls: the membership check before a count, the refusal to let one user   ║
 * ║  claim another's profile, and the decision never to hand a client the      ║
 * ║  global identity key. A component that queries the table directly gets     ║
 * ║  none of it — which is why `schema-without-code` held this table's place   ║
 * ║  until this file existed.                                                 ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const SENDERS = strip(readFileSync(join(ROOT, 'lib/linkedin/senders.ts'), 'utf8'))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const { budgetKindForTask } = await import('@/lib/linkedin/senders')

describe('a failed count means a FULL budget, never an empty one', () => {
  it('does not coalesce a database error to zero', () => {
    /*
     * ⚠️ `?? 0` WOULD READ AN OUTAGE AS "NOTHING SENT YET" and release a full
     * day's work against an account we know nothing about. Same fail-closed
     * asymmetry as `contactIsStopped`: the cost of being wrong is a restriction
     * on somebody's real LinkedIn account, which nobody can undo.
     */
    expect(SENDERS).toMatch(/day\.error \? Number\.MAX_SAFE_INTEGER/)
    expect(SENDERS).toMatch(/week\.error \? Number\.MAX_SAFE_INTEGER/)
    expect(SENDERS, 'a failed count falls back to zero').not.toMatch(
      /usedToday = day\.data \?\? 0/,
    )
  })

  it('asks the database for both windows rather than deriving one', () => {
    // A daily count is not a weekly count over seven, and the ladder sets the
    // weekly cap deliberately below seven daily ones.
    expect(SENDERS).toMatch(/p_window: '1 day'/)
    expect(SENDERS).toMatch(/p_window: '7 days'/)
  })
})

describe('one user cannot claim another user’s profile', () => {
  it('refuses when the identity belongs to somebody else', () => {
    /*
     * §4.10 names it: account sharing. Only the real owner may perform actions
     * from their account, so linking one they do not own is the first step of
     * exactly the thing the brief prohibits.
     */
    expect(SENDERS).toMatch(/existing\.owner_user_id !== input\.ownerUserId/)
    expect(SENDERS).toMatch(/reason: 'unavailable'/)
  })

  it('gives the same generic reason for a conflict and a failure', () => {
    /*
     * ⚠️ DISTINGUISHING THEM WOULD CONFIRM THAT A GIVEN PROFILE IS ON OUTLIO,
     * which is a disclosure about somebody who never signed up. The same
     * reasoning as the product 404 refusing to say whether a record exists.
     */
    const conflictReasons = SENDERS.match(/reason: '([a-z_]+)'/g) ?? []
    const distinct = new Set(conflictReasons)
    /*
     * ⚠️ `sender_limit` IS THE ONE SPECIFIC REASON, AND IT DISCLOSES NOTHING.
     * The other two are deliberately vague because the alternative — telling
     * somebody their link failed because this profile is ALREADY on Outlio —
     * is a disclosure about a person who never signed up here. The cap is
     * about the workspace's own plan, a number the customer can read on their
     * billing page, so vagueness there would be obstruction rather than
     * discretion.
     *
     * ⚠️ AND IT IS CHECKED BEFORE THE PROFILE LOOKUP, which is what keeps it
     * from becoming a probe: a workspace at its cap gets the same answer for
     * every URL, so it cannot learn which profiles exist by watching which
     * error comes back. The assertion below pins that order.
     */
    expect(distinct).toEqual(
      new Set([
        "reason: 'unavailable'",
        "reason: 'invalid_profile_url'",
        "reason: 'sender_limit'",
      ]),
    )
    expect(SENDERS).not.toMatch(/already_claimed|belongs_to|taken/)
  })

  it('checks the cap BEFORE looking the profile up, so it cannot be a probe', () => {
    /*
     * ⚠️ SCOPED TO `linkSender`'s BODY. Searching the whole file found
     * `from('linkedin_senders')` inside an EARLIER function, so the comparison
     * was against the wrong occurrence and passed while the cap sat after the
     * lookup. Caught by mutation — the same anchoring mistake as
     * `suppressContact` inside `unsuppressContact`.
     */
    const body = SENDERS.slice(
      SENDERS.indexOf('export async function linkSender'),
      SENDERS.indexOf('export type SenderBudget'),
    )
    expect(body.length).toBeGreaterThan(400)

    const capAt = body.indexOf("reason: 'sender_limit'")
    const lookupAt = body.indexOf("from('linkedin_senders')")
    expect(capAt).toBeGreaterThan(-1)
    expect(lookupAt).toBeGreaterThan(-1)
    expect(
      capAt,
      'the cap is checked after the lookup, so a workspace at its limit could ' +
        'still learn whether a given profile is on Outlio',
    ).toBeLessThan(lookupAt)
  })

  it('a failed count refuses rather than reading as "none linked"', () => {
    /*
     * ⚠️ SAME FAIL-CLOSED ASYMMETRY AS `senderBudget`, on the same table.
     * Coalescing a failed count to 0 would hand out a sender past the cap
     * precisely when the database is already unhappy.
     */
    expect(SENDERS).toMatch(/countError \|\| \(count \?\? Number\.MAX_SAFE_INTEGER\) >= limit/)
    expect(SENDERS, 'a failed count falls back to zero').not.toMatch(/count \?\? 0\) >= limit/)
  })

  it('treats a second workspace for the SAME user as a link, not a conflict', () => {
    // §4.10's shared-budget case: one human, two customers, one sender row.
    expect(SENDERS).toMatch(/from\('linkedin_sender_links'\)\s*\n\s*\.upsert\(/)
    expect(SENDERS).toMatch(/ignoreDuplicates: true/)
  })
})

describe('the global identity key never reaches a client', () => {
  it('is absent from the workspace listing', () => {
    /*
     * ⚠️ `identity_key` IS THE GLOBAL JOIN KEY. Handing it out would let two
     * workspaces correlate a sender between them — the browseable list §4.10
     * forbids, assembled one response at a time.
     */
    const listing = SENDERS.slice(SENDERS.indexOf('export async function listWorkspaceSenders'))
    expect(listing).toMatch(/select\('id, display_label, status, stage'\)/)
    expect(listing, 'the listing selects identity_key').not.toContain('identity_key')
  })

  it('scopes the link lookup by workspace', () => {
    // The service role bypasses RLS; this filter is the only wall on which
    // senders a workspace can even see the existence of.
    const listing = SENDERS.slice(SENDERS.indexOf('export async function listWorkspaceSenders'))
    expect(listing).toMatch(/\.eq\('workspace_id', workspaceId\)/)
  })
})

describe('a new sender starts at stage zero', () => {
  it('releases nothing until an owner reviews it', () => {
    // §4.10: "release zero proactive actions until the owner reviews account
    // status". A freshly linked account is unreviewed, not presumed fine.
    expect(SENDERS).toMatch(/stage: 0/)
    expect(SENDERS).toMatch(/status: 'unknown'/)
  })
})

describe('the budget says what it does not know', () => {
  const PANEL = strip(
    readFileSync(join(ROOT, 'components/linkedin/SenderSettings.tsx'), 'utf8'),
  )
  const LEDGER_WRITERS = (() => {
    const dirs = ['lib', 'app']
    const out: string[] = []
    const walk = (d: string) => {
      let names: string[]
      try {
        names = readdirSync(d)
      } catch {
        return
      }
      for (const name of names) {
        if (name === 'node_modules' || name.startsWith('.')) continue
        const full = join(d, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(full)) {
          const code = strip(readFileSync(full, 'utf8'))
          if (/from\('linkedin_sender_actions'\)[\s\S]{0,120}?\.(insert|upsert)\(/.test(code)) {
            out.push(full)
          }
        }
      }
    }
    for (const d of dirs) walk(join(ROOT, d))
    return out
  })()

  it('the ledger now has exactly one writer, and it is the release path', () => {
    /*
     * ╔═══════════════════════════════════════════════════════════════════════╗
     * ║  ⚠️ THIS ASSERTION IS INVERTED, AND THAT IS HOW IT WAS MEANT TO END.  ║
     * ║                                                                       ║
     * ║  It used to require `linkedin_sender_actions` to have NO writer, with ║
     * ║  the note: "when the release path lands it fails, and the fix is to    ║
     * ║  come back and re-read the caption rather than delete the test."       ║
     * ║  The release path landed the same day. This is that return.           ║
     * ║                                                                       ║
     * ║  Budgets are now real: `releaseTask` reserves a slot when a card is    ║
     * ║  released and `recordOutcome` resolves it, so the figures on the       ║
     * ║  settings panel can finally fall.                                     ║
     * ║                                                                       ║
     * ║  ⚠️ ONE WRITER, NOT "AT LEAST ONE". A second module inserting ledger   ║
     * ║  rows would be a second opinion about what spends an account's quota,  ║
     * ║  and this repository's most expensive defects are all two opinions of  ║
     * ║  one question.                                                        ║
     * ╚═══════════════════════════════════════════════════════════════════════╝
     */
    expect(LEDGER_WRITERS.map((f) => f.split('/').slice(-2).join('/'))).toEqual([
      'linkedin/tasks.ts',
    ])
  })

  it('a reservation is made at RELEASE, not at completion', () => {
    /*
     * ⚠️ §4.10's BUDGET COUNTS `reserved` ROWS. A card sitting in somebody's
     * inbox already holds its slot; reserving only when the work is confirmed
     * done would let a whole day of cards be released against a cap of twenty,
     * and the cap would exist only on paper.
     */
    const TASKS = strip(readFileSync(join(ROOT, 'lib/linkedin/tasks.ts'), 'utf8'))
    expect(TASKS).toMatch(/lifecycle: 'reserved'/)
    // Written BEFORE the task moves, so a failed reservation leaves the card
    // releasable rather than released with no slot.
    expect(TASKS.indexOf("lifecycle: 'reserved'")).toBeLessThan(
      TASKS.indexOf("state: 'RELEASED'"),
    )
  })

  it('an unknown outcome keeps its slot; only a definite non-action frees it', () => {
    /*
     * ⚠️ §4.17, AND THE ASYMMETRY IS THE POINT. An action we cannot rule out
     * having happened has to keep counting, because the cost of being wrong is
     * a restriction on somebody's real LinkedIn account. `OUTCOME_UNKNOWN`
     * therefore maps to `unknown` — which `linkedin_sender_used()` counts —
     * and never to `skipped`.
     */
    const TASKS = strip(readFileSync(join(ROOT, 'lib/linkedin/tasks.ts'), 'utf8'))
    expect(TASKS).toMatch(/releasesQuota\(outcome\) \? 'skipped'/)
    expect(TASKS).toMatch(/outcome === 'OUTCOME_UNKNOWN' \? 'unknown'/)
    expect(TASKS, 'an unknown outcome is being treated as a non-action').not.toMatch(
      /OUTCOME_UNKNOWN' \? 'skipped'/,
    )
  })

  it('the panel does not present the figure as monitoring', () => {
    // The caption stays true after the pipeline lands too: manual LinkedIn
    // activity is never visible to Outlio, which is what the reserve is for.
    expect(PANEL).toMatch(/Counts what Outlio has prepared for you/)
    expect(PANEL).toMatch(/not counted/)
  })
})

describe('task kinds map to the budget they spend', () => {
  it('routes each manual task to its own ladder', () => {
    expect(budgetKindForTask('CONNECTION_REQUEST')).toBe('invitation')
    expect(budgetKindForTask('DIRECT_MESSAGE')).toBe('direct_message')
    expect(budgetKindForTask('INMAIL')).toBe('inmail')
    expect(budgetKindForTask('REVIEW_PROFILE')).toBe('profile_review')
  })
})

describe('a failure is vague to the user and specific in the log', () => {
  /*
   * ⚠️ FOUND BY HITTING IT. On a staging project missing this table, linking
   * failed with "contact support" and nothing anywhere said why — the lookup's
   * error was discarded, so an infrastructure fault and an account conflict
   * were indistinguishable to the one person who could act on the difference.
   */
  it('logs all three failure paths', () => {
    for (const path of ['sender lookup failed', 'sender insert failed', 'sender link failed']) {
      expect(SENDERS, `${path} is silent`).toContain(path)
    }
  })

  it('no longer discards the lookup error', () => {
    expect(SENDERS).toMatch(/error: lookupError/)
    expect(SENDERS).toMatch(/if \(lookupError\)/)
  })

  it('never logs the identity key', () => {
    /*
     * ⚠️ IT NAMES A REAL PERSON'S PROFILE. CLAUDE.md forbids logging full lead
     * records for the same reason, and a sender's identity key is the most
     * identifying string in this module.
     */
    const logs = SENDERS.match(/console\.error\([\s\S]{0,240}?\)/g) ?? []
    expect(logs.length).toBeGreaterThanOrEqual(3)
    for (const log of logs) {
      expect(log, 'a log line carries the identity key').not.toContain('identityKey')
      expect(log).not.toContain('profileUrl')
    }
  })

  it('still tells the user nothing that distinguishes the causes', () => {
    // The vagueness is the privacy control; the log is where the difference
    // goes. Adding detail to the response would undo it.
    expect(SENDERS).not.toMatch(/reason: '(already_claimed|conflict|db_error)'/)
  })
})
