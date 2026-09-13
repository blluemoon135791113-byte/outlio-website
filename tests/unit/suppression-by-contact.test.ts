/**
 * Suppression is a fact about a PERSON, not about one of their addresses.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `crm_contact_emails` LETS ONE CONTACT HOLD SEVERAL ADDRESSES.            ║
 * ║                                                                           ║
 * ║  Both suppression checks matched on `email` alone, so somebody who         ║
 * ║  unsubscribed — or was marked do-not-contact after replying — kept         ║
 * ║  receiving mail at their second address, because the row recording that    ║
 * ║  decision named the first.                                                ║
 * ║                                                                           ║
 * ║  `email_suppressions.contact_id` has existed since 0086 and                ║
 * ║  `suppressEmail` has always written it. Nothing read it.                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ THESE ARE STRUCTURAL, AND THAT IS A LIMITATION WORTH STATING. The
 * behavioural suppression tests live in `tests/integration/email-send-worker`,
 * which needs real Supabase credentials and is invisible to `npm test` — a fact
 * `.github/workflows/ci.yml` already records about this exact guard. So these
 * assert that the predicate is present in both checks; they cannot prove it
 * returns the right rows. The integration suite is where that is proven.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'))

const SEND = read('lib/email/send.ts')
/*
 * ⚠️ THE DECISION MOVED, AND THESE FOLLOWED IT. `enqueueEmail` grew its own
 * two-table lookup in phase 2; phase 3 gave the same question to the LinkedIn
 * channel, and two readers of one rule is how a stop ends up honoured on one
 * channel and not the other. Repointed rather than deleted — what they guard
 * is unchanged.
 */
const STOP = read('lib/crm/contact-stop.ts')

describe('one predicate answers this for every channel', () => {
  it('enqueueEmail asks it rather than querying suppression itself', () => {
    expect(SEND).toMatch(/contactIsStopped\(\{/)
    expect(SEND).toMatch(/channel: 'email'/)
    expect(SEND).toMatch(/if \(stop\.stopped\) return \{ queued: false, reason: 'suppressed' \}/)
    // The lookup itself must not have been left behind as a second copy.
    expect(SEND, 'enqueueEmail still queries suppression directly').not.toContain(
      "from('email_suppressions')\n      .select('id')",
    )
  })

  it('consults both the person and the address', () => {
    expect(STOP).toMatch(/from\('crm_contact_suppressions'\)/)
    expect(STOP).toMatch(/from\('email_suppressions'\)/)
  })

  it('fails CLOSED when the lookup errors', () => {
    /*
     * ⚠️ THE OPPOSITE OF THE RATE LIMITER, DELIBERATELY. `consume_rate_limit`
     * fails open because refusing a legitimate action on a blip is worse than
     * allowing an extra one. Here the asymmetry runs the other way: mailing
     * somebody who asked not to be mailed cannot be undone. A database that
     * will not answer is not permission.
     */
    expect(STOP).toMatch(/via: 'unknown', reason: 'lookup_failed'/)
    expect(STOP).toMatch(/byContact\.error \|\| byAddress\.error/)
    expect(STOP, 'the catch returns permission').not.toMatch(
      /catch \{[\s\S]{0,120}return \{ stopped: false/,
    )
  })

  it('respects the recorded scope exactly', () => {
    /*
     * §4.15: "An opt-out's scope is respected exactly." Somebody who said stop
     * emailing me has not said stop connecting on LinkedIn, and widening it for
     * convenience invents the scope of their request.
     */
    expect(STOP).toMatch(/\.in\('scope', \['all', input\.channel\]\)/)
  })

  it('does not let an address suppression stop a non-email channel', () => {
    /*
     * An address suppression is evidence one mailbox asked to be left alone. It
     * says nothing about LinkedIn, and treating it as if it did would be
     * inventing the scope of somebody's request in the other direction.
     */
    expect(STOP).toMatch(/byAddress\.data && input\.channel === 'email'/)
  })

  it('refuses to answer about nobody', () => {
    // Neither identifier supplied means the answer would be about no one, which
    // a caller would read as permission.
    expect(STOP).toMatch(/needs a contactId or an email/)
  })

  it('does not build the filter with .or()', () => {
    /*
     * An email local part may legally contain a comma or a parenthesis, which
     * are PostgREST's own `or` syntax — `lib/crm/contacts-list.ts` documents
     * what that costs. Separate indexed lookups instead.
     */
    expect(STOP, 'the suppression filter uses .or()').not.toContain('.or(')
  })

  it('scopes every lookup by workspace', () => {
    // The service role bypasses RLS; workspace scoping in code is the only wall.
    const lookups = STOP.split("from('").length - 1
    const scoped = (STOP.match(/\.eq\('workspace_id', input\.workspaceId\)/g) ?? []).length
    expect(scoped).toBeGreaterThanOrEqual(2)
    expect(lookups).toBeGreaterThanOrEqual(2)
  })
})

describe('the claim-time check is fixed in the same way', () => {
  /*
   * ⚠️ THE OTHER HALF, AND IT NEEDS A MIGRATION. `enqueueEmail` refuses at
   * enqueue; a message QUEUED BEFORE the suppression was recorded is already in
   * the table, and only `claim_email_messages` stands between it and the wire.
   * `lib/email/send.ts` says it outright: "neither check makes the other
   * redundant."
   */
  const MIGRATION = readFileSync(
    join(ROOT, 'supabase/migrations/0120_suppress_by_contact.sql'),
    'utf8',
  )

  it('matches the contact as well as the address', () => {
    expect(MIGRATION).toMatch(/s\.email = m\.to_email/)
    expect(MIGRATION).toMatch(/s\.contact_id = m\.contact_id/)
  })

  it('guards the null case explicitly rather than leaning on three-valued logic', () => {
    /*
     * Without this, a suppression row with a null contact_id is compared
     * against a message with a null contact_id, and only `null = null`
     * evaluating to unknown stops it matching everything. That is not a thing
     * to leave implicit in a send/do-not-send decision.
     */
    expect(MIGRATION).toMatch(/s\.contact_id is not null/)
  })

  it('keeps 0106’s exact return shape', () => {
    /*
     * `create or replace` cannot alter a return type, so a wrong column list
     * does not fail safe — it fails the whole function. This shape is easy to
     * reconstruct incorrectly: `thread_id` is TEXT here rather than the uuid it
     * is on the table, and contact_id/campaign_id are NOT returned.
     */
    for (const column of [
      'message_id   uuid',
      'thread_id    text',
      'in_reply_to_message_id text',
      'idempotency_key text',
    ]) {
      expect(MIGRATION, `return shape drifted: ${column}`).toContain(column)
    }
    expect(MIGRATION, 'contact_id was added to the return set').not.toMatch(
      /returns table[\s\S]{0,400}contact_id\s+uuid/,
    )
  })

  it('indexes the column the new predicate scans', () => {
    expect(MIGRATION).toMatch(/email_suppressions_workspace_contact_idx/)
  })
})

describe('the contact is recorded when a suppression is written', () => {
  /*
   * ⚠️ THE HALF THAT MADE THE OTHER HALF INERT. `contact_id` has been on
   * `email_suppressions` since 0086, and of the three `suppressEmail` call
   * sites only the bounce path ever passed it. One-click unsubscribe — a
   * stated wish with legal weight — and the manual add did not, so the
   * contact-level check added to `enqueueEmail` was reading a column almost
   * nothing wrote.
   */
  it('resolves the contact inside suppressEmail rather than asking each caller', () => {
    expect(SEND).toMatch(/resolveSuppressionContact\(input\.workspaceId, email\)/)
    expect(SEND).toMatch(/input\.contactId \?\?/)
    expect(SEND).toMatch(/contact_id: contactId/)
  })

  it('refuses to attribute an address shared by several contacts', () => {
    /*
     * ⚠️ NOT A STYLE POINT. `info@`, `sales@` and `hello@` routinely sit on
     * several contacts. Attributing a do-not-contact to whichever colleague
     * sorted first would invent a fact about a person — the same defect as a
     * fabricated lead field — and would suppress the wrong two.
     */
    expect(SEND).toMatch(/owners\.length === 1/)
    expect(SEND).toMatch(/new Set\(/)
    // Two rows is enough to know it is ambiguous.
    expect(SEND).toMatch(/\.limit\(2\)/)
  })

  it('scopes the lookup by workspace and ignores deleted addresses', () => {
    const block = SEND.slice(
      SEND.indexOf('async function resolveSuppressionContact'),
      SEND.indexOf('export async function suppressEmail'),
    )
    expect(block).toMatch(/\.eq\('workspace_id', workspaceId\)/)
    expect(block).toMatch(/\.is\('deleted_at', null\)/)
  })

  it('never lets a failed lookup stop a suppression being recorded', () => {
    /*
     * Suppression is the safety-critical half; attribution is the bonus. A
     * lookup that throws must not prevent somebody being added to a
     * do-not-contact list.
     */
    const block = SEND.slice(
      SEND.indexOf('async function resolveSuppressionContact'),
      SEND.indexOf('export async function suppressEmail'),
    )
    expect(block).toMatch(/catch \{\s*return null/)
  })
})
